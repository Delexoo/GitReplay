/**
 * Turns a finished page into a watchable sequence of design edits:
 * place each image, resize it, round edges, fix text, then round buttons.
 */

const DIRECTOR_CSS = `
.gitreplay-slot {
  background-color: #eef2ff !important;
  outline: 2px dashed #818cf8 !important;
  outline-offset: 3px;
  object-fit: cover;
}
.gitreplay-edit {
  outline: 3px solid #6d28d9 !important;
  outline-offset: 3px !important;
  box-shadow: 0 0 0 6px rgba(109, 40, 217, 0.2) !important;
}
.gitreplay-fixed {
  outline: 3px solid #059669 !important;
  outline-offset: 3px !important;
  box-shadow: 0 0 0 6px rgba(5, 150, 105, 0.18) !important;
}
.gitreplay-pop {
  animation: gitreplay-pop 0.45s cubic-bezier(.16,1,.3,1);
}
@keyframes gitreplay-pop {
  0% { filter: saturate(1.4) brightness(1.08); }
  100% { filter: none; }
}
`;

function radiusAmount(value) {
  if (!value || value === "0px" || /^0px(?: 0px)*$/.test(value)) return 0;
  const nums = value.match(/[\d.]+/g)?.map(Number) ?? [];
  return nums.reduce((max, n) => Math.max(max, n), 0);
}

function isButton(el) {
  const tag = el.tagName;
  if (tag === "BUTTON") return true;
  if (tag === "INPUT") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    return type === "button" || type === "submit" || type === "reset";
  }
  if (el.getAttribute("role") === "button") return true;
  const cls = typeof el.className === "string" ? el.className : "";
  return /\b(btn|button)\b/i.test(cls);
}

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
    tag === "TEMPLATE"
  );
}

function isShown(el) {
  const view = el.ownerDocument?.defaultView;
  if (!view) return false;
  const cs = view.getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return false;
  if (Number(cs.opacity) === 0) return false;
  return true;
}

function imageLabel(src) {
  if (!src || src.startsWith("data:")) return "image";
  try {
    const clean = src.split("?")[0].split("#")[0];
    const name = decodeURIComponent(clean.split("/").pop() || "");
    return name || "image";
  } catch {
    return "image";
  }
}

function elementLabel(el) {
  if (el.tagName === "IMG" || el.tagName === "VIDEO") {
    return imageLabel(el.getAttribute("data-gitreplay-name") || el.currentSrc || el.getAttribute("src") || "");
  }
  const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/)[0] : "";
  if (cls && !cls.startsWith("gitreplay-")) return cls.replace(/^[\w-]+__/, "");
  return el.tagName.toLowerCase();
}

function directTextNodes(el) {
  return [...el.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
}

function setDirectText(nodes, value) {
  if (!nodes.length) return;
  nodes[0].textContent = value;
  for (let i = 1; i < nodes.length; i++) nodes[i].textContent = "";
}

function textFrames(text) {
  if (text.length <= 80) return [...text].map((_, i) => text.slice(0, i + 1));
  const parts = text.split(/(\s+)/);
  const frames = [];
  let acc = "";
  for (const part of parts) {
    acc += part;
    if (part.trim()) frames.push(acc);
    else if (frames.length) frames[frames.length - 1] = acc;
  }
  return frames.length ? frames : [text];
}

function boxOf(el) {
  const rect = el.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  const cs = view.getComputedStyle(el);
  const width = Math.round(rect.width || parseFloat(cs.width) || 0);
  const height = Math.round(rect.height || parseFloat(cs.height) || 0);
  return { width, height };
}

function setBox(el, width, height) {
  el.style.setProperty("width", `${Math.max(1, Math.round(width))}px`, "important");
  el.style.setProperty("height", `${Math.max(1, Math.round(height))}px`, "important");
  el.style.setProperty("max-width", "none", "important");
  el.style.setProperty("max-height", "none", "important");
}

function spotlight(doc, el, fixed = false) {
  doc.querySelectorAll(".gitreplay-edit, .gitreplay-fixed").forEach((node) => {
    node.classList.remove("gitreplay-edit", "gitreplay-fixed");
  });
  if (!el) return;
  el.classList.add(fixed ? "gitreplay-fixed" : "gitreplay-edit");
  try {
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  } catch {
    /* the preview can still show the edit without scrolling */
  }
}

function injectDirectorStyle(doc) {
  const existing = doc.getElementById("gitreplay-director-style");
  if (existing) return existing;
  const style = doc.createElement("style");
  style.id = "gitreplay-director-style";
  style.textContent = DIRECTOR_CSS;
  doc.head?.appendChild(style);
  return style;
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
    }, 24);
    setTimeout(() => clearInterval(poll), ms + 30);
  });
}

function scaled(ms, speed) {
  const pace = Math.max(0.25, Number(speed) || 1);
  return Math.max(32, Math.round(ms / pace));
}

