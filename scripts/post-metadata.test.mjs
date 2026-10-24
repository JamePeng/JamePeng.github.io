import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  cpSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { parsePostDate, preparePosts } from "./post-metadata.mjs";
import { posts as livePosts } from "../content/site.mjs";
const originalPosts = [
  livePosts.find((post) => post.slug === "instructions-ffu"),
  {
    slug: "date-fixture",
    title: "日期测试文章",
    file: "date-fixture.html",
    path: "/posts/date-fixture/",
    date: "2019-04-12",
    category: "测试",
    tags: [],
    description: "用于验证文章日期、顺序与永久链接的测试数据。",
  },
];

test("Beijing dates, precise timestamps, and timezone boundaries", () => {
  assert.deepEqual(parsePostDate("2024-05-20").date, "2024-05-20");
  assert.equal(parsePostDate("2024-05-20").iso, "2024-05-19T16:00:00.000Z");
  assert.equal(parsePostDate("2024-05-20").display, "2024.05.20");
  assert.equal(
    parsePostDate("2024-05-20 20:30").iso,
    "2024-05-20T12:30:00.000Z",
  );
  assert.equal(
    parsePostDate("2024-05-20T20:30:45+08:00").display,
    "2024.05.20 20:30",
  );
  assert.equal(parsePostDate("2023-12-31T17:30:00Z").date, "2024-01-01");
  assert.equal(
    parsePostDate("2023-12-31T17:30:00Z").display,
    "2024.01.01 01:30",
  );
  assert.equal(parsePostDate("2024-02-29").date, "2024-02-29");
});

test("Invalid calendar dates fail with the article and field name", () => {
  for (const value of [
    "2023-02-29",
    "2024-02-30",
    "2024-13-01",
    "2024-00-01",
    "2024-04-31",
    "2024-05-20 24:00",
    "2024-05-20 20:60",
    "2024-05-20T20:30:61Z",
    "2024-05-20T20:30:00+99:00",
    "05/20/2024",
    "",
    null,
  ]) {
    assert.throws(
      () => parsePostDate(value, "example.date"),
      /example\.date 无效/,
    );
  }
});

test("Publication order, edit dates, and permalinks are independent", () => {
  const first = {
    slug: "earlier",
    date: "2024-05-20 09:00",
    path: "/2019/original/",
  };
  const second = {
    slug: "later",
    date: "2024-05-20 10:00",
    updated: "2020-01-01",
  };
  const result = preparePosts([first, second]);
  assert.deepEqual(
    result.map((p) => p.slug),
    ["later", "earlier"],
  );
  assert.equal(result[1].path, first.path);
  assert.equal(first.date, "2024-05-20 09:00", "Source config stays unchanged");
  assert.equal(result[0].showUpdated, false);
  assert.equal(result[0].updatedAt, result[0].publishedAt);
  assert.equal(
    preparePosts([{ ...first, updated: "2024-05-21 09:00" }])[0].showUpdated,
    true,
  );
});

test("Source links accept HTTPS and reject executable URLs", () => {
  const post = { slug: "wechat", date: "2024-05-20" };
  assert.equal(
    preparePosts([
      {
        ...post,
        source: {
          name: "微信公众号",
          url: "https://mp.weixin.qq.com/s/example",
        },
      },
    ])[0].source.name,
    "微信公众号",
  );
  assert.throws(
    () => preparePosts([{ ...post, source: { url: "javascript:alert(1)" } }]),
    /https/,
  );
  assert.throws(
    () => preparePosts([{ ...post, source: { url: "not a url" } }]),
    /https/,
  );
});

test("Changing publication dates rebuilds archives, feed, SEO and search without changing URLs", (t) => {
  const projectRoot = resolve(import.meta.dirname, "..");
  const tempBase = resolve(tmpdir());
  const fixtureRoot = mkdtempSync(join(tempBase, "blog-dates-"));
  t.after(() => {
    // Only remove this test's verified, newly created temporary directory.
    assert(fixtureRoot.startsWith(tempBase + sep + "blog-dates-"));
    rmSync(fixtureRoot, { recursive: true, force: true });
  });
  cpSync(join(projectRoot, "content"), join(fixtureRoot, "content"), {
    recursive: true,
  });
  mkdirSync(join(fixtureRoot, "scripts"));
  for (const file of ["build.mjs", "post-metadata.mjs", "about-page.mjs"])
    copyFileSync(
      join(projectRoot, "scripts", file),
      join(fixtureRoot, "scripts", file),
    );
  const build = () =>
    execFileSync(process.execPath, [join(fixtureRoot, "scripts/build.mjs")], {
      encoding: "utf8",
      stdio: "pipe",
    });
  const read = (file) => readFileSync(join(fixtureRoot, file), "utf8");
  const writePosts = (posts) =>
    writeFileSync(
      join(fixtureRoot, "content/site.mjs"),
      `export const site = ${JSON.stringify({ name: "JamePeng", title: "Test", url: "https://example.test", description: "Test", github: "https://github.com/JamePeng" })};\nexport const posts = ${JSON.stringify(posts)};\n`,
    );
  writeFileSync(
    join(fixtureRoot, "content/date-fixture.html"),
    `<p>${"用于验证日期修改后归档、搜索和订阅内容是否一致。".repeat(8)}</p>`,
  );
  writePosts(originalPosts);
  build();
  const changed = originalPosts.map((post, index) => ({
    ...post,
    date: index === 0 ? "2024-05-20 23:30" : "2025-12-31T16:01:00Z",
    updated: undefined,
    ...(index === 0
      ? {
          source: {
            name: "我的公众号",
            url: "https://mp.weixin.qq.com/s/example?a=1&b=2",
          },
        }
      : {}),
  }));
  writePosts(changed);
  build();
  const home = read("index.html");
  assert(home.includes("2024.05.20 23:30"));
  assert(
    home.indexOf('<h3><a href="' + changed[1].path) <
      home.indexOf('<h3><a href="' + changed[0].path),
    "Homepage uses publication order",
  );
  assert(existsSync(join(fixtureRoot, "archives/2024/05/index.html")));
  assert(read("archives/2026/01/index.html").includes("日期测试文章"));
  assert(!existsSync(join(fixtureRoot, "archives/2019/05/index.html")));
  const article = read(changed[0].path.slice(1) + "index.html");
  assert(article.includes('datetime="2024-05-20T15:30:00.000Z"'));
  assert(article.includes('datePublished":"2024-05-20T15:30:00.000Z"'));
  assert(
    article.includes(
      'article:published_time" content="2024-05-20T15:30:00.000Z"',
    ),
  );
  assert(article.includes("https://mp.weixin.qq.com/s/example?a=1&amp;b=2"));
  assert(article.includes("我的公众号"));
  assert(!article.includes("最后更新于"));
  const feed = read("feed.xml");
  assert(feed.includes("Mon, 20 May 2024 15:30:00 GMT"));
  assert(feed.includes(`<guid>https://example.test${changed[0].path}</guid>`));
  assert(feed.indexOf("日期测试文章") < feed.indexOf(changed[0].title));
  const search = JSON.parse(read("content.json"));
  assert.deepEqual(
    search.posts.map((p) => p.slug),
    [changed[1].slug, changed[0].slug],
  );
  assert.equal(search.posts[0].date, "2026-01-01");
  assert(!read("sitemap.xml").includes("/archives/2019/"));
  changed[0].date = "2024-02-30";
  writePosts(changed);
  assert.throws(build, /date 无效/);
  assert.equal(
    read("index.html"),
    home,
    "Invalid dates must fail before overwriting generated pages",
  );
});
