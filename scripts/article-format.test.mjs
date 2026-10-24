import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { formatArticleBody } from "./article-format.mjs";
import { sanitizeBody } from "./article-content.mjs";
import {
  extractWechatArticle,
  importSavedWechatArticle,
  importWechatArticle,
} from "./wechat-import.mjs";

const documentOf = (html) =>
  parseHTML(`<html><body>${html}</body></html>`).document;
const words = (html) =>
  documentOf(html).body.textContent.replace(/\s|\u00a0/g, "");
const raw = `<h1><section>这一段是被误识别为标题的开篇文字。</section><section>这里还有第二段说明。</section></h1><h2><br></h2><p>一、循环与状态</p><p>第一句说明。</p><p>第二句说明。</p><section><img data-src="https://example.com/chart.png" alt="原图"></section><p>图 1｜原有图片说明。</p><h1>方法一：明确触发条件</h1><h3><section>WHEN: 什么时候用</section><section>INPUT: 输入是什么</section><section>NOT: 什么时候不要用</section><section><img src="https://example.com/template.png"></section></h3><pre><section><pre><code>Router L1<br>  ├── Search<br>  └── Coding</code></pre></section></pre><p><a href="https://example.com/paper?a=1&amp;b=2">原文链接</a> 保留 &lt;符号&gt; 与<strong>强调</strong>。</p>`;

test("Formatting repairs imported structure and preserves all text, media and links", () => {
  const result = formatArticleBody(raw);
  const doc = documentOf(result.body);
  assert.equal(words(result.body), words(sanitizeBody(raw)));
  assert.equal(doc.querySelectorAll(".article-body").length, 1);
  assert.equal(doc.querySelectorAll("h1,pre pre").length, 0);
  assert.equal(doc.querySelector("h2").textContent, "一、循环与状态");
  assert.equal(doc.querySelector("h3").textContent, "方法一：明确触发条件");
  assert.equal(
    doc.querySelector("figcaption").textContent,
    "图 1｜原有图片说明。",
  );
  assert.deepEqual(
    [...doc.querySelectorAll("img")].map((n) => n.getAttribute("src")),
    ["https://example.com/chart.png", "https://example.com/template.png"],
  );
  assert.equal(
    doc.querySelector("a").getAttribute("href"),
    "https://example.com/paper?a=1&b=2",
  );
  assert(doc.querySelector("strong"));
  assert(
    [...doc.querySelectorAll("pre code")].some(
      (n) =>
        n.textContent ===
        "WHEN: 什么时候用\nINPUT: 输入是什么\nNOT: 什么时候不要用",
    ),
  );
  assert(
    [...doc.querySelectorAll("pre code")].some(
      (n) => n.textContent === "Router L1\n  ├── Search\n  └── Coding",
    ),
  );
  assert(result.changed);
});

test("Formatting is idempotent and keeps an existing comparison and exact code spacing", () => {
  const first = formatArticleBody(raw);
  const second = formatArticleBody(first.body);
  assert.equal(second.body, first.body);
  assert.equal(second.changed, false);
  const code = "  const x = '<h1>';\n\n\treturn x;  \n";
  const existing = `<div class="article-body"><div class="article-comparison"><section class="comparison-panel"><p>原有对照</p></section></div><pre><code>${code.replaceAll("<", "&lt;")}</code></pre></div>`;
  const result = formatArticleBody(existing);
  const doc = documentOf(result.body);
  assert.equal(doc.querySelector("code").textContent, code);
  assert.equal(
    doc.querySelectorAll(".article-comparison .comparison-panel").length,
    1,
  );
  assert.equal(formatArticleBody(result.body).body, result.body);
});

test("Explicit experiment labels and probability comparisons become readable sections", () => {
  const prose =
    "第一组：训练损失接在 R3。" +
    "相同数据上的实验结果和边界都应保留。".repeat(8);
  const input = `<h2>一、结果</h2><p><strong>${prose.slice(0, 18)}</strong>${prose.slice(18)}</p><p>模型最开始觉得：</p><p>A：40%</p><p>B：60%</p><p>经过更多循环以后变成：</p><p>A：55%</p><p>B：45%</p>`;
  const result = formatArticleBody(input);
  const doc = documentOf(result.body);
  assert.equal(words(result.body), words(input));
  assert.equal(
    doc.querySelector("h3").textContent,
    "第一组：训练损失接在 R3。",
  );
  assert.equal(doc.querySelectorAll(".comparison-panel").length, 2);
  assert.equal(doc.querySelectorAll(".comparison-panel li").length, 4);
  assert.equal(formatArticleBody(result.body).body, result.body);
});