/**
 * @param {Document} doc
 * @returns {null | {
 *   beats: Array<{ label: string, detail: string, commit: () => void, play: (ctx: { speed: number, isCancelled: () => boolean }) => Promise<void> }>,
 *   renderInstant: (count: number) => void,
 *   cleanup: () => void
 * }}
 */
export function createVisualEditShow(doc) {
  if (!doc?.body) return null;
  injectDirectorStyle(doc);

  const view = doc.defaultView;
  const records = [];

  for (const el of doc.body.querySelectorAll("*")) {
    if (isSkippable(el) || !isShown(el)) continue;
    const cs = view.getComputedStyle(el);
    const radius = cs.borderRadius;
    const rounded = radiusAmount(radius) > 0;
    const button = isButton(el);
    const snapshot = {
      style: el.getAttribute("style"),
      className: el.getAttribute("class"),
      src: el.getAttribute("src"),
      srcset: el.getAttribute("srcset"),
      poster: el.getAttribute("poster"),
    };

    if (el.tagName === "IMG" || el.tagName === "VIDEO") {
      const box = boxOf(el);
      if (box.width <= 2 && box.height <= 2) continue;
      const name = imageLabel(snapshot.src || el.currentSrc || snapshot.poster || "");
      el.setAttribute("data-gitreplay-name", name);
      const finalW = Math.max(box.width, 48);
      const finalH = Math.max(box.height, 36);
      records.push({
        el,
        snapshot,
        kind: "image",
        name,
        radius: rounded ? radius : "",
        finalW,
        finalH,
        startW: Math.max(36, Math.round(finalW * 0.42)),
        startH: Math.max(28, Math.round(finalH * 0.42)),
      });
      continue;
    }

    const bg = cs.backgroundImage;
    if (bg && bg !== "none" && /url\(/i.test(bg)) {
      records.push({
        el,
        snapshot,
        kind: "background",
        name: elementLabel(el),
        image: bg,
        radius: !button && rounded ? radius : "",
        button: button && rounded ? radius : "",
      });
    }

    const texts = directTextNodes(el);
    if (texts.length) {
      const originals = texts.map((node) => node.textContent ?? "");
      const text = originals.join("");
      if (text.trim()) {
        records.push({
          el,
          snapshot,
          kind: "text",
          name: text.trim().slice(0, 42),
          nodes: texts,
          originals,
          text,
        });
      }
    }

    const hasBackground = Boolean(bg && bg !== "none" && /url\(/i.test(bg));
    if (button && rounded && !hasBackground) {
      records.push({ el, snapshot, kind: "button", name: elementLabel(el), radius });
    } else if (!button && rounded && !hasBackground) {
      records.push({ el, snapshot, kind: "radius", name: elementLabel(el), radius });
    }
  }

  const images = records.filter((item) => item.kind === "image");
  const backgrounds = records.filter((item) => item.kind === "background");
  const texts = records.filter((item) => item.kind === "text");
  const edges = [
    ...images.filter((item) => item.radius),
    ...backgrounds.filter((item) => item.radius),
    ...records.filter((item) => item.kind === "radius"),
  ];
  const buttons = [
    ...records.filter((item) => item.kind === "button"),
    ...backgrounds.filter((item) => item.button),
  ];

  function rewind() {
    spotlight(doc, null);
    for (const item of images) {
      item.el.removeAttribute("src");
      item.el.removeAttribute("srcset");
      item.el.removeAttribute("poster");
      item.el.classList.add("gitreplay-slot");
      setBox(item.el, item.startW, item.startH);
      item.el.style.setProperty("border-radius", "0px", "important");
    }
    for (const item of backgrounds) {
      item.el.style.setProperty("background-image", "none", "important");
      if (item.radius || item.button) item.el.style.setProperty("border-radius", "0px", "important");
    }
    for (const item of records) {
      if (item.kind === "radius" || item.kind === "button") {
        item.el.style.setProperty("border-radius", "0px", "important");
      }
      if (item.kind === "text") setDirectText(item.nodes, "");
    }
  }

  function placeImage(item, animate) {
    if (item.snapshot.src != null) item.el.setAttribute("src", item.snapshot.src);
    else item.el.removeAttribute("src");
    if (item.snapshot.srcset != null) item.el.setAttribute("srcset", item.snapshot.srcset);
    if (item.snapshot.poster != null) item.el.setAttribute("poster", item.snapshot.poster);
    item.el.classList.remove("gitreplay-slot");
    if (animate) item.el.classList.add("gitreplay-pop");
  }

  function placeBackground(item) {
    item.el.style.setProperty("background-image", item.image, "important");
  }

  function resizeImage(item, animate, speed) {
    const ms = scaled(680, speed);
    item.el.style.setProperty(
      "transition",
      animate ? `width ${ms}ms cubic-bezier(.16,1,.3,1), height ${ms}ms cubic-bezier(.16,1,.3,1)` : "none",
      "important"
    );
    if (animate) {
      setBox(item.el, item.startW, item.startH);
      void item.el.offsetWidth;
    }
    setBox(item.el, item.finalW, item.finalH);
    return animate ? ms : 0;
  }

  function round(item, animate, speed) {
    const ms = scaled(560, speed);
    item.el.style.setProperty(
      "transition",
      animate ? `border-radius ${ms}ms ease` : "none",
      "important"
    );
    item.el.style.setProperty("border-radius", item.radius || item.button, "important");
    return animate ? ms : 0;
  }

  const beats = [];

  for (const item of backgrounds) {
    beats.push({
      label: "Placing image",
      detail: item.name,
      commit() {
        placeBackground(item);
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        spotlight(doc, item.el);
        placeBackground(item);
        item.el.classList.add("gitreplay-pop");
        await wait(scaled(420, ctx.speed), ctx.isCancelled);
      },
    });
  }

  for (const item of images) {
    beats.push({
      label: "Placing image",
      detail: item.name,
      commit() {
        placeImage(item, false);
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        spotlight(doc, item.el);
        placeImage(item, true);
        await wait(scaled(460, ctx.speed), ctx.isCancelled);
      },
    });
  }

  for (const item of images) {
    beats.push({
      label: "Resizing image",
      detail: item.name,
      commit() {
        resizeImage(item, false, 1);
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        spotlight(doc, item.el);
        const ms = resizeImage(item, true, ctx.speed);
        await wait(ms + scaled(80, ctx.speed), ctx.isCancelled);
      },
    });
  }

  for (const item of edges) {
    beats.push({
      label: "Rounding edges",
      detail: item.name,
      commit() {
        round(item, false, 1);
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        spotlight(doc, item.el);
        const ms = round(item, true, ctx.speed);
        await wait(ms + scaled(70, ctx.speed), ctx.isCancelled);
      },
    });
  }

  for (const item of texts) {
    beats.push({
      label: "Fixing text",
      detail: item.name,
      commit() {
        setDirectText(item.nodes, item.text);
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        spotlight(doc, item.el);
        const frames = textFrames(item.text);
        const stepMs = scaled(item.text.length <= 80 ? 26 : 20, ctx.speed);
        for (const frame of frames) {
          if (ctx.isCancelled()) return;
          setDirectText(item.nodes, frame);
          await wait(stepMs, ctx.isCancelled);
        }
        if (ctx.isCancelled()) return;
        spotlight(doc, item.el, true);
        await wait(scaled(180, ctx.speed), ctx.isCancelled);
      },
    });
  }

  for (const item of buttons) {
    beats.push({
      label: "Rounding button",
      detail: item.name,
      commit() {
        round(item, false, 1);
      },
      async play(ctx) {
        if (ctx.isCancelled()) return;
        spotlight(doc, item.el);
        const ms = round(item, true, ctx.speed);
        await wait(ms + scaled(90, ctx.speed), ctx.isCancelled);
      },
    });
  }

  if (!beats.length) return null;

  rewind();

  return {
    beats,
    renderInstant(count) {
      rewind();
      const end = Math.max(0, Math.min(beats.length, count));
      for (let i = 0; i < end; i++) beats[i].commit();
      const current = beats[end - 1];
      spotlight(doc, null);
      if (current) {
        const el =
          images.find((item) => item.name === current.detail)?.el ||
          records.find((item) => item.name === current.detail)?.el;
        if (el) el.classList.add("gitreplay-edit");
      }
    },
    cleanup() {
      spotlight(doc, null);
      for (const item of records) {
        const { el, snapshot } = item;
        if (!el.isConnected) continue;
        if (snapshot.style == null) el.removeAttribute("style");
        else el.setAttribute("style", snapshot.style);
        if (snapshot.className == null) el.removeAttribute("class");
        else el.setAttribute("class", snapshot.className);
        if (snapshot.src == null) el.removeAttribute("src");
        else el.setAttribute("src", snapshot.src);
        if (snapshot.srcset == null) el.removeAttribute("srcset");
        else el.setAttribute("srcset", snapshot.srcset);
        if (snapshot.poster == null) el.removeAttribute("poster");
        else el.setAttribute("poster", snapshot.poster);
        el.classList.remove("gitreplay-slot", "gitreplay-edit", "gitreplay-fixed", "gitreplay-pop");
      }
      for (const item of records) {
        if (item.kind !== "text") continue;
        item.nodes.forEach((node, index) => {
          node.textContent = item.originals[index] ?? "";
        });
      }
      doc.getElementById("gitreplay-director-style")?.remove();
    },
  };
}

export async function waitForPreviewImages(doc, timeoutMs = 900) {
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
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
