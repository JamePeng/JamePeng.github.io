import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createArticleStore, EditorError } from "./article-store.mjs";
import {
  importWechatArticle,
  importSavedWechatArticle,
} from "./wechat-import.mjs";
import { previewDocument, sanitizeBody } from "./article-content.mjs";
import { formatArticleBody } from "./article-format.mjs";
import {
  MAX_SAVED_HTML_BYTES,
  MAX_SAVED_HTML_MB,
  MAX_BODY_BYTES,
  MAX_BODY_MB,
  MAX_JSON_BYTES,
} from "./admin/limits.js";

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export function createBlogServer(rootDirectory, options = {}) {
  const root = resolve(rootDirectory);
  const store = createArticleStore(root, options);
  const token = randomBytes(32).toString("hex");
  let saves = Promise.resolve();
  let importing = false;
  function json(res, status, value) {
    res.writeHead(status, {
      "Content-Type": types[".json"],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(value));
  }
  async function readRequest(req, limit, message) {
    if (Number(req.headers["content-length"]) > limit)
      throw new EditorError(message, 413);
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new EditorError(message, 413);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  async function payload(req) {
    if (!/^application\/json\b/.test(req.headers["content-type"] || ""))
      throw new EditorError("请求格式不正确。", 415);
    const raw = await readRequest(
      req,
      MAX_JSON_BYTES,
      `提交内容过大，请将正文控制在 ${MAX_BODY_MB} MB 内。`,
    );
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      throw new EditorError("提交内容不是有效的 JSON。");
    }
    if (!result || Array.isArray(result) || typeof result !== "object")
      throw new EditorError("请求格式不正确。");
    return result;
  }
  function verifyToken(req) {
    const supplied = Buffer.from(String(req.headers["x-admin-token"] || ""));
    const expected = Buffer.from(token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw new EditorError("编辑会话已失效，请刷新管理页。", 403);
  }
  return http.createServer(async (req, res) => {
    try {
      const port = req.socket.localPort;
      if (
        ![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)
      )
        throw new EditorError("只能通过本机地址访问编辑台。", 403);
      const origin = `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== origin)
        throw new EditorError("不允许跨站访问编辑台。", 403);
      const requestUrl = new URL(req.url, origin);
      const pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.startsWith("/api/admin/")) {
        if (req.method === "GET" && pathname === "/api/admin/session")
          return json(res, 200, { token });
        if (req.method === "GET" && pathname === "/api/admin/posts")
          return json(res, 200, { posts: store.list() });
        const match = pathname.match(/^\/api\/admin\/posts\/([a-z0-9-]+)$/);
        if (req.method === "GET" && match)
          return json(res, 200, { post: store.get(match[1]) });
        verifyToken(req);
        if (req.method === "POST" && pathname === "/api/admin/import") {
          if (importing)
            throw new EditorError("正在读取一篇文章，请稍候再试。", 429);
          const data = await payload(req);
          importing = true;
          try {
            return json(
              res,
              200,
              await (options.importer
                ? options.importer(data.url, {
                    autoFormat: data.autoFormat !== false,
                  })
                : importWechatArticle(data.url, undefined, {
                    autoFormat: data.autoFormat !== false,
                  })),
            );
          } catch (error) {
            throw Object.assign(
              new EditorError(
                ["TimeoutError", "AbortError"].includes(error.name)
                  ? "读取微信文章超时，请稍后再试，或复制正文到编辑器。"
                  : error.message || "读取失败，请复制正文到编辑器。",
                422,
              ),
              { code: error.code },
            );
          } finally {
            importing = false;
          }
        }
        if (req.method === "POST" && pathname === "/api/admin/import-html") {
          if (!/^text\/html\b/.test(req.headers["content-type"] || ""))
            throw new EditorError("请上传 HTML 网页文件。", 415);
          const html = await readRequest(
            req,
            MAX_SAVED_HTML_BYTES,
            `请选择不超过 ${MAX_SAVED_HTML_MB} MB 的 HTML 网页文件。`,
          );
          try {
            return json(
              res,
              200,
              importSavedWechatArticle(
                html,
                requestUrl.searchParams.get("url") || "",
                {
                  autoFormat:
                    requestUrl.searchParams.get("autoFormat") !== "false",
                },
              ),
            );
          } catch (error) {
            throw Object.assign(new EditorError(error.message, 422), {
              code: error.code,
            });
          }
        }
        if (req.method === "POST" && pathname === "/api/admin/format") {
          const data = await payload(req);
          try {
            return json(
              res,
              200,
              formatArticleBody(data.body, {
                title: typeof data.title === "string" ? data.title : "",
              }),
            );
          } catch (error) {
            throw new EditorError(error.message, 422);
          }
        }
        if (req.method === "POST" && pathname === "/api/admin/preview") {
          const data = await payload(req);
          if (
            typeof data.body !== "string" ||
            Buffer.byteLength(data.body) > MAX_BODY_BYTES
          )
            throw new EditorError(
              `正文应为文本，且不超过 ${MAX_BODY_MB} MB。`,
              413,
            );
          return json(res, 200, {
            html: previewDocument(data.body || "", data.title),
            body: sanitizeBody(data.body || ""),
          });
        }
        if (
          (req.method === "POST" && pathname === "/api/admin/posts") ||
          (req.method === "PUT" && match)
        ) {
          const data = await payload(req);
          const task = saves.then(() => store.save(data, match?.[1]));
          saves = task.catch(() => {});
          return json(res, 200, await task);
        }
        throw new EditorError("这个编辑操作不存在。", 404);
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new EditorError("不支持这个请求方法。", 405);
      const adminFiles = {
        "/admin/": "index.html",
        "/admin/index.html": "index.html",
        "/admin/admin.css": "admin.css",
        "/admin/preview.css": "preview.css",
        "/admin/admin.js": "admin.js",
        "/admin/limits.js": "limits.js",
      };
      if (pathname === "/admin") {
        res.writeHead(302, { Location: "/admin/" });
        return res.end();
      }
      let file;
      if (Object.hasOwn(adminFiles, pathname))
        file = resolve(root, "scripts/admin", adminFiles[pathname]);
      else {
        if (
          pathname.includes("\\") ||
          pathname.split("/").some((part) => part.startsWith(".")) ||
          /^\/(?:content|scripts|node_modules)\//.test(pathname)
        )
          throw new EditorError("页面不存在。", 404);
        file = resolve(root, "." + pathname);
        if (!file.startsWith(root + sep) && file !== root)
          throw new EditorError("页面不存在。", 404);
        if ((await stat(file)).isDirectory())
          file = resolve(file, "index.html");
      }
      const data = await readFile(file);
      const headers = {
        "Content-Type": types[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      };
      if (pathname.startsWith("/admin/"))
        headers["Content-Security-Policy"] =
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http:; frame-src 'self' about:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : data);
    } catch (error) {
      if (req.url?.startsWith("/api/"))
        return json(res, error.status || 500, {
          error: error.status ? error.message : "操作失败，请检查文件后重试。",
          ...(error.status && error.code ? { code: error.code } : {}),
        });
      res.writeHead(error.status || 404, { "Content-Type": types[".html"] });
      res.end(
        await readFile(resolve(root, "404.html")).catch(() => "Page not found"),
      );
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const root = resolve(import.meta.dirname, "..");
  const port = 4173;
  const server = createBlogServer(root);
  server.on("error", (error) => {
    console.error(
      error.code === "EADDRINUSE"
        ? "4173 端口已使用。若博客编辑台已经启动，请直接打开 http://127.0.0.1:4173/admin/"
        : error.message,
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(
      `文章管理：http://127.0.0.1:${port}/admin/\n博客预览：http://127.0.0.1:${port}/`,
    ),
  );
}
