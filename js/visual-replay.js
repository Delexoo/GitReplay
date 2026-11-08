/**
 * Assembles a finished page one small piece at a time.
 * Containers are placed, then text is typed and media is fixed inside them.
 * Layout stays put: pieces only change opacity, so the page does not jump.
 */

import { revealLandingPage } from "./preview.js";

const DIRECTOR_CSS = `
html.gitreplay-assembling,
html.gitreplay-assembling body {
  scroll-behavior: auto !important;
}
html.gitreplay-assembling .gitreplay-box {
  opacity: 0 !important;
}
html.gitreplay-assembling .gitreplay-box.gitreplay-in {
  opacity: 1 !important;
  transition: opacity 0.45s ease !important;
}
html.gitreplay-assembling span.gitreplay-ch {
  display: inline !important;
  position: static !important;
  float: none !important;
  clear: none !important;
  width: auto !important;
  height: auto !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  transform: none !important;
  letter-spacing: inherit !important;
  font: inherit !important;
  color: inherit !important;
  line-height: inherit !important;
  vertical-align: baseline !important;
  opacity: 0;
}
html.gitreplay-assembling span.gitreplay-ch.gitreplay-in {
  opacity: 1;
  transition: opacity 0.04s linear;
}
html.gitreplay-assembling.gitreplay-instant .gitreplay-box,
html.gitreplay-assembling.gitreplay-instant span.gitreplay-ch {
  transition: none !important;
}
html.gitreplay-assembling [data-gitreplay-loader] {
  display: none !important;
  visibility: hidden !important;
  animation: none !important;
}
`;

const ATOMIC_TAGS = new Set([
  "IMG",
  "VIDEO",
  "SVG",
  "CANVAS",
  "PICTURE",
  "IFRAME",
  "INPUT",
  "TEXTAREA",
  "SELECT",
]);

const FRAME_TAGS = new Set([
  "P",
  "LI",
  "BLOCKQUOTE",
  "FIGCAPTION",
  "PRE",
  "TD",
  "TH",
  "DT",
  "DD",
  "LABEL",
  "LEGEND",
  "CAPTION",
  "BUTTON",
  "A",
  "SUMMARY",
  "HEADER",
  "FOOTER",
  "NAV",
  "MAIN",
  "SECTION",
  "ARTICLE",
  "ASIDE",
  "FORM",
  "UL",
  "OL",
  "TABLE",
  "FIGURE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);

const TEXT_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "email",
  "url",
  "tel",
  "password",
  "number",
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
  if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
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

function boxCaption(el) {
  const tag = el.tagName;
  if (tag === "IMG" || tag === "VIDEO" || tag === "PICTURE" || tag === "SVG" || tag === "CANVAS") {
    return { label: "Placing image", detail: imageLabel(el.getAttribute("src") || el.currentSrc || "") };
  }
  if (tag === "IFRAME") return { label: "Placing embed", detail: "" };
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return { label: "Placing field", detail: el.getAttribute("placeholder") || el.getAttribute("name") || "" };
  }
  if (tag === "BUTTON" || el.getAttribute("role") === "button") {
    return { label: "Placing button", detail: "" };
  }
  if (tag === "A") return { label: "Placing link", detail: "" };
  if (/^H[1-6]$/.test(tag)) return { label: "Placing heading", detail: "" };
  if (tag === "P" || tag === "BLOCKQUOTE" || tag === "FIGCAPTION" || tag === "PRE") {
    return { label: "Placing text", detail: "" };
  }
  if (tag === "LI" || tag === "DT" || tag === "DD") return { label: "Placing item", detail: "" };
  if (tag === "NAV" || tag === "HEADER") return { label: "Placing header", detail: "" };
  if (tag === "FOOTER") return { label: "Placing footer", detail: "" };
  if (tag === "FORM") return { label: "Placing form", detail: "" };
  if (tag === "UL" || tag === "OL") return { label: "Placing list", detail: "" };
  const aria = el.getAttribute("aria-label");
  if (aria) return { label: "Placing container", detail: aria.trim().slice(0, 42) };
  return { label: "Placing container", detail: "" };
}

function hasOwnChrome(cs) {
  const bg = cs.backgroundColor || "";
  const painted = bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)";
  const image = cs.backgroundImage && cs.backgroundImage !== "none";
  const shadow = cs.boxShadow && cs.boxShadow !== "none";
  const outline = (parseFloat(cs.outlineWidth) || 0) > 0 && cs.outlineStyle !== "none";
  const radius = (parseFloat(cs.borderTopLeftRadius) || 0) > 0;
  let border = false;
  let padded = false;
  for (const side of ["Top", "Right", "Bottom", "Left"]) {
    if ((parseFloat(cs[`border${side}Width`]) || 0) > 0 && cs[`border${side}Style`] !== "none") border = true;
    if ((parseFloat(cs[`padding${side}`]) || 0) >= 12) padded = true;
  }
  const gap = Math.max(parseFloat(cs.rowGap) || 0, parseFloat(cs.columnGap) || 0, parseFloat(cs.gap) || 0);
  return painted || image || shadow || outline || radius || border || padded || gap >= 8;
}

