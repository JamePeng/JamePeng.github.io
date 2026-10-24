import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sanitizeBody, previewDocument } from "./article-content.mjs";
import { createArticleStore } from "./article-store.mjs";
import { createBlogServer } from "./serve.mjs";
import { adminFixture } from "./admin-test-fixture.mjs";
import { WechatImportError } from "./wechat-import.mjs";
import { MAX_BODY_BYTES } from "./admin/limits.js";

const newPost = () => ({
  slug: "wechat-test",
  title: "从公众号搬来的文章",
  date: "2024-05-20 20:30",
  updated: "",
  category: "随笔",
  tags: "博客，公众号, 博客",
  description: "",
  body: '<h2>一次新的探索</h2><p>保存这篇文章的正文。</p><script>alert("bad")</script><img src="https://example.com/image.jpg" onerror="alert(1)">',
  source: { name: "我的公众号", url: "https://mp.weixin.qq.com/s/example" },
  featured: false,
});

test("Pasted HTML retains readable structure while removing active content", () => {
  const result = sanitizeBody(
    '<h2 id="main">标题</h2><p style="display:none" onclick="alert(1)">正文<strong>粗体</strong></p><script>alert(1)</script><iframe src="https://example.com"></iframe><img data-src="https://mmbiz.qpic.cn/test.jpg" onerror="alert(1)"><a href="javascript:alert(1)">链接</a>',
  );
  assert(result.includes('<h2 id="section-1">标题</h2>'));
  assert(result.includes("<strong>粗体</strong>"));
  assert(result.includes('src="https://mmbiz.qpic.cn/test.jpg"'));
  assert(!/onclick|onerror|javascript:|<script|<iframe|style=/.test(result));
  assert(result.includes('referrerpolicy="no-referrer"'));
  const preview = previewDocument("<p>预览</p>", "<script>标题</script>");
  assert(preview.includes("&lt;script&gt;标题&lt;/script&gt;"));
  assert(preview.includes("default-src 'none'"));
  const formatted = sanitizeBody(
    '<div class="article-body"><p class="article-lead">引言</p><div class="article-comparison"><section class="comparison-panel"><p>对比</p></section></div><figure><img src="https://example.com/chart.png"><figcaption>原图说明</figcaption></figure><pre><code>Router L1\n  ├── Search\n  └── Coding</code></pre></div>',
  );
  assert(formatted.includes('class="article-body"'));
  assert(formatted.includes('class="article-comparison"'));
  assert(formatted.includes('class="comparison-panel"'));
  assert(formatted.includes("<figcaption>原图说明</figcaption>"));
  assert(formatted.includes("Router L1\n  ├── Search\n  └── Coding"));
});

test("Creating and editing an article persists files and regenerates the public site", async (t) => {
  const root = adminFixture(t);
  const store = createArticleStore(root);
  const created = await store.save(newPost());
  assert.equal(created.post.slug, "wechat-test");
  assert.equal(created.post.path, "/posts/wechat-test/");
  assert.deepEqual(created.post.tags, ["博客", "公众号"]);
  assert(!created.post.body.includes("<script"));
  assert(existsSync(join(root, "posts/wechat-test/index.html")));
  assert(
    readFileSync(join(root, "archives/2024/05/index.html"), "utf8").includes(
      "从公众号搬来的文章",
    ),
  );
  const changed = await store.save(
    { ...created.post, date: "2026-01-01 00:01", body: created.post.body },
    created.post.slug,
  );
  assert.equal(changed.post.path, created.post.path);
  assert.equal(store.list()[0].slug, "wechat-test");
  assert(!existsSync(join(root, "archives/2024/05/index.html")));
  assert(
    readFileSync(join(root, "feed.xml"), "utf8").includes(
      "Wed, 31 Dec 2025 16:01:00 GMT",
    ),
  );
  assert(readdirSync(join(root, ".local-backups")).length === 2);
  await assert.rejects(
    () =>
      store.save(
        { ...created.post, title: "过期窗口的修改" },
        created.post.slug,
      ),
    (error) => error.status === 409,
  );
});

test("Date-only edits preserve old HTML bytes, custom featured metadata, and original URL", async (t) => {
  const root = adminFixture(t);
  const store = createArticleStore(root);
  const original = store.get("instructions-ffu");
  const result = await store.save(
    { ...original, date: "2026-01-01", body: original.body },
    original.slug,
  );
  assert.equal(result.post.path, original.path);
  assert.equal(
    readFileSync(join(root, "content", original.file), "utf8"),
    original.body,
  );
  assert.deepEqual(result.post.cardTitle, original.cardTitle);
  assert.equal(result.post.updated, original.updated);
  assert.equal(result.post.displayUpdated, "2019.06.03");
});

