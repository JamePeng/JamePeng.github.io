import { parseHTML } from "linkedom";
import { sanitizeBody } from "./article-content.mjs";
import { MAX_BODY_BYTES, MAX_BODY_MB } from "./admin/limits.js";

const normalize = (value) => value.replace(/\s|\u00a0/g, "");
const major = /^[一二三四五六七八九十百]+[、.．]/u;
const method =
  /^(?:方法[一二三四五六七八九十\d]+|第[一二三四五六七八九十\d]+组)[：:、]/u;
const step = /^Step\s*\d+[：:、.]/i;
const block =
  /^(?:p|div|section|h[1-6]|ul|ol|li|pre|blockquote|figure|table|hr)$/;
const headingText = (text) => text.length <= 85 && !/[。！？!?]$/.test(text);
const captionText = (text) => /^图\s*\d+\s*[｜|：:、.．]/u.test(text);
const codeLike = (t) =>
  /^(?:WHEN|INPUT|DO|NOT|DO NOT USE ME WHEN)\s*:|^[├└│]|^Router\s+L\d|^[-*]\s+\w|^↓$/i.test(
    t,
  );
const rootAnchors = (document) =>
  [...document.querySelectorAll('a[href^="#"]')].map((n) => {
    const id = n.getAttribute("href").slice(1);
    try {
      return decodeURIComponent(id);
    } catch {
      return id;
    }
  });