function shouldPlace(el, cs) {
  if (ATOMIC_TAGS.has(el.tagName) || FRAME_TAGS.has(el.tagName)) return true;
  if (el.getAttribute("role") === "button") return true;
  return hasOwnChrome(cs);
}

function isInlineDisplay(display) {
  return (
    display === "inline" ||
    display === "inline-block" ||
    display === "inline-flex" ||
    display === "inline-grid" ||
    display === "contents"
  );
}

function displayedText(node) {
  const raw = node.nodeValue ?? "";
  if (!raw || (!/[^\s]/.test(raw) && !raw.includes("\u00A0"))) return "";
  const parent = node.parentElement;
  const view = node.ownerDocument?.defaultView;
  const whiteSpace = parent && view ? view.getComputedStyle(parent).whiteSpace : "normal";
  if (whiteSpace === "pre" || whiteSpace === "pre-wrap" || whiteSpace === "break-spaces") return raw;
  if (whiteSpace === "pre-line") return raw.replace(/[ \t\f\v]+/g, " ");

  let core = "";
  let started = false;
  let pendingSpace = false;
  let hadLeading = false;
  const isSpace = (ch) => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v";
  for (const ch of raw) {
    if (ch === "\u00A0") {
      if (pendingSpace && started) core += " ";
      pendingSpace = false;
      started = true;
      core += ch;
      continue;
    }
    if (isSpace(ch)) {
      if (!started) hadLeading = true;
      else pendingSpace = true;
      continue;
    }
    if (pendingSpace && started) core += " ";
    pendingSpace = false;
    started = true;
    core += ch;
  }
  if (!core) return "";

  const prev = node.previousSibling;
  const next = node.nextSibling;
  const inlineEl = (el) => {
    if (!el || el.nodeType !== 1 || !view) return false;
    return isInlineDisplay(view.getComputedStyle(el).display);
  };
  const lead = hadLeading && prev && (prev.nodeType === 3 || inlineEl(prev));
  const tail = pendingSpace && next && (next.nodeType === 3 || inlineEl(next));
  return `${lead ? " " : ""}${core}${tail ? " " : ""}`;
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
  return Math.max(70, Math.round(ms / Math.min(pace, 16)));
}

function typeDelay(speed) {
  const pace = Math.max(0.35, Number(speed) || 1);
  return Math.max(8, Math.round(28 / Math.min(pace, 8)));
}

function landingContentVisible(doc) {
  const view = doc.defaultView;
  if (!view) return false;
  const text = (doc.body?.innerText || "").replace(/\s+/g, " ").trim();
  if (text.length >= 24 && !/^(loading|please wait|just a moment)(\.{0,3}|…)?$/i.test(text)) return true;
  const nodes = doc.body?.querySelectorAll("h1,h2,p,a,button,img,video,canvas,svg") ?? [];
  for (const el of nodes) {
    if (el.closest("[data-gitreplay-loader]")) continue;
    const cs = view.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 12 && rect.height > 12) return true;
  }
  return false;
}

