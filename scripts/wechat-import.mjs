import { parseHTML } from "linkedom";
import { sanitizeBody, plainText } from "./article-content.mjs";
import { parsePostDate } from "./post-metadata.mjs";
import { formatArticleBody } from "./article-format.mjs";
import {
  MAX_SAVED_HTML_BYTES,
  MAX_SAVED_HTML_MB,
  MAX_BODY_BYTES,
  MAX_BODY_MB,
} from "./admin/limits.js";

export class WechatImportError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "WechatImportError";
    this.code = code;
  }
}

const verificationError = () =>
  new WechatImportError(
    "微信要求在浏览器中完成验证，服务器没有拿到正文；这不是原文链接写错。请在自己的浏览器中打开原文，另存为 HTML 网页，再点击“导入公众号网页”。",
    "WECHAT_VERIFICATION_REQUIRED",
  );

function isVerificationUrl(url) {
  return (
    url.hostname === "mp.weixin.qq.com" &&
    /\/[^/]*(?:captcha|verify)[^/]*(?:\/|$)/i.test(url.pathname)
  );
}

function articleDescription(body, title) {
  const { document } = parseHTML(`<html><body>${body}</body></html>`);
  const normalize = (value) => value.replace(/\s/g, "");
  const paragraphs = [...document.querySelectorAll("p")];
  const intro = paragraphs.find(
    (n) =>
      !n.closest("blockquote,pre,figure,li,table,.article-comparison") &&
      !n.classList.contains("article-kicker") &&
      n.textContent.trim().length >= 12 &&
      normalize(n.textContent) !== normalize(title),
  );
  const text = intro
    ? intro.textContent.replace(/\s+/g, " ").trim()
    : plainText(body);
  if (text.length <= 140) return text;
  const excerpt = text.slice(0, 140);
  const sentence = Math.max(
    ...["。", "！", "？", "!", "?"].map((mark) => excerpt.lastIndexOf(mark)),
  );
  return sentence >= 20 ? excerpt.slice(0, sentence + 1) : excerpt + "…";
}

export function wechatUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("请填写完整的微信公众号文章链接。");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "mp.weixin.qq.com" ||
    url.port ||
    url.username ||
    url.password ||
    !/^\/s(?:\/|$)/.test(url.pathname)
  )
    throw new Error(
      "请使用 https://mp.weixin.qq.com/s/ 开头的公众号文章链接。",
    );
  url.hash = "";
  return url;
}

export function extractWechatArticle(html, sourceUrl, options = {}) {
  const { document } = parseHTML(html);
  const content = document.querySelector("#js_content");
  if (
    !content ||
    (!content.textContent.trim() && !content.querySelector("img"))
  ) {
    if (
      /wappoc_appmsgcaptcha|环境异常|完成验证|访问过于频繁|安全验证|访问验证/.test(
        document.body?.textContent || html,
      )
    )
      throw verificationError();
    throw new WechatImportError(
      "微信未返回文章正文，可能需要在浏览器中验证。请打开原文，复制正文到编辑器；也可以使用“导入 HTML 文件”。",
      "WECHAT_CONTENT_UNAVAILABLE",
    );
  }
  const title = (
    document.querySelector("#activity-name")?.textContent ||
    document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content") ||
    ""
  ).trim();
  const sourceName =
    document.querySelector("#js_name")?.textContent.trim() || "微信公众号";
  let date = "";
  const timestamp = html.match(/\b(?:var\s+)?ct\s*=\s*["']?(\d{10})\b/);
  const visibleDate = document
    .querySelector("#publish_time")
    ?.textContent.trim();
  if (timestamp)
    date = parsePostDate(
      new Date(Number(timestamp[1]) * 1000).toISOString(),
    ).display.replaceAll(".", "-");
  else if (visibleDate) {
    const match = visibleDate
      .replace(/年|月/g, "-")
      .replace(/日/g, " ")
      .match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\s+\d{2}:\d{2})?/);
    if (match) {
      const normalized = match[0]
        .replace(/\s+/g, " ")
        .trim()
        .replaceAll("/", "-")
        .replace(/-(\d)(?=-|\s|$)/g, "-0$1");
      try {
        date = parsePostDate(normalized).display.replaceAll(".", "-");
      } catch {
        /* Ask the author to supply a date when extraction is ambiguous. */
      }
    }
  }
  const cleaned = sanitizeBody(content.innerHTML);
  const formatting =
    options.autoFormat === false ? null : formatArticleBody(cleaned, { title });
  const body = formatting?.body || cleaned;
  return {
    title,
    body,
    date,
    description: articleDescription(body, title),
    source: {
      name: sourceName,
      url: sourceUrl ? wechatUrl(sourceUrl).href : "",
    },
    warnings: date ? [] : ["未识别到原始发布时间，请手动填写后保存。"],
    formatting: formatting
      ? {
          applied: true,
          changed: formatting.changed,
          changes: formatting.changes,
        }
      : { applied: false },
  };
}

// This path consumes only the HTML file explicitly selected by the author.
// It performs no network requests and does not reuse browser sessions/cookies.
export function importSavedWechatArticle(html, sourceUrl = "", options = {}) {
  if (
    typeof html !== "string" ||
    Buffer.byteLength(html) > MAX_SAVED_HTML_BYTES
  )
    throw new WechatImportError(
      `请选择不超过 ${MAX_SAVED_HTML_MB} MB 的 HTML 网页文件。`,
      "INVALID_HTML_FILE",
    );
  const { document } = parseHTML(html);
  let original = sourceUrl.trim();
  if (!original) {
    const candidate =
      document
        .querySelector('meta[property="og:url"]')
        ?.getAttribute("content") ||
      document.querySelector('link[rel="canonical"]')?.getAttribute("href");
    if (candidate) {
      try {
        original = wechatUrl(candidate).href;
      } catch {
        /* Ignore unrelated metadata; never fetch it. */
      }
    }
  }
  const article = extractWechatArticle(html, original, options);
  if (Buffer.byteLength(article.body) > MAX_BODY_BYTES)
    throw new WechatImportError(
      `提取后的正文超过 ${MAX_BODY_MB} MB，请拆分为多篇文章后导入。`,
      "ARTICLE_BODY_TOO_LARGE",
    );
  if (!article.source.url)
    article.warnings.push("网页未包含原文链接，可在右侧补充。");
  return article;
}

export async function importWechatArticle(
  input,
  fetcher = fetch,
  options = {},
) {
  let url = wechatUrl(input);
  const original = url.href;
  for (let redirect = 0; redirect < 4; redirect++) {
    const response = await fetcher(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location)
        throw new WechatImportError(
          "微信返回了无效跳转，请打开原文后导入已保存的网页。",
          "WECHAT_INVALID_REDIRECT",
        );
      const redirected = new URL(location, url);
      if (isVerificationUrl(redirected)) throw verificationError();
      url = wechatUrl(redirected.href);
      continue;
    }
    if (!response.ok)
      throw new Error("暂时无法读取微信文章，请打开原文后复制正文到编辑器。");
    if (Number(response.headers.get("content-length")) > 3 * 1024 * 1024)
      throw new Error("原文过大，请复制正文或导入 HTML 文件。");
    let size = 0;
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 3 * 1024 * 1024)
        throw new Error("原文过大，请复制正文或导入 HTML 文件。");
      chunks.push(chunk);
    }
    return extractWechatArticle(
      Buffer.concat(chunks).toString("utf8"),
      original,
      options,
    );
  }
  throw new Error("微信链接跳转过多，请使用文章的直接链接。");
}
