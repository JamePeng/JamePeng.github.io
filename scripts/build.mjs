import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  unlinkSync,
  rmdirSync,
} from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { site, posts as rawPosts } from "../content/site.mjs";
import { preparePosts } from "./post-metadata.mjs";
import { renderAbout } from "./about-page.mjs";
const posts = preparePosts(rawPosts);
const root = resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(resolve(root, "content", file), "utf8");
const esc = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const write = (file, body) => {
  const path = resolve(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body + "\n");
};
const icons = {
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  external: '<path d="M7 17 17 7M7 7h10v10"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  github:
    '<path d="M9 19c-4 1-4-2-6-2m12 5v-4c0-1 .1-1.5-.5-2 3-.3 5.5-1.5 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2S17.5 3.2 15.3 5a12 12 0 0 0-6.6 0C6.5 3.2 5.4 3.6 5.4 3.6a4.3 4.3 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 10c0 4.5 2.5 5.7 5.5 6-.6.5-.5 1.4-.5 2v4"/>',
  rss: '<circle cx="5" cy="19" r="1"/><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
const textOf = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(
      /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,
      (entity, value) => {
        if (value.startsWith("#")) {
          const code =
            value[1].toLowerCase() === "x"
              ? parseInt(value.slice(2), 16)
              : Number(value.slice(1));
          return code > 0 &&
            code <= 0x10ffff &&
            !(code >= 0xd800 && code <= 0xdfff)
            ? String.fromCodePoint(code)
            : "\ufffd";
        }
        return (
          { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }[
            value.toLowerCase()
          ] || entity
        );
      },
    )
    .replace(/\s+/g, " ")
    .trim();
const minutes = (post) =>
  Math.max(1, Math.ceil(textOf(read(post.file)).length / 400));
const meta = (post) =>
  `<div class="post-meta"><span>${esc(post.category)}</span><span class="meta-dot">·</span><time datetime="${post.publishedAt}" title="发布时间（北京时间）">${post.displayDate}</time><span class="meta-dot">·</span><span>${minutes(post)} 分钟阅读</span></div>`;
const nav = (label, path, active, key) =>
  `<a href="${path}" ${active === key ? 'aria-current="page"' : ""}>${label}</a>`;
function layout({
  title = site.title,
  description = site.description,
  path = "/",
  active = "home",
  body,
  article,
}) {
  const canonical = site.url + path;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}"><meta property="og:type" content="${article ? "article" : "website"}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:site_name" content="JamePeng 的个人博客"><meta name="twitter:card" content="summary"><meta property="og:image" content="${site.url}/assets/avatar.jpg"><meta property="og:image:alt" content="JamePeng 的吉尔伽美什头像"><meta name="twitter:image" content="${site.url}/assets/avatar.jpg"><meta name="theme-color" content="#11100f"><link rel="canonical" href="${canonical}"><link rel="icon" type="image/svg+xml" href="/assets/favicon.svg"><link rel="alternate" type="application/rss+xml" title="JamePeng 的博客" href="/feed.xml">
<script>try{const t=localStorage.getItem('theme');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch{document.documentElement.dataset.theme='dark'}</script><link rel="stylesheet" href="/css/style.css"><script src="/js/main.js" defer></script>
${article ? `<meta property="article:published_time" content="${article.publishedAt}"><meta property="article:modified_time" content="${article.updatedAt}"><script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "BlogPosting", headline: article.title, description: article.description, datePublished: article.publishedAt, dateModified: article.updatedAt, ...(article.source ? { isBasedOn: article.source.url } : {}), url: canonical, author: { "@type": "Person", name: site.name, url: site.url + "/about/" } }).replaceAll("<", "\\u003c")}</script>` : ""}</head>
<body><a class="skip-link" href="#main">跳转到正文</a><div class="site-shell"><header class="site-header"><a class="brand" href="/" aria-label="JamePeng 首页"><img src="/assets/avatar.jpg" width="40" height="40" alt=""><span>JamePeng<span class="brand-dot">.</span></span></a><nav class="main-nav" aria-label="主导航">${nav("首页", "/", active, "home")}${nav("文章", "/archives/", active, "archives")}${nav("关于", "/about/", active, "about")}</nav><div class="header-actions"><button class="search-trigger icon-button" type="button" aria-label="搜索文章（Ctrl 或 Command 加 K）">${icon("search")}<kbd>Ctrl K</kbd></button><span class="action-divider"></span><button class="theme-toggle icon-button" type="button" aria-label="切换深浅主题">${icon("sun")}</button></div></header>
<main id="main" tabindex="-1">${body}</main><footer class="site-footer"><div><a class="footer-name" href="/">JamePeng.</a><span>© 2019–${new Date().getUTCFullYear()} · 技术笔记与开源记录</span></div><div class="footer-links"><a href="${site.github}" target="_blank" rel="noopener noreferrer">GitHub ${icon("external")}</a><a href="/feed.xml">RSS ${icon("rss")}</a><a href="#top" class="back-top">回到顶部 ↑</a></div></footer></div>
<dialog class="search-dialog" aria-labelledby="search-title"><div class="search-dialog-top"><h2 id="search-title">搜索文章与项目</h2><button class="search-close icon-button" aria-label="关闭搜索" type="button">${icon("close")}</button></div><div class="search-input-wrap">${icon("search")}<input id="search-input" type="search" placeholder="标题、关键词、项目名…" autocomplete="off" aria-label="搜索文章"></div><div id="search-results" aria-live="polite"></div><div class="search-hint"><span>搜索文章正文与项目记录</span><span><kbd>Esc</kbd> 关闭</span></div></dialog><div class="toast" role="status" aria-live="polite"></div></body></html>`;
}
const treasuryArt = `<div class="treasury-art"><svg class="gate-geometry" viewBox="0 0 500 500" fill="none" aria-hidden="true"><defs><linearGradient id="gate-gold" x1="30" y1="0" x2="450" y2="500"><stop stop-color="#e3c885"/><stop offset=".5" stop-color="#876233"/><stop offset="1" stop-color="#e3c885"/></linearGradient></defs><g stroke="url(#gate-gold)"><circle cx="250" cy="250" r="243" stroke-width=".6"/><circle cx="250" cy="250" r="231" stroke-width="1" stroke-dasharray="1 9"/><circle cx="250" cy="250" r="219" stroke-width=".6"/><path d="M250 0v38m0 424v38M0 250h38m424 0h38M73 73l27 27m300 300 27 27M73 427l27-27m300-300 27-27"/><path d="m250 13 11 15-11 15-11-15Zm0 444 11 15-11 15-11-15ZM13 250l15-11 15 11-15 11Zm444 0 15-11 15 11-15 11Z" fill="#bd9855"/></g></svg><div class="portrait-frame"><img class="hero-portrait" src="/assets/avatar.jpg" width="400" height="400" alt="JamePeng 的头像：金甲吉尔伽美什与雄狮" fetchpriority="high"><span class="portrait-shade" aria-hidden="true"></span><span class="portrait-corner top-left" aria-hidden="true"></span><span class="portrait-corner bottom-right" aria-hidden="true"></span><div class="portrait-caption"><span>THE GOLDEN KING</span><strong>Gilgamesh<span> / ギルガメッシュ</span></strong></div></div><div class="portrait-footnote"><span>PERSONAL EMBLEM / 01</span><span>✦</span><span>GATE OF BABYLON</span></div></div>`;
function row(post, index) {
  return `<article class="post-row" data-category="${esc(post.category)}"><span class="row-number">0${index + 1}</span><div>${meta(post)}<h3><a href="${post.path}">${esc(post.title)}</a></h3><p>${esc(post.description)}</p><div class="post-tags">${post.tags.map((t) => `<span># ${esc(t)}</span>`).join("")}</div></div><a class="row-arrow" href="${post.path}" aria-label="阅读 ${esc(post.title)}">${icon("external")}</a></article>`;
}
const featured = posts.find((p) => p.featured) ?? posts[0];
const featureHeading = (featured.cardTitle ?? [featured.title])
  .map(esc)
  .join("<br>");
const featureDescription = (featured.cardDescription ?? [featured.description])
  .map(esc)
  .join("<br>");
const home = `<section class="hero" id="top"><div class="hero-copy"><div class="eyebrow"><span class="tiny-star">✦</span> JAMEPENG / NOTES & CODE</div><p class="hero-kicker">开源维护 · 模拟器与逆向 · 本地推理</p><h1>折腾过的东西，<br><span class="hero-accent">记在这里。</span></h1><p class="hero-description">我是 JamePeng。<br>写过模拟器和主机工具，<br class="mobile-break">现在也维护本地推理项目。</p><div class="hero-links"><a class="primary-link" href="#writing">查看文章 ${icon("arrow")}</a><a class="quiet-link" href="${site.github}" target="_blank" rel="noopener noreferrer">${icon("github")} GitHub ${icon("external")}</a></div><div class="hero-footnote"><span class="status-dot"></span> 代码、工具和实践记录 <span class="since">EST. 2019</span></div></div>${treasuryArt}</section>
<div class="home-content"><div class="writing-column"><section class="featured-section"><div class="section-heading"><h2><span class="section-index">01 /</span> 精选文章</h2><span class="section-label">SELECTED POSTS</span></div><a class="featured-card" href="${featured.path}"><div class="feature-illustration" aria-hidden="true"><span class="feature-symbol">{ }</span><span class="feature-code">${esc(featured.cardLabel ?? "NOTES / CODE")}</span><span class="feature-vertical">${esc(featured.cardNote ?? "项目与实践记录")}</span><span class="feature-orbit"></span></div><div class="feature-copy"><span class="feature-badge">${esc(featured.category)} <span>↗</span></span><h3>${featureHeading}</h3><p>${featureDescription}</p><div class="feature-bottom"><time datetime="${featured.publishedAt}" title="发布时间（北京时间）">${featured.displayDate}</time><span>阅读文章 ${icon("arrow")}</span></div></div></a></section>
<section class="writing-section" id="writing"><div class="section-heading"><h2><span class="section-index">02 /</span> 文章列表</h2><a class="text-link" href="/archives/">全部归档 ${icon("arrow")}</a></div><div class="filter-bar" role="group" aria-label="按分类筛选文章"><button type="button" class="filter-chip active" data-filter="all" aria-pressed="true">全部 <span>${String(posts.length).padStart(2, "0")}</span></button>${[...new Set(posts.map((p) => p.category))].map((category) => `<button type="button" class="filter-chip" data-filter="${esc(category)}" aria-pressed="false">${esc(category)}</button>`).join("")}</div><div class="post-list">${posts.map(row).join("")}</div><p class="list-end"><span></span> JamePeng · Notes <span></span></p></section></div>
<aside class="home-sidebar"><section class="about-card"><div class="mini-label">ABOUT / JAMEPENG</div><div class="profile-line"><img class="profile-avatar" src="/assets/avatar.jpg" width="52" height="52" alt="JamePeng 的头像" loading="lazy"><div><h2>JamePeng</h2><span>写代码，也记笔记。</span></div></div><p>参与过 Citra 和主机工具开发，长期维护 llama-cpp-python。这里记录遇到的问题、解决方法，以及一些研究笔记。</p><a class="text-link" href="/about/">关于我 ${icon("arrow")}</a><div class="profile-stats"><div><strong>${String(posts.length).padStart(2, "0")}</strong><span>篇文章</span></div><div><strong>2019</strong><span>从这里开始</span></div></div></section><section class="note-card"><span class="note-pin" aria-hidden="true"></span><span class="mini-label">吉尔伽美什史诗</span><p>乌鲁克的王，<br>曾踏上寻找永生的旅程。</p><a class="note-signature" href="/about/#gilgamesh-epic">THE EPIC OF GILGAMESH ↗</a><svg viewBox="0 0 60 40" aria-hidden="true"><path d="M4 28c17-22 37-22 43-9s-25 22-19 6 25-12 28-8" fill="none" stroke="currentColor" stroke-width="1.2"/></svg></section><a class="rss-card" href="/feed.xml"><span class="rss-icon">${icon("rss")}</span><span><strong>RSS 订阅</strong><small>在阅读器中接收新文章。</small></span>${icon("external")}</a></aside></div>`;
write("index.html", layout({ body: home }));
const years = [...new Set(posts.map((p) => p.date.slice(0, 4)))];
const activeArchivePaths = [
  "",
  ...years.flatMap((year) => [
    `${year}/`,
    ...new Set(
      posts
        .filter((p) => p.date.startsWith(year))
        .map((p) => `${year}/${p.date.slice(5, 7)}/`),
    ),
  ]),
];
// Only retain archive pages that still contain articles. Article permalinks
// remain independent of publication dates.
const archiveRoot = resolve(root, "archives");
const existingArchivePaths = existsSync(archiveRoot)
  ? readdirSync(archiveRoot, { recursive: true })
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => /^(?:\d{4}\/(?:\d{2}\/)?)?index\.html$/.test(file))
      .map((file) => file.slice(0, -"index.html".length))
  : [];
for (const archive of existingArchivePaths) {
  if (activeArchivePaths.includes(archive)) continue;
  const output = resolve(archiveRoot, archive, "index.html");
  if (!output.startsWith(archiveRoot + sep))
    throw new Error("Archive path escaped its output directory");
  unlinkSync(output);
  let folder = dirname(output);
  while (folder !== archiveRoot && readdirSync(folder).length === 0) {
    rmdirSync(folder);
    folder = dirname(folder);
  }
}
for (const archive of activeArchivePaths) {
  const prefix = archive.replaceAll("/", "-").replace(/-$/, "");
  const filtered = posts.filter((p) => p.date.startsWith(prefix));
  const heading =
    prefix.length > 4
      ? `${prefix.slice(0, 4)} 年 ${Number(prefix.slice(5))} 月`
      : archive
        ? `${prefix} 年归档`
        : "文章归档";
  const groups = years
    .map((year) => {
      const group = filtered.filter((p) => p.date.startsWith(year));
      return group.length
        ? `<div class="archive-year"><h2>${year}</h2><span>${group.length} 篇记录</span></div>${group.map(row).join("")}`
        : "";
    })
    .join("");
  write(
    `archives/${archive}index.html`,
    layout({
      title: `${heading} · JamePeng`,
      path: `/archives/${archive}`,
      active: "archives",
      body: `<section class="page-heading" id="top"><div class="eyebrow">POSTS / ARCHIVE</div><h1>${heading}<span class="hero-accent">.</span></h1><p>按发布时间整理的全部文章。</p></section><div class="archive-layout"><div>${groups || '<p class="archive-empty">这个时间段暂时没有文章。可以前往全部归档继续浏览。</p>'}${archive ? '<a class="primary-link archive-back" href="/archives/">查看全部文章 →</a>' : ""}</div><aside class="archive-aside"><span class="mini-label">ARCHIVE INDEX</span><a href="/archives/">全部文章 <span>${String(posts.length).padStart(2, "0")}</span></a>${activeArchivePaths
        .filter((p) => p.split("/").length === 3)
        .map(
          (p) =>
            `<a href="/archives/${p}">${p.slice(0, 4)} 年 ${Number(p.slice(5, 7))} 月 <span>${String(posts.filter((post) => post.date.startsWith(p.slice(0, 7).replace("/", "-"))).length).padStart(2, "0")}</span></a>`,
        )
        .join(
          "",
        )}<p>日期按北京时间显示。</p></aside></div>`,
    }),
  );
}
for (const post of posts) {
  const body = read(post.file);
  const headings = [
    ...body.matchAll(/<h([1-6]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g),
  ]
    .map((m) => ({ level: Number(m[1]), id: m[2], title: textOf(m[3]) }))
    .filter((h) => h.title && h.level <= 3 && !h.title.endsWith("by JamePeng"));
  const related = posts.find((p) => p !== post);
  write(
    post.path.slice(1) + "index.html",
    layout({
      title: `${post.title} · JamePeng`,
      description: post.description,
      path: post.path,
      active: "archives",
      article: post,
      body: `<div class="reading-progress" aria-hidden="true"></div><section class="article-heading" id="top"><a class="text-link" href="/archives/">← 返回文章归档</a>${meta(post)}<h1>${esc(post.title)}</h1><p>${esc(post.description)}</p><div class="article-byline"><img class="byline-avatar" src="/assets/avatar.jpg" width="30" height="30" alt=""><span>JamePeng</span>${post.showUpdated ? `<span>最后更新于 <time datetime="${post.updatedAt}">${post.displayUpdated}</time></span>` : ""}</div>${post.source ? `<p class="article-source">原载于 <a href="${esc(post.source.url)}" target="_blank" rel="noopener noreferrer">${esc(post.source.name)} ${icon("external")}</a></p>` : ""}</section><div class="article-layout"><article class="prose">${post.slug === "instructions-ffu" ? '<aside class="historical-note"><strong>2019 年文章存档</strong><p>以下为当时的原文存档。设备支持、工具版本与外部下载链接可能已有变化，请结合当前项目说明阅读。</p></aside>' : ""}${body}<div class="article-end"><span>本文完</span><button type="button" class="copy-link text-link">复制文章链接 ${icon("external")}</button></div>${related ? `<a class="next-post" href="${related.path}"><span class="mini-label">继续阅读</span><h2>${esc(related.title)} ${icon("arrow")}</h2></a>` : ""}</article><aside class="toc"><span class="mini-label">ON THIS PAGE / 目录</span><nav aria-label="文章目录">${headings.map((h) => `<a class="toc-level-${h.level}" href="#${esc(h.id)}">${esc(h.title)}</a>`).join("")}</nav><a class="text-link toc-top" href="#top">回到顶部 ↑</a></aside></div>`,
    }),
  );
}
const aboutBody = renderAbout({
  data: JSON.parse(read("github-contributions.json")),
  portrait: treasuryArt,
  epic: read("gilgamesh.html"),
  esc,
  icon,
});
write(
  "about/index.html",
  layout({
    title: "关于 · JamePeng 的开源维护与贡献",
    description: "JamePeng 的开源与技术经历：从 Citra 的 3DS 系统服务、主机工具与逆向探索，到 llama-cpp-python 的本地推理、多模态与运行时维护，附公开提交、历史合入与 PR 记录。",
    path: "/about/",
    active: "about",
    body: aboutBody,
  }),
);
write(
  "404.html",
  layout({
    title: "页面未找到 · JamePeng",
    path: "/404.html",
    active: "",
    body: `<section class="not-found" id="top"><span class="eyebrow">404 / PAGE NOT FOUND</span><h1>这一页，<br>暂时找不到<span class="hero-accent">。</span></h1><p>地址可能有误，或页面已移除。</p><a class="primary-link" href="/">返回首页 ${icon("arrow")}</a></section>`,
  }),
);
write(
  "content.json",
  JSON.stringify({
    meta: {
      title: site.title,
      description: site.description,
      author: site.name,
      url: site.url,
      root: "/",
    },
    pages: [
      {
        title: "关于 · 开源维护与贡献",
        path: "about/",
        description: "JamePeng 的 Citra、模拟器与逆向经历、主机工具贡献，以及 llama-cpp-python 维护记录。",
        text: textOf(aboutBody),
      },
    ],
    posts: posts.map((p) => ({
      ...p,
      path: p.path.slice(1),
      permalink: site.url + p.path,
      text: textOf(read(p.file)),
    })),
  }),
);
write(
  "feed.xml",
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>JamePeng 的个人博客</title><link>${site.url}</link><description>${esc(site.description)}</description><language>zh-CN</language><atom:link href="${site.url}/feed.xml" rel="self" type="application/rss+xml"/>${posts.map((p) => `<item><title>${esc(p.title)}</title><link>${site.url}${p.path}</link><guid>${site.url}${p.path}</guid><pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate><description>${esc(p.description)}</description></item>`).join("")}</channel></rss>`,
);
const paths = [
  "/",
  "/about/",
  ...activeArchivePaths.map((p) => `/archives/${p}`),
  ...posts.map((p) => p.path),
];
write(
  "sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${site.url}${p}</loc></url>`).join("")}</urlset>`,
);
write(
  "robots.txt",
  `User-agent: *\nAllow: /\nSitemap: ${site.url}/sitemap.xml`,
);
console.log(`Built ${paths.length} pages, 404, search index, RSS and sitemap.`);