/** Deterministic layout only. Does not fetch resources, rewrite prose or save files. */
export function formatArticleBody(input, { title = "" } = {}) {
  if (typeof input !== "string" || Buffer.byteLength(input) > MAX_BODY_BYTES)
    throw new Error(`正文应为文本，且不超过 ${MAX_BODY_MB} MB。`);
  const clean = sanitizeBody(input);
  const { document } = parseHTML(`<html><body>${clean}</body></html>`);
  const sourceText = normalize(document.body.textContent);
  const resources = (doc) =>
    [...doc.querySelectorAll("img,a[href]")].map((n) => [
      n.localName,
      n.getAttribute(n.localName === "img" ? "src" : "href"),
    ]);
  const sourceResources = resources(document);
  const localTargets = new Set(
    [...rootAnchors(document)].filter((id) => document.getElementById(id)),
  );
  const referenced = (n) => n.id && localTargets.has(n.id);
  const counts = new Map();
  const note = (key) => counts.set(key, (counts.get(key) || 0) + 1);
  const text = (n) => n.textContent.replace(/\u00a0/g, " ").trim();
  const element = (tag, nodes = []) => {
    const n = document.createElement(tag);
    n.append(...nodes);
    return n;
  };
  const retag = (n, tag) => {
    if (n.localName === tag) return n;
    const next = element(tag, [...n.childNodes]);
    for (const { name, value } of n.attributes) next.setAttribute(name, value);
    n.replaceWith(next);
    return next;
  };
  let root = document.body.firstElementChild;
  if (
    document.body.children.length !== 1 ||
    !root?.classList.contains("article-body")
  ) {
    root = element("div", [...document.body.childNodes]);
    root.className = "article-body";
    document.body.append(root);
    note("应用博客阅读样式");
  }
  // Keep hand-built comparison panels and figure captions intact on repeat runs.
  for (const n of [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")]) {
    if (referenced(n)) continue;
    const parts = [...n.children];
    const lines = parts.filter((part) => text(part));
    const firstMedia = parts.findIndex((part) => part.querySelector("img"));
    if (
      lines.length < 2 ||
      !lines.every((part) => codeLike(text(part))) ||
      n.querySelector("a") ||
      (firstMedia >= 0 && parts.slice(firstMedia).some((part) => text(part)))
    )
      continue;
    const code = element("code");
    code.textContent = lines.map(text).join("\n");
    const replacement = [element("pre", [code])];
    for (const img of [...n.querySelectorAll("img")])
      replacement.push(element("figure", [img]));
    n.replaceWith(...replacement);
    note("恢复代码换行");
  }

  // Some saved WeChat pages leave an outer <pre> around entire prose sections.
  // Lift those containers first; flattening them would discard figures and links.
  for (const pre of [...root.querySelectorAll("pre")]) {
    if (
      pre.querySelector("pre") ||
      (!pre.querySelector("code") &&
        pre.querySelector("p,h1,h2,h3,h4,h5,h6,figure,img,table,ul,ol"))
    ) {
      pre.replaceWith(...pre.childNodes);
      note("修正代码块包裹正文");
    }
  }
  for (const span of [...root.querySelectorAll("span:not([class])")].reverse())
    if (!span.closest("pre")) span.replaceWith(...span.childNodes);
  for (const pre of [...root.querySelectorAll("pre")]) {
    if (!pre.parentNode || pre.parentElement.closest("pre")) continue;
    if (
      pre.children.length === 1 &&
      pre.firstElementChild.localName === "code" &&
      !pre.firstElementChild.children.length
    )
      continue;
    const copy = pre.cloneNode(true);
    for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
    for (const n of [
      ...copy.querySelectorAll("p,div,section,pre,code"),
    ].reverse()) {
      if (n.nextSibling && !n.textContent.endsWith("\n")) n.append("\n");
    }
    const code = element("code");
    code.textContent = copy.textContent.replace(/\u00a0/g, " ");
    const originalCode = pre.querySelector("code");
    if (originalCode?.className) code.className = originalCode.className;
    pre.replaceChildren(code);
    note("恢复代码换行");
  }

  for (const n of [...root.querySelectorAll("div,section")].reverse()) {
    if (
      n === root ||
      !n.parentNode ||
      n.closest("pre,figure,table,.article-comparison")
    )
      continue;
    if ([...n.children].some((child) => block.test(child.localName)))
      n.replaceWith(...n.childNodes);
    else if (n.parentElement?.closest("li,p")) n.replaceWith(...n.childNodes);
    else retag(n, "p");
  }

  for (const n of [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")]) {
    if (referenced(n)) continue;
    const t = text(n);
    if (
      !t ||
      t.length > 100 ||
      [...n.children].some((c) => block.test(c.localName))
    ) {
      const replacement = retag(n, "div");
      replacement.removeAttribute("id");
      replacement.replaceWith(...replacement.childNodes);
      note("修正误识别标题");
    } else if (
      normalize(t) === normalize(title) ||
      (!major.test(t) && !method.test(t) && /[。！？!?]$/.test(t))
    ) {
      const replacement = retag(n, "p");
      replacement.removeAttribute("id");
      if (normalize(t) === normalize(title))
        replacement.className = "article-kicker";
      note("修正误识别标题");
    }
  }
  // Wrap remaining top-level inline runs after lifting multi-paragraph headings.
  let paragraph;
  for (const n of [...root.childNodes]) {
    if (n.nodeType === 1 && block.test(n.localName)) {
      paragraph = null;
      continue;
    }
    if (n.nodeType === 3 && !n.textContent.trim() && !paragraph) {
      n.remove();
      continue;
    }
    if (!paragraph) {
      paragraph = element("p");
      n.before(paragraph);
    }
    paragraph.append(n);
  }
  for (const n of [
    ...root.querySelectorAll(
      "p,h1,h2,h3,h4,h5,h6,pre,blockquote,figure,ul,ol,li",
    ),
  ].reverse()) {
    if (!text(n) && !n.querySelector("img,table") && !referenced(n)) {
      n.remove();
      note("清理空段与空标题");
    }
  }

  // Lift an explicit experiment/method label from a long paragraph without
  // dropping inline emphasis. Avoid splitting links or media between elements.
  for (const n of [...root.children]) {
    if (
      n.localName !== "p" ||
      !method.test(text(n)) ||
      text(n).length <= 100 ||
      n.querySelector("a,img,code,br")
    )
      continue;
    const cut = n.textContent.indexOf("。") + 1;
    if (cut < 1 || cut > 100) continue;
    let remaining = cut;
    function split(nodes) {
      const before = [],
        after = [];
      for (const child of nodes) {
        const length = child.textContent.length;
        if (remaining <= 0) after.push(child.cloneNode(true));
        else if (length <= remaining) {
          before.push(child.cloneNode(true));
          remaining -= length;
        } else if (child.nodeType === 3) {
          before.push(
            document.createTextNode(child.textContent.slice(0, remaining)),
          );
          after.push(
            document.createTextNode(child.textContent.slice(remaining)),
          );
          remaining = 0;
        } else {
          const [left, right] = split([...child.childNodes]);
          if (left.length) {
            const part = child.cloneNode(false);
            part.append(...left);
            before.push(part);
          }
          if (right.length) {
            const part = child.cloneNode(false);
            part.append(...right);
            after.push(part);
          }
        }
      }
      return [before, after];
    }
    const [before, after] = split([...n.childNodes]);
    n.before(element("h3", before));
    n.replaceChildren(...after);
    note("拆分明确的实验与方法小节");
  }

  let lastLevel = 1;
  let insideMethod = false;
  for (const n of [...root.children]) {
    const t = text(n);
    const isHeading = /^h[1-6]$/.test(n.localName);
    if (
      !t ||
      n.querySelector("img,pre,table") ||
      n.classList.contains("article-kicker")
    )
      continue;
    let level;
    if (headingText(t) && major.test(t)) {
      level = 2;
      insideMethod = false;
    } else if (headingText(t) && (method.test(t) || step.test(t))) {
      level = 3;
      insideMethod = method.test(t);
    } else if (isHeading)
      level =
        insideMethod && /[：:]$/.test(t)
          ? 4
          : Math.max(2, Number(n.localName[1]));
    if (level) {
      level = Math.min(level, lastLevel + 1);
      if (n.localName !== `h${level}`) {
        retag(n, `h${level}`);
        note("整理标题层级");
      }
      lastLevel = level;
    }
  }

  // A media-only paragraph is a figure; inline emoji remain next to their text.
  for (const n of [...root.querySelectorAll("p")]) {
    if (text(n) || !n.querySelector("img") || n.closest("figure,li,table"))
      continue;
    const figure = element("figure", [...n.childNodes]);
    n.replaceWith(figure);
    note("整理独立配图");
  }
  for (const figure of root.querySelectorAll("figure")) {
    const next = figure.nextElementSibling;
    if (
      !figure.querySelector("figcaption") &&
      next?.localName === "p" &&
      captionText(text(next))
    ) {
      figure.append(element("figcaption", [...next.childNodes]));
      next.remove();
      note("归并原有图注");
    }
  }

  for (const n of [...root.querySelectorAll("p")]) {
    if (
      n.closest("blockquote,li,table,figcaption,.article-comparison") ||
      !n.querySelector("br") ||
      n.querySelector("img,a")
    )
      continue;
    const copy = n.cloneNode(true);
    for (const br of copy.querySelectorAll("br")) br.replaceWith("\n");
    const lines = copy.textContent.split("\n").filter((line) => line.trim());
    if (
      lines.length >= 2 &&
      lines.filter((line) => codeLike(line.trim())).length >= 2
    ) {
      const code = element("code");
      code.textContent = copy.textContent;
      n.replaceWith(element("pre", [code]));
      note("恢复代码换行");
    }
  }
  for (const n of [...root.children]) {
    if (
      !n.parentNode ||
      n.localName !== "p" ||
      !codeLike(text(n)) ||
      n.querySelector("img,a")
    )
      continue;
    const group = [n];
    let next = n.nextElementSibling;
    while (
      next?.localName === "p" &&
      codeLike(text(next)) &&
      !next.querySelector("img,a")
    ) {
      group.push(next);
      next = next.nextElementSibling;
    }
    if (group.length < 2) continue;
    const code = element("code");
    code.textContent = group.map(text).join("\n");
    n.before(element("pre", [code]));
    for (const item of group) item.remove();
    note("整理代码模板");
  }

  for (const n of [...root.children]) {
    if (
      n.localName !== "p" ||
      n.querySelector("img,a,code,br") ||
      text(n).length > 170
    )
      continue;
    const t = text(n);
    if (
      (!t.includes("→") || /[。！？!?：:]$/.test(t)) &&
      !/^(?:h\d+\s*[-+]\s*h\d+|Strong\s*-\s*Weak|Conditional\s*-\s*Unconditional|最终状态\s*-\s*早期状态)$/i.test(
        t,
      )
    )
      continue;
    const code = element("code");
    code.textContent = n.textContent;
    n.replaceWith(element("pre", [code]));
    note("整理流程与差分表达");
  }

  // Only form a comparison when two adjacent labelled probability lists are clear.
  const probability = (n) =>
    n?.localName === "p" &&
    /^[A-Za-z][：:]\s*\d+(?:\.\d+)?%$/.test(text(n)) &&
    !n.querySelector("img,a");
  const probabilityGroup = (n) => {
    if (n?.localName !== "p" || !/[：:]$/.test(text(n)) || text(n).length > 40)
      return null;
    const items = [n];
    let next = n.nextElementSibling;
    while (probability(next) && items.length < 10) {
      items.push(next);
      next = next.nextElementSibling;
    }
    return items.length >= 3 ? { items, next } : null;
  };
  for (const n of [...root.children]) {
    if (!n.parentNode) continue;
    const first = probabilityGroup(n),
      second = first && probabilityGroup(first.next);
    if (!second || first.items.length !== second.items.length) continue;
    const comparison = element("div");
    comparison.className = "article-comparison";
    n.before(comparison);
    for (const group of [first, second]) {
      const panel = element("section");
      panel.className = "comparison-panel";
      panel.append(group.items[0]);
      const list = element("ul");
      for (const item of group.items.slice(1)) {
        list.append(element("li", [...item.childNodes]));
        item.remove();
      }
      panel.append(list);
      comparison.append(panel);
    }
    note("整理数值对照");
  }

  const mergeable = (n) =>
    n?.localName === "p" &&
    !n.className &&
    !n.querySelector("img,br,code") &&
    text(n).length <= 65 &&
    /[。！？!?]$/.test(text(n)) &&
    !/^[“「『]|^图\s*\d/.test(text(n));
  for (const n of [...root.children]) {
    if (!n.parentNode || !mergeable(n)) continue;
    let next = n.nextElementSibling;
    while (
      mergeable(n) &&
      mergeable(next) &&
      text(n).length + text(next).length <= 180
    ) {
      n.append(" ", ...next.childNodes);
      next.remove();
      note("合并相邻短段");
      next = n.nextElementSibling;
    }
  }
  const first = [...root.children].find(
    (n) =>
      text(n) &&
      !n.classList.contains("article-kicker") &&
      n.localName !== "figure",
  );
  if (
    first?.localName === "p" &&
    !first.className &&
    text(first).length >= 15 &&
    text(first).length <= 300
  ) {
    first.className = "article-lead";
    note("整理开篇引言");
  }
  const body = sanitizeBody(document.body.innerHTML);
  const checked = parseHTML(`<html><body>${body}</body></html>`).document;
  if (
    normalize(checked.body.textContent) !== sourceText ||
    JSON.stringify(resources(checked)) !== JSON.stringify(sourceResources) ||
    [...localTargets].some((id) => !checked.getElementById(id))
  )
    throw new Error(
      "未能在保留原文文字、图片和链接的情况下整理排版，请保留当前正文并手动调整。",
    );
  if (Buffer.byteLength(body) > MAX_BODY_BYTES)
    throw new Error(`整理后的正文超过 ${MAX_BODY_MB} MB，请拆分文章。`);
  return {
    body,
    changed: body !== clean,
    changes: [...counts].map(([label, count]) => ({ label, count })),
  };
}
