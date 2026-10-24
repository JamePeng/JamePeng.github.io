import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { preparePosts, parsePostDate } from "./post-metadata.mjs";
import { sanitizeBody, plainText } from "./article-content.mjs";
import { MAX_BODY_BYTES, MAX_BODY_MB } from "./admin/limits.js";

const execute = promisify(execFile);
export class EditorError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function text(value, label, max, required = false) {
  if (value != null && typeof value !== "string")
    throw new EditorError(`${label}格式不正确。`);
  const result = (value || "").trim();
  if ((required && !result) || result.length > max)
    throw new EditorError(
      `${label}${required && !result ? "不能为空" : `不能超过 ${max} 个字`}。`,
    );
  return result;
}
const digest = (post, body) =>
  createHash("sha256").update(JSON.stringify(post)).update(body).digest("hex");

export function createArticleStore(projectRoot, options = {}) {
  const root = resolve(projectRoot);
  const contentRoot = join(root, "content");
  const catalogPath = join(contentRoot, "posts.json");
  const catalog = () => JSON.parse(readFileSync(catalogPath, "utf8"));
  function contentPath(file) {
    if (!/^[a-z0-9][a-z0-9-]*\.html$/.test(file))
      throw new EditorError("文章正文文件名不正确。", 500);
    const path = resolve(contentRoot, file);
    if (!path.startsWith(contentRoot + sep))
      throw new EditorError("文章路径无效。", 500);
    return path;
  }
  const readBody = (post) => readFileSync(contentPath(post.file), "utf8");
  const build =
    options.build ||
    (() =>
      execute(process.execPath, [join(root, "scripts/build.mjs")], {
        cwd: root,
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024,
      }));
  function atomicWrite(path, value) {
    const temporary = `${path}.${randomBytes(5).toString("hex")}.tmp`;
    try {
      writeFileSync(temporary, value);
      renameSync(temporary, path);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  function list() {
    return preparePosts(catalog()).map((post) => ({
      slug: post.slug,
      title: post.title,
      date: post.date,
      displayDate: post.displayDate,
      category: post.category,
      featured: !!post.featured,
      path: post.path,
      source: post.source,
    }));
  }
  function get(slug) {
    const post = catalog().find((post) => post.slug === slug);
    if (!post) throw new EditorError("这篇文章不存在。", 404);
    const body = readBody(post);
    const normalized = preparePosts([post])[0];
    return {
      ...post,
      body,
      editorBody: sanitizeBody(body),
      revision: digest(post, body),
      displayDate: normalized.displayDate,
      displayUpdated: post.updated ? parsePostDate(post.updated).display : "",
    };
  }
  async function save(input, slug) {
    const current = catalog();
    const old = slug ? current.find((post) => post.slug === slug) : null;
    if (slug && !old) throw new EditorError("这篇文章不存在。", 404);
    const previousBody = old ? readBody(old) : null;
    if (old && input.revision !== digest(old, previousBody))
      throw new EditorError(
        "文章已在其他窗口更新。请先重新载入，避免覆盖新的修改。",
        409,
      );
    const nextSlug = old?.slug || text(input.slug, "链接名称", 100, true);
    if (!slugPattern.test(nextSlug))
      throw new EditorError(
        "链接名称只能使用小写英文字母、数字和连字符。例：my-wechat-note。",
      );
    if (!old && current.some((post) => post.slug === nextSlug))
      throw new EditorError("这个链接名称已经使用，请换一个。", 409);
    const post = {
      ...(old || {
        slug: nextSlug,
        path: `/posts/${nextSlug}/`,
        file: `${nextSlug}.html`,
      }),
      title: text(input.title, "文章标题", 200, true),
      date: text(input.date, "发布时间", 50, true),
      category: text(input.category, "分类", 40) || "随笔",
      tags: [
        ...new Set(
          (Array.isArray(input.tags)
            ? input.tags
            : text(input.tags, "标签", 500).split(/[,，]/)
          )
            .map((tag) => text(tag, "标签", 40))
            .filter(Boolean),
        ),
      ],
      featured: input.featured === true,
    };
    if (post.tags.length > 20) throw new EditorError("最多填写 20 个标签。");
    const updated = text(input.updated, "更新时间", 50);
    if (updated) post.updated = updated;
    else delete post.updated;
    if (text(input.source?.url, "原文链接", 3000))
      post.source = {
        name: text(input.source.name, "公众号名称", 80) || "微信公众号",
        url: text(input.source.url, "原文链接", 3000, true),
      };
    else delete post.source;
    if (
      typeof input.body !== "string" ||
      Buffer.byteLength(input.body) > MAX_BODY_BYTES
    )
      throw new EditorError(`正文应为文本，且不超过 ${MAX_BODY_MB} MB。`);
    const body =
      old && input.body === previousBody
        ? previousBody
        : sanitizeBody(input.body);
    if (!plainText(body) && !/<img\b/i.test(body))
      throw new EditorError("请填写文章正文。");
    post.description =
      text(input.description, "文章摘要", 1000) ||
      plainText(body).slice(0, 140);
    // If the author changes the title/summary, let the featured card follow it.
    if (old && old.title !== post.title) delete post.cardTitle;
    if (old && old.description !== post.description)
      delete post.cardDescription;
    const next = current.map((entry) =>
      entry.slug === post.slug
        ? post
        : post.featured
          ? { ...entry, featured: false }
          : entry,
    );
    if (!old) next.unshift(post);
    try {
      preparePosts(next);
    } catch (error) {
      throw new EditorError(error.message);
    }
    const bodyPath = contentPath(post.file);
    const generatedPath = resolve(root, "." + post.path, "index.html");
    if (!old && (existsSync(bodyPath) || existsSync(generatedPath)))
      throw new EditorError("这个链接或文件已经存在，请更换链接名称。", 409);
    const previousCatalog = readFileSync(catalogPath, "utf8");
    const backup = join(
      root,
      ".local-backups",
      `${Date.now()}-${randomBytes(4).toString("hex")}`,
    );
    mkdirSync(backup, { recursive: true });
    writeFileSync(join(backup, "posts.json"), previousCatalog);
    if (old) writeFileSync(join(backup, post.file), previousBody);
    try {
      atomicWrite(bodyPath, body);
      atomicWrite(catalogPath, JSON.stringify(next, null, 2) + "\n");
      await build();
    } catch (error) {
      atomicWrite(catalogPath, previousCatalog);
      if (old) atomicWrite(bodyPath, previousBody);
      else {
        if (existsSync(bodyPath)) unlinkSync(bodyPath);
        if (
          generatedPath.startsWith(join(root, "posts") + sep) &&
          existsSync(generatedPath)
        )
          unlinkSync(generatedPath);
      }
      try {
        await build();
      } catch {
        /* The saved source backup is retained even if the environment cannot build. */
      }
      throw new EditorError(
        "保存或生成失败，文章源文件已恢复。请检查文件权限和磁盘空间后重试。",
        500,
      );
    }
    return {
      post: get(post.slug),
      previewUrl: post.path,
      message: "已保存并更新本地博客。",
    };
  }
  return { list, get, save };
}