test("Ambiguous prose, lists and tables are preserved without inventing captions", () => {
  const input =
    '<p>图灵机与循环网络都是本段文字讨论的内容。</p><p>这一段包含<strong>重点</strong>，还有普通说明。</p><ul><li>原有列表</li></ul><table><tr><td>原有数据</td><td>42</td></tr></table><p>正文<img src="https://example.com/emoji.png">中的图片保留在行内。</p>';
  const doc = documentOf(formatArticleBody(input).body);
  assert.equal(doc.querySelectorAll("figcaption,h2,h3").length, 0);
  assert.equal(doc.querySelectorAll("table td").length, 2);
  assert.equal(doc.querySelectorAll("ul li").length, 1);
  assert(doc.querySelector("p img"));
  assert.equal(words(doc.body.innerHTML), words(input));
});

test("Internal article links keep their heading targets during cleanup", () => {
  const input =
    '<p><a href="#explanation">跳转到说明</a> · <a href="#empty">原有锚点</a></p><h1 id="explanation">这是原本被当作标题的完整说明句子。</h1><h2 id="empty"><br></h2><p>后续正文。</p>';
  const result = formatArticleBody(input);
  const doc = documentOf(result.body);
  assert(doc.getElementById("explanation"));
  assert(doc.getElementById("empty"));
  assert.equal(
    doc.querySelector('a[href="#explanation"]').textContent,
    "跳转到说明",
  );
  assert.equal(words(result.body), words(input));
  assert.equal(formatArticleBody(result.body).body, result.body);
});

test("Malformed WeChat code containers retain surrounding prose, images and command lines", () => {
  const input =
    '<pre><section><ul><li></li><li></li></ul><pre class="code-snippet__js"><code><span>git clone https://example.com/project.git</span></code><code><span>cd project</span></code></pre><p>这是代码后原本的正文。</p><p><a href="https://example.com/docs">完整说明</a></p></section></pre><pre><section><p>结语：保留原文观点。</p><section><img src="https://example.com/figure.png"></section></section></pre>';
  const result = formatArticleBody(input);
  const doc = documentOf(result.body);
  assert.equal(words(result.body), words(input));
  assert.equal(
    doc.querySelector("pre code").textContent,
    "git clone https://example.com/project.git\ncd project",
  );
  assert.equal(doc.querySelectorAll("pre").length, 1);
  assert.equal(doc.querySelectorAll("pre img,pre a,pre p,pre pre").length, 0);
  assert(doc.querySelector('figure img[src="https://example.com/figure.png"]'));
  assert.equal(
    doc.querySelector("a").getAttribute("href"),
    "https://example.com/docs",
  );
  assert.equal(formatArticleBody(result.body).body, result.body);
});

test("Lifted prose is stable and empty video controls do not count as article links", () => {
  const input =
    '<pre><section><p><b><span><span>这是被包裹的正文标题</span></span></b></p><p><span>完整说明与数据都保留。</span></p><p><a></a><a></a><a>播放</a><a>倍速</a></p><p><a href="https://example.com/reference">引用资料</a></p><img src="https://example.com/last-image.png"></section></pre>';
  const first = formatArticleBody(input);
  const second = formatArticleBody(first.body);
  const doc = documentOf(first.body);
  assert.equal(words(first.body), words(input));
  assert.equal(second.body, first.body);
  assert.equal(doc.querySelectorAll("a[href]").length, 1);
  assert.equal(
    doc.querySelector("a[href]").getAttribute("href"),
    "https://example.com/reference",
  );
  assert(doc.querySelector('img[src="https://example.com/last-image.png"]'));
});

test("Both WeChat import paths format by default and allow an explicit opt-out", async () => {
  const fixture = `<html><body><h1 id="activity-name">测试标题</h1><span id="publish_time">2024-05-20 20:30</span><div id="js_content">${raw}</div></body></html>`;
  for (const result of [
    extractWechatArticle(fixture, "https://mp.weixin.qq.com/s/test"),
    importSavedWechatArticle(fixture),
    await importWechatArticle(
      "https://mp.weixin.qq.com/s/test",
      async () => new Response(fixture),
    ),
  ]) {
    assert(result.body.includes('class="article-body"'));
    assert.equal(result.date, "2024-05-20 20:30");
    assert.equal(result.formatting.applied, true);
    assert(result.description.startsWith("这一段是被误识别为标题的开篇文字。"));
    assert(!result.description.includes("Router"));
    assert(!result.description.includes("一、循环与状态"));
  }
  for (const result of [
    extractWechatArticle(fixture, "", { autoFormat: false }),
    importSavedWechatArticle(fixture, "", { autoFormat: false }),
    await importWechatArticle(
      "https://mp.weixin.qq.com/s/test",
      async () => new Response(fixture),
      { autoFormat: false },
    ),
  ]) {
    assert(!result.body.includes('class="article-body"'));
    assert.equal(result.body, sanitizeBody(raw));
    assert.equal(result.formatting.applied, false);
  }
});
