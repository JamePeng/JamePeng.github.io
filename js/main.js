(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [
    ...root.querySelectorAll(selector),
  ];
  const themeButton = $(".theme-toggle");
  const isDark = () =>
    document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : true;
  const syncTheme = () => {
    themeButton.setAttribute(
      "aria-label",
      isDark() ? "切换为浅色主题" : "切换为深色主题",
    );
    $('meta[name="theme-color"]').content = isDark() ? "#11100f" : "#f6f1e7";
  };
  syncTheme();
  $(".search-trigger kbd").textContent = /Mac|iPhone|iPad/.test(
    navigator.platform,
  )
    ? "⌘ K"
    : "Ctrl K";
  themeButton.addEventListener("click", () => {
    const theme = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* Theme still works without storage. */
    }
    syncTheme();
  });
  $$(".filter-chip").forEach((button) =>
    button.addEventListener("click", () => {
      $$(".filter-chip").forEach((chip) => {
        const active = chip === button;
        chip.classList.toggle("active", active);
        chip.setAttribute("aria-pressed", String(active));
      });
      $$(".post-row").forEach((row) => {
        row.hidden =
          button.dataset.filter !== "all" &&
          row.dataset.category !== button.dataset.filter;
      });
    }),
  );
  const dialog = $(".search-dialog");
  const input = $("#search-input");
  const results = $("#search-results");
  let searchData,
    searchPromise,
    searchError = false;
  const message = (text) => {
    const p = document.createElement("p");
    p.className = "search-empty";
    p.textContent = text;
    results.replaceChildren(p);
  };
  function renderSearch() {
    results.replaceChildren();
    if (searchError) {
      message("搜索加载失败，请重试或查看文章归档。");
      return;
    }
    if (!searchData) {
      message("正在加载搜索索引…");
      return;
    }
    const terms = input.value
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const entries = [...searchData.posts, ...(searchData.pages ?? [])];
    const matches = entries.filter((post) =>
      terms.every((term) =>
        `${post.title} ${post.description ?? ""} ${post.text} ${(post.tags ?? []).join(" ")}`
          .toLocaleLowerCase()
          .includes(term),
      ),
    );
    if (!matches.length) {
      message(`没有找到“${input.value.trim()}”。换一个关键词试试？`);
      return;
    }
    matches.forEach((post) => {
      const link = document.createElement("a");
      link.className = "search-result";
      link.href = "/" + post.path;
      const title = document.createElement("strong");
      title.textContent = post.title;
      const text = document.createElement("p");
      text.textContent = post.description;
      link.append(title, text);
      results.append(link);
    });
  }
  function openSearch() {
    if (!dialog.open) dialog.showModal();
    input.focus();
    if (!searchData && !searchPromise) {
      searchError = false;
      searchPromise = fetch("/content.json")
        .then((response) => {
          if (!response.ok) throw new Error("Search index unavailable");
          return response.json();
        })
        .then((data) => {
          searchData = data;
        })
        .catch(() => {
          searchError = true;
        })
        .finally(() => {
          searchPromise = null;
          renderSearch();
        });
    }
    renderSearch();
  }
  $(".search-trigger").addEventListener("click", openSearch);
  $(".search-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
    }
  });
  input.addEventListener("input", renderSearch);
  let toastTimer;
  function toast(text) {
    const el = $(".toast");
    el.textContent = text;
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 2500);
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制。");
      return true;
    } catch {
      toast("复制失败，请从地址栏或正文手动复制。");
      return false;
    }
  }
  $(".copy-link")?.addEventListener("click", () => copy(location.href));
  $$(".prose pre").forEach((pre) => {
    const code = $("code", pre);
    if (!code) return;
    const button = document.createElement("button");
    button.className = "code-copy";
    button.type = "button";
    button.textContent = "复制";
    button.setAttribute("aria-label", "复制代码");
    button.addEventListener("click", async () => {
      if (await copy(code.textContent.trim())) {
        button.textContent = "已复制";
        setTimeout(() => {
          button.textContent = "复制";
        }, 1800);
      }
    });
    pre.append(button);
  });
  const progress = $(".reading-progress");
  if (progress) {
    let ticking = false;
    const update = () => {
      const distance = document.documentElement.scrollHeight - innerHeight;
      progress.style.width = `${distance > 0 ? Math.min(100, Math.max(0, (scrollY / distance) * 100)) : 100}%`;
      ticking = false;
    };
    addEventListener(
      "scroll",
      () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true },
    );
    addEventListener("resize", update);
    update();
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (entry.isIntersecting)
              $$(".toc nav a").forEach((link) =>
                link.classList.toggle(
                  "active",
                  decodeURIComponent(link.hash.slice(1)) === entry.target.id,
                ),
              );
          }),
        { rootMargin: "0px 0px -65% 0px" },
      );
      $$(".prose [id]").forEach((heading) => observer.observe(heading));
    }
  }
})();
