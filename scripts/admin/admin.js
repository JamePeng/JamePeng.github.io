import {
  MAX_SAVED_HTML_BYTES,
  MAX_SAVED_HTML_MB,
  MAX_BODY_BYTES,
  MAX_BODY_MB,
} from "./limits.js";

(() => {
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const state = {
    token: "",
    posts: [],
    slug: null,
    revision: "",
    originalBody: "",
    bodyDirty: false,
    dirty: false,
    mode: "visual",
    filter: "all",
    busy: false,
    slugTouched: false,
    rawDate: "",
    rawUpdated: "",
    formatUndo: null,
  };
  const escape = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  let toastTimer;
  function toast(text) {
    $("#toast").textContent = text;
    $("#toast").classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => $("#toast").classList.remove("visible"),
      3500,
    );
  }
  function notice(text = "", error = false) {
    $("#verification-help").hidden = true;
    const el = $("#notice");
    el.hidden = !text;
    el.textContent = text;
    el.classList.toggle("error", error);
  }
  function dirty() {
    state.dirty = true;
    $("#save-state").textContent = "尚未保存";
    $("#save-state").classList.add("unsaved");
  }
  function canLeave() {
    return (
      !state.dirty ||
      window.confirm("有尚未保存的修改。要放弃修改并打开另一篇文章吗？")
    );
  }
  function busy(value, label) {
    state.busy = value;
    $("#post-form").inert = value;
    $("#workspace").setAttribute("aria-busy", String(value));
    $("#save-post").disabled = value;
    $("#new-post").disabled = value;
    $("#import-wechat").disabled = value;
    $("#import-saved-wechat").disabled = value;
    $("#import-saved-help").disabled = value;
    $("#auto-format-import").disabled = value;
    $("#format-article").disabled = value;
    $("#undo-format").disabled = value || state.formatUndo === null;
    $("#preview-post").disabled = value;
    $("#save-post").textContent = value
      ? label || "正在保存…"
      : "保存并生成博客 →";
  }
  async function api(
    path,
    method = "GET",
    data,
    contentType = "application/json",
  ) {
    const response = await fetch(`/api/admin/${path}`, {
      method,
      headers: {
        ...(data != null ? { "Content-Type": contentType } : {}),
        "X-Admin-Token": state.token,
      },
      body:
        data == null
          ? undefined
          : contentType === "application/json"
            ? JSON.stringify(data)
            : data,
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(result.error || "操作未完成，请重试。"), {
        code: result.code,
      });
    return result;
  }
  const slugSuggestion = (title) =>
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80)
      .replace(/-$/, "") || `article-${Date.now().toString(36)}`;
  function today() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
  function splitDate(value) {
    const parts = (value || "").replaceAll(".", "-").split(" ");
    return [parts[0] || "", parts[1] || ""];
  }
  function body() {
    return state.bodyDirty
      ? state.mode === "html"
        ? $("#body-source").value
        : $("#body-editor").innerHTML
      : state.originalBody;
  }
  function count() {
    const doc = new DOMParser().parseFromString(body(), "text/html");
    $("#word-count").textContent =
      `${doc.body.textContent.replace(/\s/g, "").length.toLocaleString()} 字`;
  }
  function clearFormatUndo() {
    state.formatUndo = null;
    $("#undo-format").disabled = true;
  }
  function replaceBody(value) {
    $("#body-editor").innerHTML = value;
    $("#body-source").value = value;
    state.bodyDirty = true;
    dirty();
    count();
  }
  function formatSummary(formatting) {
    const changes = formatting?.changes || [];
    return changes.length
      ? changes.map((item) => `${item.label} ${item.count} 处`).join("；")
      : "已应用博客阅读样式";
  }
  function importedNotice(article, fallback) {
    return [
      article.formatting?.applied
        ? `已自动整理排版：${formatSummary(article.formatting)}。`
        : fallback,
      ...(article.warnings || []),
      "请核对内容与发布时间，然后保存。",
    ].join(" ");
  }
  function drawList() {
    const query = $("#list-search").value.trim().toLowerCase();
    const visible = state.posts.filter(
      (post) =>
        `${post.title} ${post.category} ${post.displayDate} ${post.source?.name || ""}`
          .toLowerCase()
          .includes(query) &&
        (state.filter !== "wechat" ||
          post.source?.url?.startsWith("https://mp.weixin.qq.com/")),
    );
    $("#post-count").textContent = String(state.posts.length).padStart(2, "0");
    $("#post-list").replaceChildren();
    for (const post of visible) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "post-item";
      button.classList.toggle("selected", post.slug === state.slug);
      button.setAttribute("aria-label", `编辑 ${post.title}`);
      if (post.slug === state.slug) button.setAttribute("aria-current", "true");
      const eyebrow = document.createElement("span");
      eyebrow.className = "post-item-date";
      eyebrow.textContent = post.displayDate;
      const title = document.createElement("strong");
      title.textContent = post.title;
      const meta = document.createElement("span");
      meta.className = "post-item-meta";
      meta.textContent = `${post.category}${post.featured ? " · 精选" : ""}${post.source ? " · 公众号" : ""}`;
      button.append(eyebrow, title, meta);
      button.addEventListener("click", () => openExisting(post.slug));
      $("#post-list").append(button);
    }
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "list-placeholder muted";
      empty.textContent = state.posts.length
        ? "没有找到匹配的文章。"
        : "还没有文章，点击“新增文章”开始。";
      $("#post-list").append(empty);
    }
    $("#categories").replaceChildren(
      ...[...new Set(state.posts.map((post) => post.category))].map(
        (category) => {
          const option = document.createElement("option");
          option.value = category;
          return option;
        },
      ),
    );
  }
  async function refreshList() {
    state.posts = (await api("posts")).posts;
    drawList();
  }
  function load(post = {}) {
    clearFormatUndo();
    state.slug = post.slug || null;
    state.revision = post.revision || "";
    state.originalBody = post.body || "";
    state.bodyDirty = false;
    state.dirty = false;
    state.mode = "visual";
    state.slugTouched = !!post.slug;
    state.rawDate = post.date || "";
    state.rawUpdated = post.updated || "";
    $("#post-form").reset();
    $("#post-title").value = post.title || "";
    $("#post-description").value = post.description || "";
    $("#post-category").value = post.category || "随笔";
    $("#post-tags").value = (post.tags || []).join(", ");
    $("#post-featured").checked = !!post.featured;
    const [date, time] = splitDate(post.displayDate || post.date || today());
    $("#post-date").value = date;
    $("#post-time").value = time;
    $("#source-name").value = post.source?.name || "";
    $("#source-url").value = post.source?.url || "";
    $("#post-slug").value = post.slug || slugSuggestion(post.title || "");
    $("#post-slug").readOnly = !!post.slug;
    $("#post-updated").value = post.updated
      ? (post.displayUpdated || post.updated)
          .replaceAll(".", "-")
          .replace(" ", "T") +
        ((post.displayUpdated || post.updated).length === 10 ? "T00:00" : "")
      : "";
    state.loadedDate = `${date}${time ? " " + time : ""}`;
    state.loadedUpdated = $("#post-updated").value;
    $("#body-editor").innerHTML = post.editorBody || post.body || "";
    $("#body-source").value = state.originalBody;
    $("#body-editor").hidden = false;
    $("#body-source").hidden = true;
    $("#format-toolbar").hidden = false;
    $("#visual-mode").setAttribute("aria-pressed", "true");
    $("#html-mode").setAttribute("aria-pressed", "false");
    $("#editor-heading").textContent = post.slug ? "编辑文章" : "新增文章";
    $("#save-state").textContent = post.slug ? "已保存到本地" : "新文章";
    $("#save-state").classList.remove("unsaved");
    $("#permalink").hidden = !post.path;
    $("#permalink").href = post.path || "/";
    notice();
    count();
    drawList();
  }
  async function openExisting(slug) {
    if (state.busy || slug === state.slug || !canLeave()) return;
    busy(true, "正在载入…");
    try {
      load((await api(`posts/${slug}`)).post);
    } catch (error) {
      notice(error.message, true);
    } finally {
      busy(false);
    }
  }
  $("#new-post").addEventListener("click", () => {
    if (canLeave()) {
      load();
      $("#post-title").focus();
    }
  });
  $("#post-form").addEventListener("input", dirty);
  $("#post-title").addEventListener("input", () => {
    if (!state.slug && !state.slugTouched)
      $("#post-slug").value = slugSuggestion($("#post-title").value);
  });
  $("#post-slug").addEventListener("input", () => {
    state.slugTouched = true;
  });
  $("#body-editor").addEventListener("input", () => {
    clearFormatUndo();
    state.bodyDirty = true;
    dirty();
    count();
  });
  $("#body-source").addEventListener("input", () => {
    clearFormatUndo();
    state.bodyDirty = true;
    dirty();
    count();
  });
  $("#list-search").addEventListener("input", drawList);
  $$("[data-filter]").forEach((button) =>
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      $$("[data-filter]").forEach((el) =>
        el.setAttribute("aria-pressed", String(el === button)),
      );
      drawList();
    }),
  );
  async function switchMode(mode) {
    if (state.mode === mode || state.busy) return;
    const current = body();
    if (mode === "html") $("#body-source").value = current;
    else {
      try {
        $("#body-editor").innerHTML = (
          await api("preview", "POST", { body: current })
        ).body;
      } catch (error) {
        notice(error.message, true);
        return;
      }
    }
    state.mode = mode;
    $("#body-editor").hidden = mode !== "visual";
    $("#body-source").hidden = mode !== "html";
    $("#format-toolbar").hidden = mode !== "visual";
    $("#visual-mode").setAttribute("aria-pressed", String(mode === "visual"));
    $("#html-mode").setAttribute("aria-pressed", String(mode === "html"));
  }
  $("#visual-mode").addEventListener("click", () => switchMode("visual"));
  $("#html-mode").addEventListener("click", () => switchMode("html"));
  function insert(html) {
    clearFormatUndo();
    $("#body-editor").focus();
    document.execCommand("insertHTML", false, html);
    state.bodyDirty = true;
    dirty();
    count();
  }
  $$("[data-command]").forEach((button) => {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      clearFormatUndo();
      $("#body-editor").focus();
      const command = button.dataset.command;
      if (command === "heading")
        document.execCommand("formatBlock", false, "h2");
      else if (command === "quote")
        document.execCommand("formatBlock", false, "blockquote");
      else if (command === "list") document.execCommand("insertUnorderedList");
      else if (command === "code")
        insert(
          `<pre><code>${escape(getSelection()?.toString() || "在这里输入代码")}</code></pre><p><br></p>`,
        );
      else if (command === "link") {
        const url = window.prompt("填写链接地址（https://…）");
        if (url && /^https?:\/\//.test(url))
          document.execCommand("createLink", false, url);
      } else document.execCommand(command);
      state.bodyDirty = true;
      dirty();
      count();
    });
  });
  $("#body-editor").addEventListener("paste", async (event) => {
    event.preventDefault();
    const html = event.clipboardData.getData("text/html");
    const plain = event.clipboardData.getData("text/plain");
    const selection = getSelection();
    const range = selection.rangeCount
      ? selection.getRangeAt(0).cloneRange()
      : null;
    try {
      const clean = (
        await api("preview", "POST", {
          body:
            html ||
            plain
              .split(/\r?\n/)
              .map((line) => `<p>${escape(line) || "<br>"}</p>`)
              .join(""),
        })
      ).body;
      if (range) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
      insert(clean);
    } catch (error) {
      notice(error.message, true);
    }
  });
  $("#load-html").addEventListener("click", () => $("#html-file").click());
  $("#html-file").addEventListener("change", async () => {
    const file = $("#html-file").files[0];
    if (!file) return;
    if (file.size > MAX_BODY_BYTES) {
      notice(
        `正文文件超过 ${MAX_BODY_MB} MB；公众号完整网页请使用顶部“导入公众号网页”（支持 ${MAX_SAVED_HTML_MB} MB）。`,
        true,
      );
      $("#html-file").value = "";
      return;
    }
    busy(true, "正在导入正文…");
    try {
      const clean = (
        await api(
          $("#auto-format-import").checked ? "format" : "preview",
          "POST",
          { body: await file.text(), title: $("#post-title").value },
        )
      ).body;
      clearFormatUndo();
      replaceBody(clean);
      notice(
        $("#auto-format-import").checked
          ? "正文已导入并整理排版。请预览并检查发布时间后保存。"
          : "正文已导入。请检查标题和发布时间后保存。",
      );
    } catch (error) {
      notice(error.message, true);
    } finally {
      $("#html-file").value = "";
      busy(false);
    }
  });
  $("#import-wechat").addEventListener("click", async () => {
    const url = $("#wechat-url").value.trim();
    if (!url) {
      $("#wechat-url").focus();
      return;
    }
    if (!canLeave()) return;
    busy(true, "正在读取…");
    $("#import-wechat").textContent = "正在读取…";
    notice();
    try {
      const article = await api("import", "POST", {
        url,
        autoFormat: $("#auto-format-import").checked,
      });
      load({ ...article, date: article.date || today() });
      if (!article.date) $("#post-date").value = "";
      dirty();
      notice(importedNotice(article, "已读取原文。"));
    } catch (error) {
      notice(error.message, true);
      if (error.code === "WECHAT_VERIFICATION_REQUIRED") {
        const original = new URL(url);
        if (
          original.protocol === "https:" &&
          original.hostname === "mp.weixin.qq.com"
        ) {
          $("#open-wechat-original").href = original.href;
          $("#verification-help").hidden = false;
        }
      }
    } finally {
      busy(false);
      $("#import-wechat").textContent = "读取文章 →";
    }
  });
  function chooseSavedArticle() {
    if (!state.busy && canLeave()) $("#saved-wechat-file").click();
  }
  $("#import-saved-wechat").addEventListener("click", chooseSavedArticle);
  $("#import-saved-help").addEventListener("click", chooseSavedArticle);
  $("#saved-wechat-file").addEventListener("change", async () => {
    const file = $("#saved-wechat-file").files[0];
    if (!file) return;
    if (file.size > MAX_SAVED_HTML_BYTES) {
      notice(`请选择不超过 ${MAX_SAVED_HTML_MB} MB 的 HTML 网页文件。`, true);
      $("#saved-wechat-file").value = "";
      return;
    }
    busy(true, "正在导入网页…");
    notice();
    try {
      const article = await api(
        `import-html?url=${encodeURIComponent($("#wechat-url").value.trim())}&autoFormat=${$("#auto-format-import").checked}`,
        "POST",
        await file.text(),
        "text/html; charset=utf-8",
      );
      load({ ...article, date: article.date || today() });
      if (!article.date) $("#post-date").value = "";
      dirty();
      notice(importedNotice(article, "已从网页文件导入标题、发布时间和正文。"));
    } catch (error) {
      notice(error.message, true);
    } finally {
      $("#saved-wechat-file").value = "";
      busy(false);
    }
  });
  $("#format-article").addEventListener("click", async () => {
    if (state.busy) return;
    const previous = body();
    if (!previous.trim()) {
      notice("请先填写或导入正文。", true);
      return;
    }
    busy(true, "正在整理排版…");
    notice();
    try {
      const result = await api("format", "POST", {
        body: previous,
        title: $("#post-title").value,
      });
      if (result.body !== previous) {
        state.formatUndo = previous;
        replaceBody(result.body);
        notice(
          `排版已整理：${formatSummary(result)}。可预览或撤销，保存后写入博客。`,
        );
      } else notice("当前正文已经符合排版规则，无需重复整理。");
    } catch (error) {
      notice(error.message, true);
    } finally {
      busy(false);
    }
  });
  $("#undo-format").addEventListener("click", () => {
    if (state.busy || state.formatUndo === null) return;
    const previous = state.formatUndo;
    clearFormatUndo();
    replaceBody(previous);
    notice("已恢复上一次手动整理前的正文。保存后写入博客。");
  });
  function data() {
    const selectedDate =
      $("#post-date").value +
      ($("#post-time").value ? " " + $("#post-time").value : "");
    return {
      slug: $("#post-slug").value.trim(),
      revision: state.revision,
      title: $("#post-title").value,
      description: $("#post-description").value,
      date:
        state.rawDate && selectedDate === state.loadedDate
          ? state.rawDate
          : selectedDate,
      updated:
        $("#post-updated").value === state.loadedUpdated
          ? state.rawUpdated
          : $("#post-updated").value,
      category: $("#post-category").value,
      tags: $("#post-tags").value,
      source: { name: $("#source-name").value, url: $("#source-url").value },
      featured: $("#post-featured").checked,
      body: body(),
    };
  }
  $("#post-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;
    if (!body().trim()) {
      notice("请先填写文章正文。", true);
      return;
    }
    busy(true);
    notice();
    try {
      const result = await api(
        state.slug ? `posts/${state.slug}` : "posts",
        state.slug ? "PUT" : "POST",
        data(),
      );
      load(result.post);
      await refreshList();
      notice("已保存并生成本地博客。现在可以查看文章；推送到 GitHub 后上线。");
      toast(result.message);
    } catch (error) {
      notice(error.message, true);
    } finally {
      busy(false);
    }
  });
  $("#preview-post").addEventListener("click", async () => {
    try {
      const result = await api("preview", "POST", {
        title: $("#post-title").value || "文章预览",
        body: body(),
      });
      $("#preview-frame").srcdoc = result.html;
      $("#preview-dialog").showModal();
    } catch (error) {
      notice(error.message, true);
    }
  });
  $("#close-preview").addEventListener("click", () =>
    $("#preview-dialog").close(),
  );
  addEventListener("beforeunload", (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  async function init() {
    busy(true, "正在载入…");
    try {
      state.token = (await api("session")).token;
      await refreshList();
      if (state.posts.length)
        load((await api(`posts/${state.posts[0].slug}`)).post);
      else load();
    } catch (error) {
      notice(
        "未能连接本地编辑台，请确认已启动 npm run admin，然后刷新。",
        true,
      );
    } finally {
      busy(false);
    }
  }
  init();
})();