test("Validation and failed builds leave the saved articles intact", async (t) => {
  const root = adminFixture(t);
  const read = () => readFileSync(join(root, "content/posts.json"), "utf8");
  const original = read();
  const store = createArticleStore(root, {
    build: async () => {
      throw new Error("build failed");
    },
  });
  await assert.rejects(
    () => store.save({ ...newPost(), slug: "../escape" }),
    /链接名称/,
  );
  await assert.rejects(
    () => store.save({ ...newPost(), date: "2024-02-30" }),
    /date 无效/,
  );
  await assert.rejects(
    () => store.save({ ...newPost(), body: "<script>alert(1)</script>" }),
    /正文/,
  );
  assert.equal(read(), original);
  await assert.rejects(() => store.save(newPost()), /源文件已恢复/);
  assert.equal(read(), original);
  assert(!existsSync(join(root, "content/wechat-test.html")));
  const existing = store.get("instructions-ffu");
  await assert.rejects(
    () =>
      store.save(
        { ...existing, title: "不应写入的更改", body: "<p>变更</p>" },
        existing.slug,
      ),
    /源文件已恢复/,
  );
  assert.equal(read(), original);
  assert.equal(store.get(existing.slug).body, existing.body);
});

test("The local HTTP editor enforces origin/session checks and saves through its API", async (t) => {
  const root = adminFixture(t);
  const server = createBlogServer(root, {
    importer: async (url) => {
      if (url.endsWith("/verification"))
        throw new WechatImportError(
          "微信要求浏览器验证。",
          "WECHAT_VERIFICATION_REQUIRED",
        );
      return {
        title: "读取结果",
        body: "<p>正文</p>",
        date: "2024-05-20",
        source: { name: "公众号", url: "https://mp.weixin.qq.com/s/test" },
      };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(base + "/api/admin/session")).json();
  const write = (path, data, extra = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Admin-Token": session.token,
        ...extra,
      },
      body: JSON.stringify(data),
    });
  assert.equal((await fetch(base + "/admin/")).status, 200);
  assert.equal((await fetch(base + "/admin/preview.css")).status, 200);
  assert.equal((await fetch(base + "/admin/limits.js")).status, 200);
  assert.equal((await fetch(base + "/content/posts.json")).status, 404);
  assert.equal(
    (
      await fetch(base + "/api/admin/posts", {
        headers: { Origin: "https://other.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await write("/api/admin/posts", newPost(), { "X-Admin-Token": "wrong" }))
      .status,
    403,
  );
  assert.equal(
    (
      await write("/api/admin/posts", newPost(), {
        "Content-Type": "text/plain",
      })
    ).status,
    415,
  );
  const response = await write("/api/admin/posts", newPost());
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).post.date, "2024-05-20 20:30");
  assert.equal((await fetch(base + "/posts/wechat-test/")).status, 200);
  assert.equal((await write("/api/admin/posts", newPost())).status, 409);
  const importResult = await write("/api/admin/import", {
    url: "https://mp.weixin.qq.com/s/test",
  });
  assert.equal((await importResult.json()).title, "读取结果");
  const blocked = await write("/api/admin/import", {
    url: "https://mp.weixin.qq.com/s/verification",
  });
  assert.equal(blocked.status, 422);
  assert.equal((await blocked.json()).code, "WECHAT_VERIFICATION_REQUIRED");
  const beforeImport = readFileSync(join(root, "content/posts.json"), "utf8");
  const fromFile = await fetch(
    base +
      "/api/admin/import-html?url=" +
      encodeURIComponent("https://mp.weixin.qq.com/s/from-file"),
    {
      method: "POST",
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Admin-Token": session.token,
      },
      body: '<h1 id="activity-name">已保存的公众号文章</h1><span id="js_name">我的公众号</span><span id="publish_time">2024-05-20 20:30</span><div id="js_content"><p>由作者选择并上传的网页正文。</p></div>',
    },
  );
  assert.equal(fromFile.status, 200);
  const imported = await fromFile.json();
  assert.equal(imported.title, "已保存的公众号文章");
  assert.equal(imported.date, "2024-05-20 20:30");
  assert.equal(imported.formatting.applied, true);
  const unformattedResponse = await fetch(
    base + "/api/admin/import-html?autoFormat=false",
    {
      method: "POST",
      headers: { "Content-Type": "text/html", "X-Admin-Token": session.token },
      body: '<div id="js_content"><h1><br></h1><p>一、保留导入结构</p><p>导入正文。</p></div>',
    },
  );
  assert.equal(unformattedResponse.status, 200);
  const unformatted = await unformattedResponse.json();
  assert.equal(unformatted.formatting.applied, false);
  assert(!unformatted.body.includes('class="article-body"'));
  assert.equal(
    readFileSync(join(root, "content/posts.json"), "utf8"),
    beforeImport,
    "File selection must not overwrite or publish an existing article",
  );
  const preview = await (
    await write("/api/admin/preview", {
      body: '<p onclick="alert(1)">预览</p>',
    })
  ).json();
  assert(!preview.body.includes("onclick"));
  const beforeFormat = readFileSync(join(root, "content/posts.json"), "utf8");
  const originalPost = await (
    await fetch(base + "/api/admin/posts/wechat-test")
  ).json();
  const formatResponse = await write("/api/admin/format", {
    body: "<h1><br></h1><p>一、整理标题</p><p>测试正文。</p>",
    title: "测试",
  });
  assert.equal(formatResponse.status, 200);
  const formatted = await formatResponse.json();
  assert(formatted.body.includes('<h2 id="'));
  assert(formatted.body.includes('class="article-body"'));
  assert.equal(
    readFileSync(join(root, "content/posts.json"), "utf8"),
    beforeFormat,
  );
  assert.deepEqual(
    await (await fetch(base + "/api/admin/posts/wechat-test")).json(),
    originalPost,
    "Formatting must not alter the saved body, title, dates, source or revision",
  );
  assert.equal(
    (
      await write(
        "/api/admin/format",
        { body: "<p>正文</p>" },
        { "X-Admin-Token": "wrong" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await write(
        "/api/admin/format",
        { body: "<p>正文</p>" },
        { Origin: "https://other.example" },
      )
    ).status,
    403,
  );
});

test("Large saved pages import, preview and save through HTTP without the old size limits", async (t) => {
  const root = adminFixture(t);
  // Size handling is independent of generation; the existing save test checks real builds.
  const server = createBlogServer(root, { build: async () => {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(base + "/api/admin/session")).json();
  const send = (
    path,
    body,
    contentType = "application/json",
    authenticated = true,
  ) =>
    fetch(base + "/api/admin/" + path, {
      method: "POST",
      headers: {
        "Content-Type": contentType,
        ...(authenticated ? { "X-Admin-Token": token } : {}),
      },
      body: contentType === "application/json" ? JSON.stringify(body) : body,
    });
  assert.equal(
    (await send("import-html", "<p>test</p>", "text/html", false)).status,
    403,
  );
  assert.equal(
    (await send("import-html", { html: "<p>test</p>" })).status,
    415,
  );
  const body = `<p>${"正文".repeat(370000)}</p>`;
  const html = `<html><body><h1 id="activity-name">大文件导入回归</h1><span id="publish_time">2024-05-20 20:30</span><div id="js_content">${body}</div><script>${'"\\'.repeat(2 * 1024 * 1024)}</script></body></html>`;
  assert(Buffer.byteLength(body) > 2 * 1024 * 1024);
  assert(Buffer.byteLength(html) > 3 * 1024 * 1024);
  const result = await send(
    "import-html?url=https%3A%2F%2Fmp.weixin.qq.com%2Fs%2Ftest",
    html,
    "text/html; charset=utf-8",
  );
  assert.equal(result.status, 200, await result.clone().text());
  const article = await result.json();
  assert(article.body.includes(body));
  assert.equal(article.formatting.applied, true);
  assert.equal(article.date, "2024-05-20 20:30");
  const preview = await send("preview", {
    title: article.title,
    body: article.body,
  });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).body, article.body);
  const saved = await send("posts", { ...newPost(), ...article });
  assert.equal(saved.status, 200, await saved.clone().text());
  const savedPost = (await saved.json()).post;
  assert.equal(
    readFileSync(join(root, "content", savedPost.file), "utf8"),
    article.body,
  );
  const beforeRejectedSave = readFileSync(
    join(root, "content/posts.json"),
    "utf8",
  );
  const oversizedBody = " ".repeat(MAX_BODY_BYTES + 1);
  assert.equal((await send("preview", { body: oversizedBody })).status, 413);
  const rejected = await send("posts", {
    ...newPost(),
    slug: "oversized",
    body: oversizedBody,
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /10 MB/);
  assert.equal(
    readFileSync(join(root, "content/posts.json"), "utf8"),
    beforeRejectedSave,
  );
});
