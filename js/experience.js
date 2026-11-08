/** Personalized experience prompt + desktop chrome helpers. */

export function createExperiencePrompt({ root, onChoose, onDismiss }) {
  const els = {
    root,
    title: root.querySelector("[data-exp-title]"),
    summary: root.querySelector("[data-exp-summary]"),
    meta: root.querySelector("[data-exp-meta]"),
    modes: root.querySelector("[data-exp-modes]"),
    skip: root.querySelector("[data-exp-skip]"),
  };

  function hide() {
    root.classList.add("hidden");
    root.setAttribute("aria-hidden", "true");
  }

  function show(analysis) {
    els.title.textContent = analysis.label;
    els.summary.textContent = analysis.summary;
    els.meta.textContent = analysis.signals.length
      ? analysis.signals.slice(0, 6).join(" · ")
      : analysis.name;

    els.modes.innerHTML = analysis.modes
      .map(
        (mode) => `
      <button type="button" class="exp-mode${mode.primary ? " is-primary" : ""}" data-mode="${mode.id}">
        <span class="exp-mode-title">${escapeHtml(mode.title)}</span>
        <span class="exp-mode-blurb">${escapeHtml(mode.blurb)}</span>
      </button>`
      )
      .join("");

    root.classList.remove("hidden");
    root.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      root.querySelector(".exp-mode.is-primary, .exp-mode")?.focus();
    });
  }

  els.modes.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    hide();
    onChoose?.(btn.getAttribute("data-mode"));
  });

  els.skip?.addEventListener("click", () => {
    hide();
    onDismiss?.();
  });

  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !root.classList.contains("hidden")) {
      hide();
      onDismiss?.();
    }
  });

  return { show, hide };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function setDesktopChrome(active, { stage, chrome, titleEl, title } = {}) {
  if (stage) stage.classList.toggle("is-desktop", Boolean(active));
  if (chrome) {
    chrome.classList.toggle("hidden", !active);
    chrome.setAttribute("aria-hidden", active ? "false" : "true");
  }
  if (titleEl && title) titleEl.textContent = title;
}

export function renderSiteTourPages({ bar, pagesEl, pages, activeIndex, onSelect }) {
  if (!bar || !pagesEl) return;
  const active = Array.isArray(pages) && pages.length > 0;
  bar.classList.toggle("hidden", !active);
  if (!active) {
    pagesEl.innerHTML = "";
    return;
  }

  pagesEl.innerHTML = pages
    .map((path, i) => {
      const name = path.split("/").pop() || path;
      const cls = [
        "site-tour-page",
        i === activeIndex ? "is-active" : "",
        i < activeIndex ? "is-done" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button type="button" class="${cls}" data-page-index="${i}" title="${escapeHtml(path)}">${escapeHtml(name)}</button>`;
    })
    .join("");

  pagesEl.onclick = (e) => {
    const btn = e.target.closest("[data-page-index]");
    if (!btn) return;
    onSelect?.(Number(btn.getAttribute("data-page-index")));
  };
}
