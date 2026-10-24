import test from "node:test";
import assert from "node:assert/strict";
import {
  wechatUrl,
  extractWechatArticle,
  importWechatArticle,
  importSavedWechatArticle,
} from "./wechat-import.mjs";
import { MAX_SAVED_HTML_BYTES } from "./admin/limits.js";

const fixture = `<!doctype html><html><body><h1 id="activity-name">测试 &amp; 公众号文章</h1><span id="js_name">JamePeng 的公众号</span><span id="publish_time"></span><div id="js_content"><h2>正文标题</h2><p>一次探索的记录。</p><img data-src="https://mmbiz.qpic.cn/example.jpg"><script>alert(1)</script></div><script>var ct = "1716208200";</script></body></html>`;

test("WeChat extraction returns title, source, Beijing time, and lazy images", () => {
  const result = extractWechatArticle(
    fixture,
    "https://mp.weixin.qq.com/s/test",
  );
  assert.equal(result.title, "测试 & 公众号文章");
  assert.equal(result.source.name, "JamePeng 的公众号");
  assert.equal(result.date, "2024-05-20 20:30");
  assert(result.body.includes('src="https://mmbiz.qpic.cn/example.jpg"'));
  assert(!result.body.includes("<script"));
  assert.equal(result.warnings.length, 0);
});

test("The observed verification redirect is not misreported as an invalid article URL", async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      importWechatArticle("https://mp.weixin.qq.com/s/example", async () => {
        calls++;
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/mp/wappoc_appmsgcaptcha?poc_token=test&target_url=test",
          },
        });
      }),
    (error) =>
      error.code === "WECHAT_VERIFICATION_REQUIRED" &&
      /不是原文链接写错/.test(error.message),
  );
  assert.equal(calls, 1, "Do not follow or retry a verification challenge");
});

test("Saved HTML imports metadata without fetching the source, including Chinese dates", () => {
  const html = fixture
    .replace(/var ct[^<]+/, "")
    .replace(
      '<span id="publish_time"></span>',
      '<span id="publish_time">2024年5月20日 20:30</span>',
    );
  const result = importSavedWechatArticle(
    html,
    "https://mp.weixin.qq.com/s/test",
  );
  assert.equal(result.title, "测试 & 公众号文章");
  assert.equal(result.date, "2024-05-20 20:30");
  assert.equal(result.source.url, "https://mp.weixin.qq.com/s/test");
  assert(!result.body.includes("var ct"));
  const fromMetadata = importSavedWechatArticle(
    fixture.replace(
      "<body>",
      '<head><meta property="og:url" content="https://mp.weixin.qq.com/s/from-file"></head><body>',
    ),
  );
  assert.equal(fromMetadata.source.url, "https://mp.weixin.qq.com/s/from-file");
  assert.equal(importSavedWechatArticle(fixture).source.url, "");
  assert.throws(
    () => importSavedWechatArticle("<h1>环境异常，请完成验证</h1>"),
    (error) => error.code === "WECHAT_VERIFICATION_REQUIRED",
  );
  assert.throws(
    () => importSavedWechatArticle(null),
    (error) => error.code === "INVALID_HTML_FILE",
  );
});

test("Missing dates stay empty, and verification pages offer a manual fallback", () => {
  const result = extractWechatArticle(
    fixture.replace(/var ct[^<]+/, ""),
    "https://mp.weixin.qq.com/s/test",
  );
  assert.equal(result.date, "");
  assert(result.warnings.length);
  assert.throws(
    () =>
      extractWechatArticle(
        "<h1>请完成验证</h1>",
        "https://mp.weixin.qq.com/s/test",
      ),
    (error) =>
      error.code === "WECHAT_VERIFICATION_REQUIRED" &&
      /导入公众号网页/.test(error.message),
  );
});

test("Saved browser pages above 2 MB import without retaining page scripts", () => {
  const padding =
    '<script type="application/json">' +
    '"\\'.repeat(2 * 1024 * 1024) +
    "</script>";
  const result = importSavedWechatArticle(
    fixture.replace("</body>", `${padding}</body>`),
  );
  assert.equal(result.title, "测试 & 公众号文章");
  assert.equal(result.date, "2024-05-20 20:30");
  assert(result.body.includes("一次探索的记录"));
  assert(
    result.body.length < 1000,
    "Whole-page scripts must not become article content",
  );
  assert.throws(
    () => importSavedWechatArticle(" ".repeat(MAX_SAVED_HTML_BYTES + 1)),
    (error) =>
      error.code === "INVALID_HTML_FILE" && /50 MB/.test(error.message),
  );
});

test("Import accepts only article URLs and refuses redirects to other hosts", async () => {
  for (const url of [
    "http://mp.weixin.qq.com/s/test",
    "https://example.com/s/test",
    "https://mp.weixin.qq.com.evil.example/s/test",
    "https://mp.weixin.qq.com/misc",
    "https://user:pass@mp.weixin.qq.com/s/test",
    "https://127.0.0.1/s/test",
  ]) {
    assert.throws(() => wechatUrl(url), /公众号文章链接/);
  }
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return new Response(null, {
      status: 302,
      headers: { Location: "http://127.0.0.1/private" },
    });
  };
  await assert.rejects(
    () => importWechatArticle("https://mp.weixin.qq.com/s/test", fetcher),
    /公众号文章链接/,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () => importWechatArticle("https://example.com/s/test", fetcher),
    /公众号文章链接/,
  );
  assert.equal(calls, 1);
  const imported = await importWechatArticle(
    "https://mp.weixin.qq.com/s/test",
    async () => new Response(fixture),
  );
  assert.equal(imported.title, "测试 & 公众号文章");
});
