/**
 * Plays a finished page like a short assembly video.
 * Layout stays put. Components fade in from top to bottom.
 */

const DIRECTOR_CSS = `
html.gitreplay-assembling,
html.gitreplay-assembling body {
  scroll-behavior: auto !important;
}
html.gitreplay-assembling .gitreplay-piece {
  opacity: 0 !important;
}
html.gitreplay-assembling .gitreplay-piece.gitreplay-in {
  opacity: 1 !important;
  transition: opacity 0.6s ease !important;
}
html.gitreplay-assembling.gitreplay-instant .gitreplay-piece {
  transition: none !important;
}
`;

const ATOMIC_TAGS = new Set([
  "IMG",
  "VIDEO",
  "SVG",
  "CANVAS",
  "PICTURE",
  "BUTTON",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "IFRAME",
]);

function isSkippable(el) {
  const tag = el.tagName;
  return (
    tag === "SCRIPT" ||
    tag === "STYLE" ||
    tag === "LINK" ||
    tag === "META" ||
    tag === "NOSCRIPT" ||
    tag === "BR" ||
    tag === "WBR" ||
    tag === "SOURCE" ||
    tag === "TEMPLATE" ||
    tag === "HEAD"
  );
}

function isShown(el) {
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  const cs = view.getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  if (Number(cs.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  return rect.width >= 2 && rect.height >= 2;
}

function imageLabel(src) {
  if (!src || src.startsWith("data:")) return "image";
  try {
    const name = decodeURIComponent(src.split("?")[0].split("#")[0].split("/").pop() || "");
    return name || "image";
  } catch {
    return "image";
  }
}

function pieceCaption(elements) {
  const el = elements[0];
  const tag = el.tagName;
  if (elements.length > 1 && elements.every((node) => node.parentElement === el.parentElement)) {
    if (elements.some((node) => node.tagName === "IMG" || node.tagName === "VIDEO")) {
      return { label: "Placing images", detail: `${elements.length} images` };
    }
    if (elements.every((node) => node.tagName === "BUTTON" || node.tagName === "A" || node.tagName === "LI")) {
      return { label: "Placing controls", detail: `${elements.length} items` };
    }
  }
  if (tag === "IMG" || tag === "VIDEO" || tag === "PICTURE" || tag === "SVG" || tag === "CANVAS") {
    return { label: "Placing image", detail: imageLabel(el.getAttribute("src") || el.currentSrc || "") };
  }
  if (tag === "BUTTON" || el.getAttribute("role") === "button") {
    return { label: "Placing button", detail: (el.textContent || "").trim().slice(0, 42) };
  }
  if (/^H[1-6]$/.test(tag)) {
    return { label: "Adding heading", detail: (el.textContent || "").trim().slice(0, 42) };
  }
  if (tag === "P" || tag === "LI" || tag === "BLOCKQUOTE" || tag === "FIGCAPTION") {
    return { label: "Adding text", detail: (el.textContent || "").trim().slice(0, 42) };
  }
  if (tag === "NAV" || tag === "HEADER") return { label: "Placing header", detail: "" };
  if (tag === "FOOTER") return { label: "Placing footer", detail: "" };
  if (tag === "FORM") return { label: "Placing form", detail: "" };
  return { label: "Adding component", detail: (el.textContent || "").trim().slice(0, 42) };
}

function collectPieces(body) {
  const pieces = [];

  function walk(el) {
    if (!el || el.nodeType !== 1 || isSkippable(el) || !isShown(el)) return;
    const kids = [...el.children].filter((child) => !isSkippable(child) && isShown(child));
    const tag = el.tagName;

    if (ATOMIC_TAGS.has(tag) || kids.length === 0) {
      const rect = el.getBoundingClientRect();
      const text = (el.textContent || "").trim();
      if (rect.width >= 2 && rect.height >= 2 && (text || ATOMIC_TAGS.has(tag))) pieces.push(el);
      return;
    }

    for (const kid of kids) walk(kid);
  }

  for (const child of body.children) walk(child);
  return pieces;
}

function followPiece(el) {
  const view = el.ownerDocument?.defaultView;
  if (!view) return;
  const pos = view.getComputedStyle(el).position;
  if (pos === "fixed" || pos === "sticky") return;
  const rect = el.getBoundingClientRect();
  const height = view.innerHeight || 0;
  if (!height) return;
  if (rect.top >= 40 && rect.bottom <= height - 24) return;
  const top = Math.max(0, view.scrollY + rect.top - height * 0.2);
  view.scrollTo(0, top);
}

function wait(ms, isCancelled) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const poll = setInterval(() => {
      if (isCancelled()) {
        clearTimeout(timer);
        clearInterval(poll);
        resolve();
      }
    }, 32);
    setTimeout(() => clearInterval(poll), ms + 40);
  });
}

