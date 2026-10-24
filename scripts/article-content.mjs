import sanitizeHtml from "sanitize-html";
import { parseHTML } from "linkedom";

const allowedTags = [
  ...new Set([
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "figure",
    "figcaption",
    "section",
    "span",
    "div",
    "h1",
    "h2",
  ]),
];
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

export function sanitizeBody(html) {
  const { document } = parseHTML(`<html><body>${String(html)}</body></html>`);
  for (const image of document.querySelectorAll("img")) {
    const src =
      image.getAttribute("data-src") || image.getAttribute("src") || "";
    image.setAttribute("src", src.startsWith("//") ? `https:${src}` : src);
    image.setAttribute("loading", "lazy");
    image.setAttribute("referrerpolicy", "no-referrer");
  }
  const clean = sanitizeHtml(document.body.innerHTML, {
    allowedTags,
    allowedAttributes: {
      a: ["href", "title", "target", "rel"],
      img: [
        "src",
        "alt",
        "title",
        "width",
        "height",
        "loading",
        "referrerpolicy",
      ],
      figure: ["class"],
      div: ["class"],
      section: ["class"],
      p: ["class"],
      blockquote: ["class"],
      pre: ["class"],
      code: ["class"],
      span: ["class"],
      td: ["class", "colspan", "rowspan"],
      th: ["colspan", "rowspan"],
      ...Object.fromEntries(
        [1, 2, 3, 4, 5, 6].map((level) => [`h${level}`, ["id"]]),
      ),
    },
    allowedClasses: {
      div: ["article-body", "article-comparison"],
      section: ["comparison-panel"],
      p: ["article-lead", "article-kicker", "article-note"],
      blockquote: ["article-takeaway"],
    },
    allowedSchemes: ["https", "http", "mailto"],
    allowedSchemesByTag: { img: ["https", "http"] },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attributes) => ({
        tagName: "a",
        attribs: {
          ...attributes,
          ...(attributes.href?.startsWith("http")
            ? { target: "_blank", rel: "noopener noreferrer" }
            : {}),
        },
      }),
    },
  });
  const parsed = parseHTML(`<html><body>${clean}</body></html>`).document;
  let index = 0;
  const used = new Set([
    "main",
    "top",
    "search-title",
    "search-input",
    "search-results",
  ]);
  for (const heading of parsed.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
    let id = heading.getAttribute("id");
    if (!id || !/^[^\s"'<>%]{1,180}$/u.test(id) || used.has(id)) {
      do {
        id = `section-${++index}`;
      } while (used.has(id));
    }
    heading.id = id;
    used.add(id);
  }
  return parsed.body.innerHTML.trim();
}

export function plainText(html) {
  return parseHTML(`<html><body>${sanitizeBody(html)}</body></html>`)
    .document.body.textContent.replace(/\s+/g, " ")
    .trim();
}

export function previewDocument(body, title = "文章预览") {
  return `<!doctype html><html lang="zh-CN" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self'; img-src 'self' https: http:; font-src 'self'"><link rel="stylesheet" href="/css/style.css"><link rel="stylesheet" href="/admin/preview.css"></head><body><article class="prose"><h1>${escape(title)}</h1>${sanitizeBody(body)}</article></body></html>`;
}
