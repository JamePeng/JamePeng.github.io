import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { posts as rawPosts } from "../content/site.mjs";
import { preparePosts } from "./post-metadata.mjs";
const posts = preparePosts(rawPosts);
const root = resolve(import.meta.dirname, "..");
const files = [
  "index.html",
  "404.html",
  "about/index.html",
  ...readdirSync(resolve(root, "archives"), { recursive: true })
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => /^(?:\d{4}\/(?:\d{2}\/)?)?index\.html$/.test(file))
    .map((file) => `archives/${file}`),
  ...posts.map((p) => p.path.slice(1) + "index.html"),
];
let links = 0;
for (const file of files) {
  const html = readFileSync(resolve(root, file), "utf8");
  assert(html.startsWith("<!doctype html>"), `${file}: doctype`);
  assert(html.includes('lang="zh-CN"'), `${file}: language`);
  assert(
    !/yoursite\.com|hexo|hueman|jquery|google-plus|<font\b/i.test(html),
    `${file}: legacy markup`,
  );
  assert.equal(
    (html.match(/<main\b/g) || []).length,
    1,
    `${file}: main landmark`,
  );
  for (const match of html.matchAll(/(?:href|src)="(\/[^"?#]*)/g)) {
    const url = match[1];
    const target = resolve(
      root,
      "." + url + (url.endsWith("/") ? "index.html" : ""),
    );
    assert(existsSync(target), `${file}: missing local link ${url}`);
    links++;
  }
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `${file}: duplicate IDs`);
  for (const match of html.matchAll(/href="#([^"]+)"/g))
    assert(ids.includes(match[1]), `${file}: missing anchor ${match[1]}`);
  for (const match of html.matchAll(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
  ))
    JSON.parse(match[1]);
}
const search = JSON.parse(readFileSync(resolve(root, "content.json"), "utf8"));
const about = readFileSync(resolve(root, "about/index.html"), "utf8");
assert(about.includes('id="gilgamesh-epic"'), "About page must include its epic note");
assert.equal(search.posts.length, posts.length);
assert.deepEqual(
  search.posts.map((post) => post.slug),
  posts.map((post) => post.slug),
  "Search records must use publication order",
);
for (const post of posts) {
  const html = readFileSync(
    resolve(root, post.path.slice(1), "index.html"),
    "utf8",
  );
  const source = readFileSync(resolve(root, "content", post.file), "utf8");
  assert(
    html.includes(`<time datetime="${post.publishedAt}"`),
    `${post.slug}: publication time`,
  );
  const schema = JSON.parse(
    html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1],
  );
  assert.equal(schema.datePublished, post.publishedAt);
  assert.equal(schema.dateModified, post.updatedAt);
  const originalLinks = [...source.matchAll(/href="(https?:[^\"]+)"/g)].map(
    (m) => m[1],
  );
  originalLinks.forEach((link) =>
    assert(
      html.includes(`href="${link}"`),
      `Lost original article link: ${link}`,
    ),
  );
  assert(search.posts.find((p) => p.slug === post.slug).text.length > 100);
}
console.log(
  `Checked ${files.length} pages, ${links} local references, anchors, metadata, original external links and search records.`,
);