async function bootLandingScripts(doc, scripts) {
  for (const script of scripts) {
    if (!script?.content?.trim() || !doc.body) continue;
    try {
      const el = doc.createElement("script");
      if (script.module) el.type = "module";
      el.textContent = script.content;
      doc.body.appendChild(el);
    } catch {
      /* the page can still reveal without this file */
    }
  }
  const start = Date.now();
  while (Date.now() - start < 2400) {
    if (landingContentVisible(doc)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
}

/**
 * Drops startup loaders. If the HTML is only a loader, runs the page scripts
 * once so the real landing page can render before the replay builds it.
 */
function enableSiteStyles(doc) {
  for (const style of doc.querySelectorAll("style[data-gitreplay-site]")) {
    style.removeAttribute("media");
  }
}

export async function prepareLandingPage(doc, scripts = []) {
  if (!doc?.body) return scripts;
  enableSiteStyles(doc);
  const hidden = revealLandingPage(doc);
  if (!hidden || landingContentVisible(doc) || !scripts.length) return scripts;
  await bootLandingScripts(doc, scripts);
  revealLandingPage(doc);
  return [];
}

function injectDirectorStyle(doc) {
  let style = doc.getElementById("gitreplay-director-style");
  if (!style) {
    style = doc.createElement("style");
    style.id = "gitreplay-director-style";
    doc.head?.appendChild(style);
  }
  style.textContent = DIRECTOR_CSS;
  doc.head?.appendChild(style);
  return style;
}

/**
 * @param {Document} doc
 */
export function createVisualEditShow(doc, { scripts = [] } = {}) {
  if (!doc?.body) return null;
  injectDirectorStyle(doc);

  const siteStyles = [...doc.querySelectorAll("style[data-gitreplay-site]")];
  const setStyles = (count) => {
    siteStyles.forEach((style, index) => {
      if (index < count) style.removeAttribute("media");
      else style.setAttribute("media", "not all");
    });
  };
  setStyles(siteStyles.length);
  revealLandingPage(doc);

  const pageScripts = scripts.filter((script) => script?.content?.trim());
  const boxes = [];
  const steps = [];
  let textRestored = false;

  const restoreTypedText = () => {
    if (textRestored) return;
    textRestored = true;
    const spans = [...doc.querySelectorAll("span.gitreplay-ch")];
    for (const span of spans) {
      const parent = span.parentNode;
      if (!parent) continue;
      parent.replaceChild(doc.createTextNode(span.textContent ?? ""), span);
    }
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      let next = node.nextSibling;
      while (next && next.nodeType === 3) {
        node.nodeValue += next.nodeValue;
        const drop = next;
        next = next.nextSibling;
        drop.remove();
      }
    }
  };

  const track = (el, pinned) => {
    el.classList.add("gitreplay-box");
    if (pinned) el.classList.add("gitreplay-in");
    boxes.push(el);
  };

  const pushBox = (el, quick) => {
    const caption = boxCaption(el);
    steps.push({
      el,
      label: caption.label,
      detail: caption.detail,
      render(on) {
        el.classList.toggle("gitreplay-in", on);
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        el.classList.add("gitreplay-in");
        if (!quick) followPiece(el);
        const pace = Math.max(0.35, Number(ctx.speed) || 1);
        const hold = quick ? Math.max(16, Math.round(40 / Math.min(pace, 8))) : scaled(180, ctx.speed);
        await wait(hold, ctx.isCancelled);
      },
    });
  };

  const writeTextNode = (el, node) => {
    const text = displayedText(node);
    if (!text) return;
    const words = [];
    const tokens = text.match(/\s+|\S+/g) || [];
    let carry = "";
    for (const token of tokens) {
      if (!token.trim()) {
        if (words.length) words[words.length - 1] += token;
        else carry += token;
        continue;
      }
      words.push(carry + token);
      carry = "";
    }
    if (carry) {
      if (words.length) words[words.length - 1] += carry;
      else words.push(carry);
    }

    const frag = doc.createDocumentFragment();
    for (const word of words) {
      const shown = word.trim().slice(0, 42);
      const chars = [];
      for (const ch of word) {
        const span = doc.createElement("span");
        span.className = "gitreplay-ch";
        span.textContent = ch;
        frag.appendChild(span);
        chars.push(span);
      }
      if (!shown) {
        for (const ch of chars) ch.classList.add("gitreplay-in");
        continue;
      }
      steps.push({
        el,
        label: "Typing",
        detail: shown,
        render(on) {
          for (const ch of chars) ch.classList.toggle("gitreplay-in", on);
        },
        async play(ctx) {
          const delay = typeDelay(ctx.speed);
          const burst = shown.length > 28 || (Number(ctx.speed) || 1) >= 4 ? 2 : 1;
          for (let i = 0; i < chars.length; ) {
            if (ctx.isCancelled()) return;
            for (let n = 0; n < burst && i < chars.length; n += 1, i += 1) {
              chars[i].classList.add("gitreplay-in");
            }
            await wait(delay, ctx.isCancelled);
          }
        },
      });
    }
    node.parentNode?.replaceChild(frag, node);
  };

  const pushValue = (el, full) => {
    el.value = "";
    steps.push({
      el,
      label: "Typing",
      detail: full.slice(0, 42),
      render(on) {
        el.value = on ? full : "";
      },
      async play(ctx) {
        const delay = typeDelay(ctx.speed);
        const burst = full.length > 28 || (Number(ctx.speed) || 1) >= 4 ? 2 : 1;
        for (let i = 0; i < full.length; ) {
          if (ctx.isCancelled()) return;
          i = Math.min(full.length, i + burst);
          el.value = full.slice(0, i);
          await wait(delay, ctx.isCancelled);
        }
      },
    });
  };

  const visit = (el) => {
    if (!el || el.nodeType !== 1 || el.classList.contains("gitreplay-ch") || isSkippable(el) || !isShown(el)) return;
    const view = el.ownerDocument?.defaultView;
    const cs = view?.getComputedStyle(el);
    if (!cs) return;
    const tag = el.tagName;

    if (tag === "INPUT" || tag === "TEXTAREA") {
      track(el, false);
      pushBox(el, false);
      const inputType = tag === "TEXTAREA" ? "text" : (el.getAttribute("type") || "").toLowerCase();
      const full = TEXT_INPUT_TYPES.has(inputType) ? el.value || "" : "";
      if (full.trim()) pushValue(el, full);
      return;
    }

    if (ATOMIC_TAGS.has(tag)) {
      track(el, false);
      pushBox(el, false);
      return;
    }

    const place = shouldPlace(el, cs);
    const kids = [...el.childNodes];
    const textOnly = /^(P|LI|BLOCKQUOTE|FIGCAPTION|PRE|DD|DT|LABEL|H[1-6])$/.test(tag) && !hasOwnChrome(cs);
    track(el, !place);
    if (place) pushBox(el, textOnly);
    for (const node of kids) {
      if (node.nodeType === 3) writeTextNode(el, node);
      else if (node.nodeType === 1) visit(node);
    }
  };

  for (const child of [...doc.body.children]) visit(child);

  const scriptsStarted = new Set();
  const startScripts = (index) => {
    restoreTypedText();
    if (scriptsStarted.has(index)) return;
    const script = pageScripts[index];
    if (!script?.content?.trim()) return;
    scriptsStarted.add(index);
    const el = doc.createElement("script");
    if (script.module) el.type = "module";
    el.textContent = script.content;
    doc.body.appendChild(el);
    revealLandingPage(doc);
  };

  pageScripts.forEach((script, index) => {
    steps.push({
      el: null,
      label: "Starting scripts",
      detail: script.name || `script ${index + 1}`,
      render(on) {
        if (on) startScripts(index);
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        startScripts(index);
        await wait(scaled(220, ctx.speed), ctx.isCancelled);
      },
    });
  });

  if (!steps.length) return null;
  doc.documentElement.classList.add("gitreplay-assembling");

  return {
    beats: steps.map((step) => ({
      label: step.label,
      detail: step.detail,
      commit() {
        step.render(true);
      },
      play: (ctx) => step.play(ctx),
    })),
    renderInstant(count) {
      const end = Math.max(0, Math.min(steps.length, count));
      doc.documentElement.classList.add("gitreplay-instant");
      steps.forEach((step, index) => step.render(index < end));
      doc.documentElement.classList.remove("gitreplay-instant");
      const current = [...steps.slice(0, end)].reverse().find((step) => step.el);
      if (current?.el) followPiece(current.el);
    },
    cleanup() {
      restoreTypedText();
      revealLandingPage(doc);
      doc.documentElement.classList.remove("gitreplay-assembling", "gitreplay-instant");
      doc.documentElement.style.opacity = "";
      doc.documentElement.style.transition = "";
      for (const el of boxes) el.classList.remove("gitreplay-box", "gitreplay-in");
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