function scaled(ms, speed) {
  const pace = Math.max(0.35, Number(speed) || 1);
  return Math.max(90, Math.round(ms / pace));
}

function injectDirectorStyle(doc) {
  let style = doc.getElementById("gitreplay-director-style");
  if (!style) {
    style = doc.createElement("style");
    style.id = "gitreplay-director-style";
    doc.head?.appendChild(style);
  }
  style.textContent = DIRECTOR_CSS;
  return style;
}

/**
 * @param {Document} doc
 */
export function createVisualEditShow(doc, { scripts = [] } = {}) {
  if (!doc?.body) return null;
  injectDirectorStyle(doc);

  const pieces = collectPieces(doc.body);
  const groups = pieces.map((el) => [el]);
  const siteStyles = [...doc.querySelectorAll("style[data-gitreplay-site]")];
  const pageScripts = scripts.filter((script) => script?.content?.trim());
  if (!groups.length && !siteStyles.length && !pageScripts.length) return null;

  doc.documentElement.classList.add("gitreplay-assembling");
  for (const el of pieces) el.classList.add("gitreplay-piece");

  const beats = groups.map((group) => {
    const caption = pieceCaption(group);
    return {
      label: caption.label,
      detail: caption.detail,
      commit() {
        for (const el of group) el.classList.add("gitreplay-in");
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        for (const el of group) el.classList.add("gitreplay-in");
        followPiece(group[0]);
        await wait(scaled(240, ctx.speed), ctx.isCancelled);
      },
    };
  });

  const scriptsStarted = new Set();
  const startScripts = (index) => {
    if (index == null) {
      pageScripts.forEach((_, scriptIndex) => startScripts(scriptIndex));
      return;
    }
    if (scriptsStarted.has(index)) return;
    const script = pageScripts[index];
    if (!script?.content?.trim()) return;
    scriptsStarted.add(index);
    const el = doc.createElement("script");
    if (script.module) el.type = "module";
    el.textContent = script.content;
    doc.body.appendChild(el);
  };

  const setStyles = (count) => {
    siteStyles.forEach((style, index) => {
      if (index < count) style.removeAttribute("media");
      else style.setAttribute("media", "not all");
    });
  };

  siteStyles.forEach((style, index) => {
    const name = style.getAttribute("data-gitreplay-name") || `stylesheet ${index + 1}`;
    beats.push({
      label: "Applying styles",
      detail: name,
      commit() {
        style.removeAttribute("media");
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        style.removeAttribute("media");
        await wait(scaled(320, ctx.speed), ctx.isCancelled);
      },
    });
  });

  pageScripts.forEach((script, index) => {
    beats.push({
      label: "Starting scripts",
      detail: script.name || `script ${index + 1}`,
      commit() {
        startScripts(index);
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        startScripts(index);
        await wait(scaled(280, ctx.speed), ctx.isCancelled);
      },
    });
  });

  const pieceCount = groups.length;

  return {
    beats,
    renderInstant(count) {
      const end = Math.max(0, Math.min(beats.length, count));
      doc.documentElement.classList.add("gitreplay-instant");
      groups.forEach((group, index) => {
        for (const el of group) el.classList.toggle("gitreplay-in", index < Math.min(end, pieceCount));
      });
      const styleCount = Math.max(0, Math.min(siteStyles.length, end - pieceCount));
      setStyles(styleCount);
      const scriptStart = pieceCount + siteStyles.length;
      for (let index = 0; index < pageScripts.length; index += 1) {
        if (end > scriptStart + index) startScripts(index);
      }
      doc.documentElement.classList.remove("gitreplay-instant");
      const current = groups[Math.min(end, pieceCount) - 1]?.[0];
      if (current) followPiece(current);
    },
    cleanup() {
      doc.documentElement.classList.remove("gitreplay-assembling", "gitreplay-instant");
      doc.documentElement.style.opacity = "";
      doc.documentElement.style.transition = "";
      for (const el of pieces) el.classList.remove("gitreplay-piece", "gitreplay-in");
      setStyles(siteStyles.length);
      doc.getElementById("gitreplay-director-style")?.remove();
    },
  };
}

export async function waitForPreviewImages(doc, timeoutMs = 700) {
  const images = [...(doc.images ?? [])];
  if (!images.length) return;
  await Promise.race([
    Promise.all(
      images.map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                img.addEventListener("load", resolve, { once: true });
                img.addEventListener("error", resolve, { once: true });
              })
      )
    ),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
