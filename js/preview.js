import { bundlePreviewEntry, getBundleError, normalizeBundledPreview } from "./bundler.js";
import { buildMarkdownDocument, markdownPreviewLabel } from "./markdown.js";

const WEB = {
  html: /\.(html?|htm)$/i,
  css: /\.css$/i,
  js: /\.(mjs|cjs|js)$/i,
  script: /\.(mjs|cjs|js|tsx?|jsx)$/i,
  style: /\.(css|scss|sass|less)$/i,
  svg: /\.svg$/i,
};

export function isScriptPath(path) {
  return Boolean(path && WEB.script.test(path));
}

export function isStylePath(path) {
  return Boolean(path && WEB.style.test(path));
}

const MEDIA = {
  image: /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i,
  video: /\.(mp4|webm|ogg|ogv|mov|m4v|avi|mkv)$/i,
  audio: /\.(mp3|wav|aac|m4a|oga|flac)$/i,
};

export function getPreviewMediaKind(path) {
  if (!path) return null;
  if (WEB.svg.test(path)) return "image";
  if (MEDIA.video.test(path)) return "video";
  if (MEDIA.audio.test(path)) return "audio";
  if (MEDIA.image.test(path)) return "image";
  return null;
}

export function isPreviewableMedia(path) {
  return Boolean(getPreviewMediaKind(path));
}

export function isWebFile(path) {
  return WEB.html.test(path) || isScriptPath(path) || isStylePath(path);
}

function isDevOnlyAssetUrl(url) {
  const value = url.trim();
  if (value.startsWith("/@")) return true;
  if (value.includes("@react-refresh")) return true;
  if (value.includes("/@vite/")) return true;
  if (value.includes("/@fs/")) return true;
  if (value.includes("/@id/")) return true;
  return false;
}

function sanitizeDevAssets(html) {
  let doc = html;
  doc = doc.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
    const src = htmlTagAttr(tag, "src");
    return src && isDevOnlyAssetUrl(src) ? "" : tag;
  });
  doc = doc.replace(/<script\b[^>]*\/>/gi, (tag) => {
    const src = htmlTagAttr(tag, "src");
    return src && isDevOnlyAssetUrl(src) ? "" : tag;
  });
  doc = doc.replace(/<link\b[^>]*>/gi, (tag) => {
    const href = htmlTagAttr(tag, "href");
    return href && isDevOnlyAssetUrl(href) ? "" : tag;
  });
  return doc;
}

function normalizePath(baseFile, rel) {
  if (!rel || /^https?:\/\//i.test(rel) || rel.startsWith("//") || rel.startsWith("data:")) {
    return null;
  }

  const baseDir = baseFile.includes("/") ? baseFile.split("/").slice(0, -1) : [];
  const parts = rel.startsWith("/")
    ? rel.slice(1).split("/")
    : [...baseDir, ...rel.split("/")];
  const stack = [];

  for (const part of parts) {
    if (part === "..") stack.pop();
    else if (part !== "." && part) stack.push(part);
  }

  return stack.join("/");
}

function htmlTagAttr(tag, name) {
  const quoted = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
  if (quoted) return quoted;
  return tag.match(new RegExp(`${name}\\s*=\\s*([^\\s>"']+)`, "i"))?.[1] ?? null;
}

function findInCache(fileCache, targetPath) {
  if (!targetPath) return null;
  if (fileCache.has(targetPath)) return targetPath;

  const targetName = targetPath.split("/").pop()?.toLowerCase();
  for (const key of fileCache.keys()) {
    if (key.split("/").pop()?.toLowerCase() === targetName) return key;
  }

  return null;
}

function resolvePathInCache(rel, htmlPath, fileCache) {
  const resolved = normalizePath(htmlPath, rel);
  return findInCache(fileCache, resolved);
}

function pickHtmlPath(entries, activePath) {
  const htmlPaths = entries.filter(([p]) => WEB.html.test(p)).map(([p]) => p);
  htmlPaths.sort((a, b) => scoreHtmlPath(a) - scoreHtmlPath(b));

  if (activePath && WEB.html.test(activePath) && htmlPaths.includes(activePath)) {
    return activePath;
  }

  return (
    htmlPaths.find((p) => /index\.html?$/i.test(p.split("/").pop() ?? "")) ??
    htmlPaths[0] ??
    null
  );
}

export function scoreHtmlPath(path) {
  const lower = path.toLowerCase();
  const parts = lower.split("/");
  const name = parts.pop() ?? "";
  let score = 3;
  if (name === "index.html") score = 0;
  else if (name === "index.htm") score = 1;
  else if (name.endsWith(".html")) score = 2;

  if (parts.includes("dist")) score -= 20;
  else if (parts.includes("build")) score -= 18;
  else if (parts.includes("out")) score -= 16;
  else if (parts.includes("docs")) score -= 14;

  if (parts.some((p) => p === "node_modules" || p === ".github" || p === "coverage")) {
    score += 100;
  }

  if (parts.length === 0 && name === "index.html") score -= 4;
  if (parts.length === 1 && parts[0] === "public" && name === "index.html") score -= 2;

  return score;
}

function scoreCssPath(path) {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === "style.css") return 0;
  if (name === "styles.css") return 1;
  if (name === "main.css") return 2;
  return 3;
}

function scoreJsPath(path) {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === "main.tsx") return -2;
  if (name === "main.ts") return -1;
  if (name === "main.jsx") return -1;
  if (name === "script.js") return 0;
  if (name === "main.js") return 1;
  if (name === "index.js") return 2;
  if (name === "index.tsx") return 2;
  if (name === "app.js") return 3;
  return 4;
}

function pickCssPath(paths) {
  return [...paths].sort((a, b) => scoreCssPath(a) - scoreCssPath(b))[0] ?? null;
}

function pickJsPath(paths) {
  return [...paths].sort((a, b) => scoreJsPath(a) - scoreJsPath(b))[0] ?? null;
}

/** Final html/css/js targets from replay steps — used for parallel live preview. */
export function pickWebFilesFromSteps(steps) {
  const latest = new Map();
  for (const step of steps) {
    if (isWebFile(step.path)) latest.set(step.path, step.content);
  }
  if (!latest.size) return null;

  const htmlPaths = [...latest.keys()].filter((p) => WEB.html.test(p));
  const htmlPath = pickHtmlPath([...htmlPaths].map((p) => [p, latest.get(p)]), null);
  if (!htmlPath) return null;

  const html = latest.get(htmlPath) ?? "";
  const refs = parseHtmlRefs(html, htmlPath, latest);
  let cssPaths = refs.cssPaths;
  let jsPaths = refs.jsPaths;

  if (!cssPaths.length) {
    const fallback = pickCssPath([...latest.keys()].filter((p) => WEB.css.test(p)));
    if (fallback) cssPaths = [fallback];
  }
  if (!jsPaths.length) {
    const fallback = pickJsPath([...latest.keys()].filter((p) => isScriptPath(p)));
    if (fallback) jsPaths = [fallback];
  }
  if (!cssPaths.length && !jsPaths.length) return null;

  const ordered = uniquePaths([htmlPath, ...cssPaths, ...jsPaths]);
  const files = ordered.map((path) => ({ path, full: latest.get(path) ?? "" }));

  return {
    htmlPath,
    cssPaths,
    jsPaths,
    cssPath: cssPaths[0] ?? null,
    jsPath: jsPaths[0] ?? null,
    files,
  };
}

function uniquePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const p of paths) {
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function parseHtmlRefs(html, htmlPath, fileCache) {
  const cssPaths = [];
  const jsPaths = [];
  const jsModule = new Map();
  const addCss = (path) => {
    if (path && !cssPaths.includes(path)) cssPaths.push(path);
  };
  const addJs = (path, tag) => {
    if (!path || jsPaths.includes(path)) return;
    jsPaths.push(path);
    if (/type\s*=\s*["']module["']/i.test(tag)) jsModule.set(path, true);
  };

  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = htmlTagAttr(tag, "rel")?.toLowerCase() ?? "";
    const href = htmlTagAttr(tag, "href");
    if (!href) continue;
    if (rel.includes("modulepreload")) {
      addJs(resolvePathInCache(href, htmlPath, fileCache), tag);
      continue;
    }
    if (rel && !rel.includes("stylesheet")) continue;
    addCss(resolvePathInCache(href, htmlPath, fileCache));
  }

  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const tag = m[0];
    const src = htmlTagAttr(tag, "src");
    if (!src) continue;
    addJs(resolvePathInCache(src, htmlPath, fileCache), tag);
  }

  return { cssPaths, jsPaths, jsModule };
}

export function getWebStack(fileCache, activePath, options = {}) {
  const { liveBuild = false, bundle = null } = options;
  const entries = [...fileCache.entries()];
  if (!entries.length) return null;

  const htmlPath = bundle?.htmlPath ?? pickHtmlPath(entries, activePath);
  const html = htmlPath ? (fileCache.get(htmlPath) ?? "") : "";

  let cssPaths = bundle?.cssPaths?.length ? [...bundle.cssPaths] : [];
  let jsPaths = bundle?.jsPaths?.length ? [...bundle.jsPaths] : [];
  const jsModuleMap = new Map();

  if (htmlPath && html) {
    const refs = parseHtmlRefs(html, htmlPath, fileCache);
    if (!cssPaths.length) cssPaths = refs.cssPaths;
    if (!jsPaths.length) jsPaths = refs.jsPaths;
    for (const [path, isModule] of refs.jsModule) jsModuleMap.set(path, isModule);
  }

  if (!cssPaths.length) {
    const cssEntries = entries.filter(([p]) => isStylePath(p));
    cssEntries.sort((a, b) => scoreCssPath(a[0]) - scoreCssPath(b[0]));
    if (cssEntries.length) cssPaths = [cssEntries[0][0]];
  }

  if (!jsPaths.length) {
    const jsEntries = entries.filter(([p]) => isScriptPath(p));
    jsEntries.sort((a, b) => scoreJsPath(a[0]) - scoreJsPath(b[0]));
    if (jsEntries.length) jsPaths = [jsEntries[0][0]];
  }

  cssPaths = uniquePaths(cssPaths.filter((p) => fileCache.has(p)));
  jsPaths = uniquePaths(jsPaths.filter((p) => fileCache.has(p)));

  const css = cssPaths.map((p) => fileCache.get(p) ?? "").filter(Boolean).join("\n");
  const scripts = jsPaths
    .map((p) => ({
      path: p,
      content: fileCache.get(p) ?? "",
      module: jsModuleMap.get(p) ?? false,
    }))
    .filter((s) => s.content.trim());
  const js = scripts.map((s) => s.content).join("\n;\n");
  const jsPath = jsPaths[0] ?? null;
  const cssPath = cssPaths[0] ?? null;
  let jsModule = jsPath ? (jsModuleMap.get(jsPath) ?? false) : false;

  const hasWeb = htmlPath || cssPaths.length || jsPaths.length;
  if (!hasWeb) return null;

  if (js && !jsModule && /^\s*(?:import|export)\s/m.test(js)) jsModule = true;

  return { htmlPath, html, cssPath, cssPaths, css, jsPath, jsPaths, js, jsModule, jsModuleMap, scripts };
}

const PREVIEW_SAFE_CSS = `
html, body { visibility: visible !important; opacity: 1 !important; }
body { display: block !important; min-height: 48px; }
`;

const PREVIEW_BUILD_CSS = `
body {
  background: #f8f9fa !important;
  color: #1a1a1a !important;
  min-height: 100%;
}
head {
  display: block !important;
  padding: 10px 14px;
  background: #eef2ff !important;
  border-bottom: 2px dashed #93c5fd;
}
head title {
  display: block !important;
  font: 600 14px/1.4 system-ui, sans-serif;
  color: #1e3a8a;
  margin: 0 0 6px;
}
head meta,
head link,
head base {
  display: block !important;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #1e40af;
  padding: 2px 0;
  word-break: break-all;
}
head meta { font-size: 0; }
head meta::before { font-size: 12px; }
head meta[charset]::before { content: "<meta charset=\\"" attr(charset) "\\">"; }
head meta[name][content]::before { content: "<meta name=\\"" attr(name) "\\" content=\\"" attr(content) "\\">"; }
head meta[property][content]::before { content: "<meta property=\\"" attr(property) "\\" content=\\"" attr(content) "\\">"; }
head meta[name]:not([content])::before { content: "<meta name=\\"" attr(name) "\\">"; }
head link { font-size: 0; }
head link::before { font-size: 12px; }
head link[rel][href]::before { content: "<link rel=\\"" attr(rel) "\\" href=\\"" attr(href) "\\">"; }
head link[href]:not([rel])::before { content: "<link href=\\"" attr(href) "\\">"; }
body > :not(script):not(style) {
  outline: 1px dashed rgba(0, 0, 0, 0.2);
  outline-offset: 2px;
}
[data-gitreplay-template-preview] {
  outline: 2px dashed rgba(37, 99, 235, 0.45) !important;
  padding: 8px;
  margin: 4px 0;
}
`;

function getPreviewBaseUrl(htmlPath, resolveAssetUrl) {
  const fileUrl = resolveAssetUrl(htmlPath);
  if (!fileUrl || !htmlPath) return null;
  const slash = htmlPath.lastIndexOf("/");
  if (slash === -1) return fileUrl.replace(/\/[^/]*$/, "/");
  return fileUrl.slice(0, fileUrl.length - (htmlPath.length - slash - 1));
}

const REMOTE_URL = /^(https?:|\/\/|data:|#|mailto:|tel:|javascript:)/i;

function resolveRepoAssetUrl(ref, htmlPath, resolveAssetUrl) {
  if (!ref || REMOTE_URL.test(ref.trim())) return null;
  const rel = ref.trim();
  if (rel.startsWith("/")) {
    const rootPath = rel.slice(1).split("/").filter(Boolean).join("/");
    return rootPath ? resolveAssetUrl(rootPath) : null;
  }
  const resolved = normalizePath(htmlPath, rel);
  return resolved ? resolveAssetUrl(resolved) : null;
}

function rewriteUrlInCssText(cssText, htmlPath, resolveAssetUrl) {
  return cssText.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, url) => {
    const trimmed = url.trim();
    const remote = resolveRepoAssetUrl(trimmed, htmlPath, resolveAssetUrl);
    return remote ? `url(${quote}${remote}${quote})` : match;
  });
}

function rewriteAssetUrls(html, htmlPath, resolveAssetUrl) {
  if (!resolveAssetUrl || !htmlPath) return html;

  let doc = html;
  for (const attr of ["href", "src", "poster", "data-src"]) {
    doc = doc.replace(
      new RegExp(`(\\s${attr}\\s*=\\s*)(["'])([^"']+)\\2`, "gi"),
      (match, prefix, quote, url) => {
        const remote = resolveRepoAssetUrl(url, htmlPath, resolveAssetUrl);
        return remote ? `${prefix}${quote}${remote}${quote}` : match;
      }
    );
    doc = doc.replace(
      new RegExp(`(\\s${attr}\\s*=\\s*)([^\\s>"']+)`, "gi"),
      (match, prefix, url) => {
        const remote = resolveRepoAssetUrl(url, htmlPath, resolveAssetUrl);
        return remote ? `${prefix}${remote}` : match;
      }
    );
  }
  return doc;
}

function rewriteInlineAssetUrls(html, htmlPath, resolveAssetUrl) {
  if (!resolveAssetUrl || !htmlPath) return html;

  let doc = html.replace(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (match, quote, style) => {
    return ` style=${quote}${rewriteUrlInCssText(style, htmlPath, resolveAssetUrl)}${quote}`;
  });

  doc = doc.replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi, (match, attrs, css) => {
    return `<style${attrs}>${rewriteUrlInCssText(css, htmlPath, resolveAssetUrl)}</style>`;
  });

  return doc;
}

function ensureAssetBase(html, htmlPath, resolveAssetUrl) {
  const baseUrl = getPreviewBaseUrl(htmlPath, resolveAssetUrl);
  if (!baseUrl) return html;
  const tag = `<base href="${escapeAttr(baseUrl)}">`;
  if (/<base\b/i.test(html)) {
    return html.replace(/<base\b[^>]*>/i, tag);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
  }
  return `${tag}${html}`;
}

function buildBundleErrorDocument(htmlPath, entryPath) {
  const page = escapeAttr(htmlPath?.split("/").pop() ?? "page");
  const entry = escapeAttr(entryPath?.split("/").pop() ?? "entry");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { margin: 0; font: 14px/1.5 system-ui, sans-serif; background: #fafafa; color: #111; }
    .wrap { max-width: 520px; margin: 48px auto; padding: 0 20px; }
    h1 { font-size: 18px; margin: 0 0 8px; }
    p { margin: 0 0 12px; color: #555; }
    code { font-family: ui-monospace, monospace; font-size: 12px; background: #eee; padding: 2px 6px; border-radius: 4px; }
  </style></head><body><div class="wrap">
    <h1>Preview bundle failed</h1>
    <p>GitReplay could not bundle <code>${page}</code> (entry <code>${entry}</code>).</p>
    <p>Try opening a built <code>dist/index.html</code> if the repo includes production output.</p>
  </div></body></html>`;
}

function injectBundledPreview(html, bundle) {
  const payload = normalizeBundledPreview(bundle);
  if (!payload) return html;
  let doc = html;
  if (payload.css.trim()) {
    doc = injectStyleBlocks(doc, [{ id: "bundle", css: payload.css }]);
  }
  return injectJs(doc, payload.js, { module: true });
}

function buildAuthenticPreviewDocument(html, htmlPath, resolveAssetUrl, options = {}) {
  const { bundledScript = null, fileCache = null } = options;
  let doc = ensureDoctype(html);
  doc = sanitizeDevAssets(doc);

  if (normalizeBundledPreview(bundledScript) && htmlPath && fileCache) {
    doc = stripInlinedLocalAssets(doc, htmlPath, fileCache);
    if (resolveAssetUrl && htmlPath) {
      doc = rewriteAssetUrls(doc, htmlPath, resolveAssetUrl);
      doc = rewriteInlineAssetUrls(doc, htmlPath, resolveAssetUrl);
      doc = ensureAssetBase(doc, htmlPath, resolveAssetUrl);
    }
    return injectBundledPreview(doc, bundledScript);
  }

  if (resolveAssetUrl && htmlPath) {
    doc = rewriteAssetUrls(doc, htmlPath, resolveAssetUrl);
    doc = rewriteInlineAssetUrls(doc, htmlPath, resolveAssetUrl);
    doc = ensureAssetBase(doc, htmlPath, resolveAssetUrl);
  }
  return doc;
}

function buildLivePreviewDocument(html, stack, fileCache, options) {
  const {
    allowPartialJs = true,
    allowPartialCss = true,
    resolveAssetUrl = null,
    bundledScript = null,
  } = options;
  let doc = wrapPartialHtml(html);
  if (!doc.trim()) doc = wrapPartialHtml(`${html}>`);
  if (!doc.trim()) {
    const escaped = html
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    doc = repairPartialHtml(
      `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><pre style="margin:0;padding:12px;white-space:pre-wrap;word-break:break-word;">${escaped}</pre></body></html>`
    );
  }

  doc = stripInlinedLocalAssets(doc, stack.htmlPath, fileCache);

  const styleBlocks = [];
  if (allowPartialCss && stack.css.trim()) styleBlocks.push({ id: "site", css: stack.css });
  if (styleBlocks.length) doc = injectStyleBlocks(doc, styleBlocks);

  if (normalizeBundledPreview(bundledScript)) {
    doc = injectBundledPreview(doc, bundledScript);
  } else if (allowPartialJs && stack.scripts.length) {
    doc = injectScripts(doc, stack.scripts);
  }

  if (resolveAssetUrl && stack.htmlPath) {
    doc = rewriteAssetUrls(doc, stack.htmlPath, resolveAssetUrl);
    doc = rewriteInlineAssetUrls(doc, stack.htmlPath, resolveAssetUrl);
    doc = ensureAssetBase(doc, stack.htmlPath, resolveAssetUrl);
  }

  return ensureDoctype(doc);
}

export function pickBundleEntry(stack) {
  if (!stack?.jsPaths?.length) return null;
  const sorted = [...stack.jsPaths].sort((a, b) => scoreJsPath(a) - scoreJsPath(b));
  return sorted.find((p) => /\.(tsx?|jsx)$/i.test(p)) ?? sorted[0];
}

export function needsPreviewBundle(stack, fileCache, htmlPath) {
  if (!stack?.jsPaths?.length) return false;

  const builtHtml = htmlPath && /(?:^|\/)(dist|build|out)\//i.test(htmlPath);
  const entry = pickBundleEntry(stack);
  if (!entry) return false;

  if (builtHtml && !/\.(tsx?|jsx)$/i.test(entry)) {
    const content = fileCache.get(entry) ?? "";
    if (!/^\s*(?:import|export)\s/m.test(content)) return false;
  }

  if (/\.(tsx?|jsx)$/i.test(entry)) return true;

  for (const path of stack.jsPaths) {
    const content = fileCache.get(path) ?? "";
    if (/^\s*(?:import|export)\s/m.test(content)) return true;
  }

  const html = stack.html ?? "";
  if (/<script\b[^>]*\bsrc\s*=\s*["']\/src\//i.test(html)) return true;

  return false;
}

export function buildPreviewDocument(fileCache, activePath, options = {}) {
  const {
    allowPartialJs = true,
    allowPartialCss = true,
    liveBuild = false,
    building = false,
    bundle = null,
    mediaUrl = null,
    resolveAssetUrl = null,
    bundledScript = null,
  } = options;
  if (!fileCache.size && !mediaUrl) return null;

  if (activePath && mediaUrl) {
    const kind = getPreviewMediaKind(activePath);
    if (kind) return buildMediaDocument(mediaUrl, activePath, kind);
  }

  if (!fileCache.size) return null;

  if (activePath && WEB.svg.test(activePath)) {
    const svg = fileCache.get(activePath);
    if (svg?.trim()) return wrapSvg(svg);
  }

  const stack = getWebStack(fileCache, activePath, { liveBuild, bundle });
  if (!stack) return null;

  if (stack.html.length > 0) {
    if (liveBuild) {
      return buildLivePreviewDocument(stack.html, stack, fileCache, {
        allowPartialJs,
        allowPartialCss,
        resolveAssetUrl,
        bundledScript,
      });
    }
    return buildAuthenticPreviewDocument(stack.html, stack.htmlPath, resolveAssetUrl, {
      bundledScript,
      fileCache,
    });
  }

  if (building) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>`;
  }

  return null;
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

const RAW_ELEMENTS = new Set(["script", "style", "textarea", "title"]);

function wrapPartialHtml(html) {
  const trimmed = html.trim();
  if (!trimmed) return "";
  const source = /<!DOCTYPE|<html[\s>]/i.test(trimmed)
    ? trimmed
    : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${trimmed}</body></html>`;
  return repairPartialHtml(source);
}

/** Make incomplete streamed HTML parseable so the preview updates on every character. */
function repairPartialHtml(html) {
  let doc = completeTrailingFragment(html);
  doc = closeUnclosedRawElements(doc);
  doc = closeOpenElementTags(doc);
  doc = closePartialHtml(doc);
  return doc;
}

function completeTrailingFragment(html) {
  const lastLt = html.lastIndexOf("<");
  if (lastLt === -1) return html;

  const tail = html.slice(lastLt);
  if (tail.includes(">")) return html;

  if (tail.startsWith("<!--")) {
    return `${html}-->`;
  }

  if (tail.startsWith("<!")) {
    if (/^<!DOCTYPE\b/i.test(tail)) {
      let fixed = tail;
      fixed = balanceQuotes(fixed, '"');
      fixed = balanceQuotes(fixed, "'");
      if (!fixed.endsWith(">")) fixed += ">";
      return html.slice(0, lastLt) + fixed;
    }
    return html.slice(0, lastLt);
  }

  if (tail.startsWith("</")) {
    const closeName = tail.match(/^<\/([a-zA-Z][\w:-]*)/);
    if (closeName && !tail.includes(">")) {
      return `${html.slice(0, lastLt)}</${closeName[1]}>`;
    }
    return html.slice(0, lastLt);
  }

  let fixed = tail;
  fixed = balanceQuotes(fixed, '"');
  fixed = balanceQuotes(fixed, "'");
  if (!fixed.endsWith(">")) fixed += ">";
  return html.slice(0, lastLt) + fixed;
}

function balanceQuotes(str, quote) {
  let count = 0;
  for (const ch of str) {
    if (ch === quote) count++;
  }
  return count % 2 === 1 ? str + quote : str;
}

function closeUnclosedRawElements(html) {
  let doc = html;
  for (const tag of RAW_ELEMENTS) {
    const openRe = new RegExp(`<${tag}(?=\\s|>|/)`, "gi");
    const closeRe = new RegExp(`</${tag}\\s*>`, "gi");
    let openCount = 0;
    let closeCount = 0;
    let m;
    while ((m = openRe.exec(doc)) !== null) openCount++;
    while ((m = closeRe.exec(doc)) !== null) closeCount++;
    for (let i = 0; i < openCount - closeCount; i++) {
      doc += `</${tag}>`;
    }
  }
  return doc;
}

function closeOpenElementTags(html) {
  const stack = [];
  let i = 0;
  const len = html.length;

  while (i < len) {
    if (html[i] !== "<") {
      i++;
      continue;
    }

    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }

    const tagMatch = html.slice(i).match(/^<\/?([a-zA-Z][\w:-]*)\b([^>]*)>/);
    if (!tagMatch) {
      i++;
      continue;
    }

    const full = tagMatch[0];
    const name = tagMatch[1].toLowerCase();
    const attrs = tagMatch[2];
    const isClose = html[i + 1] === "/";
    const isSelfClose = /\/\s*$/.test(attrs) || VOID_ELEMENTS.has(name);

    if (RAW_ELEMENTS.has(name) && !isClose) {
      const closePat = new RegExp(`</${name}\\s*>`, "i");
      const rest = html.slice(i + full.length);
      const closeIdx = rest.search(closePat);
      if (closeIdx === -1) {
        i = len;
      } else {
        i += full.length + closeIdx + (rest.match(closePat)?.[0]?.length ?? 0);
      }
      continue;
    }

    if (isClose) {
      const idx = stack.lastIndexOf(name);
      if (idx !== -1) stack.splice(idx);
    } else if (!isSelfClose) {
      stack.push(name);
    }

    i += full.length;
  }

  let closers = "";
  for (let j = stack.length - 1; j >= 0; j--) {
    closers += `</${stack[j]}>`;
  }
  return html + closers;
}

function runLiveBuildHelpersInDoc(doc) {
  try {
    doc.querySelectorAll("template").forEach((t) => {
      if (t.dataset.gitreplayShown) return;
      const d = doc.createElement("div");
      d.setAttribute("data-gitreplay-template-preview", "");
      d.innerHTML = t.innerHTML;
      t.parentNode.insertBefore(d, t.nextSibling);
      t.dataset.gitreplayShown = "1";
    });
    doc
      .querySelectorAll(
        ".login-redirect-msg,.page-loader,#loader,.preloader,[data-loading-screen]"
      )
      .forEach((el) => {
        if (el.closest("head")) return;
        el.style.setProperty("display", "none", "important");
      });
  } catch {
    /* ignore */
  }
}

function injectLiveBuildHelpers(html) {
  const helper = `<script data-gitreplay-live>(function(){try{document.querySelectorAll('template').forEach(function(t){if(t.dataset.gitreplayShown)return;var d=document.createElement('div');d.setAttribute('data-gitreplay-template-preview','');d.innerHTML=t.innerHTML;t.parentNode.insertBefore(d,t.nextSibling);t.dataset.gitreplayShown='1';});document.querySelectorAll('.login-redirect-msg,.page-loader,#loader,.preloader,[data-loading-screen]').forEach(function(el){if(el.closest('head'))return;el.style.setProperty('display','none','important');});}catch(e){}})();<\/script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${helper}</body>`);
  return `${html}${helper}`;
}

function closePartialHtml(html) {
  let doc = html;
  if (/<\/html>/i.test(doc)) return doc;
  if (/<\/body>/i.test(doc)) return `${doc}</html>`;
  if (/<body[\s>]/i.test(doc)) return `${doc}</body></html>`;
  if (/<\/head>/i.test(doc)) return `${doc}<body></body></html>`;
  if (/<head[\s>]/i.test(doc)) return `${doc}</head><body></body></html>`;
  if (/<html[\s>]/i.test(doc)) return `${doc}<head></head><body></body></html>`;
  return doc;
}

function stripBaseTags(html) {
  return html.replace(/<base[^>]*>/gi, "");
}

function injectPreviewBoot(html, htmlPath) {
  if (!htmlPath) return html;
  const pagePath = htmlPath.startsWith("/") ? htmlPath : `/${htmlPath}`;
  const boot = `<script data-gitreplay-boot>(function(){try{history.replaceState({},"",${JSON.stringify(pagePath)});}catch(e){}})();<\/script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${boot}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${boot}</head>`);
  }
  return `${boot}${html}`;
}

function stripInlinedLocalAssets(html, htmlPath, fileCache) {
  if (!htmlPath) return html;

  let doc = html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = htmlTagAttr(tag, "rel")?.toLowerCase() ?? "";
    const href = htmlTagAttr(tag, "href");
    if (!href) return tag;
    if (rel && !rel.includes("stylesheet") && !rel.includes("modulepreload")) return tag;
    if (/^https?:\/\//i.test(href) || href.startsWith("//")) return tag;
    const resolved = resolvePathInCache(href, htmlPath, fileCache);
    return resolved && fileCache.has(resolved) ? "" : tag;
  });

  doc = doc.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>\s*<\/script>/gi, (tag) => {
    const src = htmlTagAttr(tag, "src");
    if (!src) return tag;
    if (/^https?:\/\//i.test(src) || src.startsWith("//")) return tag;
    const resolved = resolvePathInCache(src, htmlPath, fileCache);
    return resolved && fileCache.has(resolved) ? "" : tag;
  });

  doc = doc.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*\/>/gi, (tag) => {
    const src = htmlTagAttr(tag, "src");
    if (!src) return tag;
    if (/^https?:\/\//i.test(src) || src.startsWith("//")) return tag;
    const resolved = resolvePathInCache(src, htmlPath, fileCache);
    return resolved && fileCache.has(resolved) ? "" : tag;
  });

  return doc
    .replace(/<script[^>]+src=["'][^"']*["']?[^>]*$/gi, "")
    .replace(/<link[^>]+href=["'][^"']*["']?[^>]*$/gi, "");
}

function stripExternalAssets(html) {
  return stripInlinedLocalAssets(html, null, new Map());
}

function wrapSvg(svg) {
  const trimmed = svg.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<html")) return trimmed;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff}</style></head><body>${trimmed}</body></html>`;
}

const MEDIA_PREVIEW_CSS = `
body {
  margin: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #111;
}
img, video {
  max-width: 100%;
  max-height: 100vh;
  object-fit: contain;
}
audio {
  width: min(480px, 90vw);
}
`;

function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function buildMediaDocument(url, path, kind) {
  const name = escapeAttr(path.split("/").pop() ?? "media");
  const src = escapeAttr(url);
  const style = `<style>${MEDIA_PREVIEW_CSS}</style>`;

  if (kind === "video") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${style}</head><body><video src="${src}" controls playsinline></video></body></html>`;
  }
  if (kind === "audio") {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">${style}</head><body><audio src="${src}" controls></audio></body></html>`;
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${style}</head><body><img src="${src}" alt="${name}"></body></html>`;
}

function mediaPreviewLabel(path) {
  return path?.split("/").pop() ?? "Media";
}

function escapeStyleText(css) {
  return css.replace(/<\/style/gi, "<\\/style");
}

function escapeScriptText(js) {
  return js.replace(/<\/script/gi, "<\\/script");
}

function injectStyleBlocks(html, blocks) {
  const tags = blocks
    .filter((block) => block.css?.trim())
    .map((block) => `<style data-gitreplay-${block.id}>${escapeStyleText(block.css)}</style>`)
    .join("");
  if (!tags) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${tags}</head>`);
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}<head><meta charset="utf-8">${tags}</head>`);
  }
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${tags}</head><body>${html}</body></html>`;
}

function injectJs(html, js, options = {}) {
  if (!js.trim()) return html;
  const { module = false } = options;
  const typeAttr = module ? ' type="module"' : "";
  const tag = `<script data-gitreplay${typeAttr}>${escapeScriptText(js)}<\/script>`;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tag}</body>`);
  return `${html}${tag}`;
}

function injectScripts(html, scripts) {
  const tags = scripts
    .filter((script) => script.content?.trim())
    .map((script) => {
      const typeAttr = script.module ? ' type="module"' : "";
      return `<script data-gitreplay${typeAttr}>${escapeScriptText(script.content)}<\/script>`;
    })
    .join("");
  if (!tags) return html;
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${tags}</body>`);
  return `${html}${tags}`;
}

function ensureDoctype(html) {
  const trimmed = html.trim();
  if (trimmed.startsWith("<!DOCTYPE") || trimmed.startsWith("<!doctype")) return trimmed;
  return `<!DOCTYPE html>${trimmed}`;
}

function previewLabel(stack) {
  if (stack.htmlPath) return stack.htmlPath.split("/").pop() ?? "HTML";
  if (stack.html) return "HTML";
  return "—";
}

export function createPreviewController(frameEl, emptyEl, statusEl) {
  const fileCache = new Map();
  let blobUrl = null;
  let lastDoc = null;
  let lastGoodDoc = null;
  let hasDocument = false;
  let liveFlushTimer = null;
  let pendingLiveDoc = null;
  let liveShellReady = false;

  const LIVE_FLUSH_MS = 80;
  const BUILDING_DOC =
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"></head><body></body></html>";

  function setFile(path, content) {
    if (!path) return;
    fileCache.set(path, content);
  }

  function showFrame() {
    frameEl.classList.remove("hidden-frame");
    emptyEl.classList.add("hidden");
  }

  function cancelLiveFlush() {
    if (liveFlushTimer) {
      clearTimeout(liveFlushTimer);
      liveFlushTimer = null;
    }
    pendingLiveDoc = null;
  }

  function isGitreplayInjected(el) {
    return (
      el?.hasAttribute?.("data-gitreplay-site") ||
      el?.hasAttribute?.("data-gitreplay-safe") ||
      el?.hasAttribute?.("data-gitreplay-build") ||
      el?.hasAttribute?.("data-gitreplay-boot") ||
      el?.hasAttribute?.("data-gitreplay-live")
    );
  }

  let liveBuildActive = false;

  function isIgnoredScrollTarget(el) {
    if (!el || el.nodeType !== 1) return true;
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "NOSCRIPT") return true;
    if (isGitreplayInjected(el)) return true;
    if (tag === "SCRIPT" && el.hasAttribute("data-gitreplay")) return true;
    return false;
  }

  function findLastBuildTarget(body) {
    if (!body) return null;

    let best = null;
    let bestBottom = -Infinity;

    const visit = (el) => {
      if (isIgnoredScrollTarget(el)) return;
      const rect = el.getBoundingClientRect?.();
      if (rect && (rect.height > 0 || rect.width > 0) && rect.bottom >= bestBottom) {
        bestBottom = rect.bottom;
        best = el;
      }
      for (const child of el.children) visit(child);
    };

    for (const child of body.children) visit(child);
    return best;
  }

  function scrollOverflowParents(el) {
    let parent = el?.parentElement;
    const view = el?.ownerDocument?.defaultView;
    while (parent && view) {
      const style = view.getComputedStyle(parent);
      const scrollable =
        style.overflowY === "auto" ||
        style.overflowY === "scroll" ||
        style.overflow === "auto" ||
        style.overflow === "scroll";
      if (scrollable && parent.scrollHeight > parent.clientHeight + 1) {
        parent.scrollTop = parent.scrollHeight;
      }
      parent = parent.parentElement;
    }
  }

  function applyPreviewScroll(win, doc, targetEl) {
    if (!win || !doc) return;

    const root = doc.documentElement;
    const body = doc.body;
    const scrollHeight = Math.max(
      root?.scrollHeight ?? 0,
      body?.scrollHeight ?? 0,
      root?.offsetHeight ?? 0,
      body?.offsetHeight ?? 0
    );
    const viewHeight = win.innerHeight || root?.clientHeight || body?.clientHeight || 0;
    const top = Math.max(0, scrollHeight - viewHeight);

    if (targetEl?.isConnected) {
      targetEl.scrollIntoView({ block: "end", inline: "nearest", behavior: "auto" });
      scrollOverflowParents(targetEl);
    }

    win.scrollTo({ top, left: 0, behavior: "auto" });
    const scrollingEl = doc.scrollingElement || root;
    if (scrollingEl) scrollingEl.scrollTop = top;
    if (body && body !== scrollingEl) body.scrollTop = top;
  }

  function scrollPreviewToBuildEdge(win, iframeDoc) {
    if (!win || !iframeDoc) return;

    const tick = () => {
      const target = findLastBuildTarget(iframeDoc.body);
      applyPreviewScroll(win, iframeDoc, target);
    };

    requestAnimationFrame(() => {
      tick();
      requestAnimationFrame(tick);
    });
    setTimeout(tick, 0);
    setTimeout(tick, 60);
  }

  function writeFullDocument(doc) {
    lastDoc = doc;
    lastGoodDoc = doc;
    hasDocument = true;
    showFrame();

    try {
      const docEl = frameEl.contentDocument;
      if (docEl) {
        docEl.open();
        docEl.write(doc);
        docEl.close();
        if (liveBuildActive) {
          scrollPreviewToBuildEdge(frameEl.contentWindow, docEl);
        }
        return true;
      }
    } catch {
      /* fall through */
    }

    frameEl.removeAttribute("src");
    frameEl.srcdoc = doc;
    if (liveBuildActive) {
      frameEl.onload = () => {
        frameEl.onload = null;
        scrollPreviewToBuildEdge(frameEl.contentWindow, frameEl.contentDocument);
      };
    }
    return true;
  }

  function syncGitreplayHead(iframeDoc, parsedHead) {
    for (const attr of ["data-gitreplay-site", "data-gitreplay-safe", "data-gitreplay-build"]) {
      const existing = iframeDoc.head.querySelector(`style[${attr}]`);
      const next = parsedHead.querySelector(`style[${attr}]`);
      if (next) {
        if (existing) existing.textContent = next.textContent;
        else iframeDoc.head.appendChild(next.cloneNode(true));
      } else if (existing) {
        existing.remove();
      }
    }
  }

  function syncUserHead(iframeDoc, parsedHead) {
    for (const el of [...iframeDoc.head.children]) {
      if (isGitreplayInjected(el)) continue;
      if (el.tagName === "META" && el.hasAttribute("charset")) continue;
      el.remove();
    }

    for (const el of parsedHead.children) {
      if (isGitreplayInjected(el)) continue;
      if (el.tagName === "META" && el.getAttribute("charset")) continue;
      iframeDoc.head.appendChild(el.cloneNode(true));
    }
  }

  function patchBodyContent(iframeDoc, parsedBody) {
    const helpers = [
      ...iframeDoc.body.querySelectorAll(
        'script[data-gitreplay-live], script[data-gitreplay-boot]'
      ),
    ];
    let html = parsedBody.innerHTML
      .replace(/<script\b[^>]*data-gitreplay-live[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<script\b[^>]*data-gitreplay-boot[^>]*>[\s\S]*?<\/script>/gi, "");
    iframeDoc.body.innerHTML = html;
    for (const node of helpers) iframeDoc.body.appendChild(node);
    runLiveBuildHelpersInDoc(iframeDoc);
  }

  function patchLiveDocument(docHtml) {
    const win = frameEl.contentWindow;
    const iframeDoc = frameEl.contentDocument;
    if (!iframeDoc || !win) {
      writeFullDocument(docHtml);
      liveShellReady = true;
      return;
    }

    const scrollX = win.scrollX;
    const scrollY = win.scrollY;

    if (!liveShellReady) {
      writeFullDocument(docHtml);
      liveShellReady = true;
      return;
    }

    const parsed = new DOMParser().parseFromString(docHtml, "text/html");
    syncUserHead(iframeDoc, parsed.head);
    syncGitreplayHead(iframeDoc, parsed.head);
    patchBodyContent(iframeDoc, parsed.body);

    if (liveBuildActive) {
      scrollPreviewToBuildEdge(win, iframeDoc);
    } else {
      requestAnimationFrame(() => {
        win.scrollTo(scrollX, scrollY);
      });
    }

    lastDoc = docHtml;
    lastGoodDoc = docHtml;
    hasDocument = true;
    showFrame();
  }

  function flushLiveDocument() {
    liveFlushTimer = null;
    const doc = pendingLiveDoc;
    pendingLiveDoc = null;
    if (!doc) return;
    if (doc === lastDoc) {
      if (liveBuildActive) {
        scrollPreviewToBuildEdge(frameEl.contentWindow, frameEl.contentDocument);
      }
      return;
    }
    patchLiveDocument(doc);
  }

  function scheduleLiveDocument(doc, immediate = false) {
    pendingLiveDoc = doc;
    lastGoodDoc = doc;
    hasDocument = true;
    showFrame();

    if (immediate) {
      cancelLiveFlush();
      patchLiveDocument(doc);
      return;
    }

    if (!liveFlushTimer) {
      liveFlushTimer = setTimeout(flushLiveDocument, LIVE_FLUSH_MS);
    }
  }

  function mountDocument(doc, force = false, liveUpdate = false) {
    if (!force && doc === lastDoc) {
      showFrame();
      return false;
    }

    if (liveUpdate) {
      scheduleLiveDocument(doc, force);
      return true;
    }

    cancelLiveFlush();
    liveShellReady = false;
    lastDoc = doc;
    lastGoodDoc = doc;
    hasDocument = true;
    showFrame();

    const nextUrl = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
    const prevUrl = blobUrl;
    frameEl.removeAttribute("srcdoc");
    frameEl.onload = () => {
      if (prevUrl && prevUrl !== blobUrl) URL.revokeObjectURL(prevUrl);
      frameEl.onload = null;
    };
    frameEl.src = nextUrl;
    blobUrl = nextUrl;
    return true;
  }

  function refresh(activePath, options = {}) {
    const {
      allowPartialJs = true,
      allowPartialCss = true,
      liveBuild = false,
      building = false,
      keepLast = true,
      forceMount = false,
      bundle = null,
      mediaUrl = null,
      resolveAssetUrl = null,
      bundledScript = null,
    } = options;
    const wasLiveBuild = liveBuildActive;
    liveBuildActive = liveBuild;
    const stack = mediaUrl ? null : getWebStack(fileCache, activePath, { liveBuild, bundle });
    const doc = buildPreviewDocument(fileCache, activePath, {
      allowPartialJs,
      allowPartialCss,
      liveBuild,
      building,
      bundle,
      mediaUrl,
      resolveAssetUrl,
      bundledScript,
    });

    if (!doc) {
      if (liveBuild && lastGoodDoc) {
        showFrame();
        statusEl.textContent = stack ? previewLabel(stack) : "Building…";
        return stack;
      }
      if (building) {
        mountDocument(BUILDING_DOC, true, true);
        statusEl.textContent = "Building…";
        return stack;
      }
      if (keepLast && hasDocument) {
        showFrame();
        return stack;
      }
      frameEl.classList.add("hidden-frame");
      emptyEl.classList.remove("hidden");
      statusEl.textContent = "—";
      return null;
    }

    mountDocument(doc, forceMount || (wasLiveBuild && !liveBuild), liveBuild);
    statusEl.textContent = mediaUrl
      ? mediaPreviewLabel(activePath)
      : stack
        ? previewLabel(stack)
        : "Building…";
    return stack;
  }

  let bundleCacheKey = "";
  let bundleCacheScript = null;
  let bundleCacheError = null;
  let bundleCachePending = null;

  async function resolvePreviewBundle(activePath, options = {}) {
    const stack = getWebStack(fileCache, activePath, {
      liveBuild: options.liveBuild,
      bundle: options.bundle,
    });
    if (!stack || !needsPreviewBundle(stack, fileCache, stack.htmlPath)) {
      bundleCacheKey = "";
      bundleCacheScript = null;
      bundleCacheError = null;
      return null;
    }

    const entry = pickBundleEntry(stack);
    if (!entry) return null;

    if (options.liveBuild && options.fullEntryLength) {
      const partial = fileCache.get(entry) ?? "";
      if (partial.length < options.fullEntryLength) return bundleCacheScript;
    }

    const cacheKey = [...fileCache.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, content]) => `${path}:${content.length}`)
      .join("\n");
    if (cacheKey === bundleCacheKey && bundleCacheScript) return bundleCacheScript;
    if (bundleCachePending && bundleCacheKey === cacheKey) {
      return bundleCachePending;
    }

    bundleCacheKey = cacheKey;
    bundleCachePending = bundlePreviewEntry(fileCache, entry)
      .then((script) => {
        bundleCacheScript = normalizeBundledPreview(script);
        bundleCacheError = getBundleError(script);
        bundleCachePending = null;
        return bundleCacheScript;
      })
      .catch((err) => {
        bundleCacheError = err?.message ?? String(err);
        bundleCachePending = null;
        return null;
      });
    return bundleCachePending;
  }

  async function refreshAsync(activePath, options = {}) {
    const stack = getWebStack(fileCache, activePath, {
      liveBuild: options.liveBuild,
      bundle: options.bundle,
    });
    const entry = stack ? pickBundleEntry(stack) : null;
    const needsBundle = Boolean(
      stack && needsPreviewBundle(stack, fileCache, stack.htmlPath)
    );
    const entryComplete =
      !options.liveBuild ||
      !options.fullEntryLength ||
      (entry && (fileCache.get(entry)?.length ?? 0) >= options.fullEntryLength);

    if (needsBundle && entryComplete && !options.bundledScript) {
      statusEl.textContent = "Bundling…";
    }

    const bundledScript =
      options.bundledScript ?? (await resolvePreviewBundle(activePath, options));

    if (!normalizeBundledPreview(bundledScript) && needsBundle && entryComplete) {
      const errDoc = buildBundleErrorDocument(
        stack.htmlPath,
        entry,
        bundleCacheError ?? ""
      );
      mountDocument(errDoc, true, options.liveBuild);
      statusEl.textContent = "Bundle failed";
      return stack;
    }

    return refresh(activePath, { ...options, bundledScript: bundledScript ?? undefined });
  }

  function clear() {
    cancelLiveFlush();
    liveShellReady = false;
    liveBuildActive = false;
    fileCache.clear();
    lastDoc = null;
    lastGoodDoc = null;
    hasDocument = false;
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
    frameEl.removeAttribute("src");
    frameEl.srcdoc = "";
    frameEl.classList.add("hidden-frame");
    emptyEl.classList.remove("hidden");
    statusEl.textContent = "—";
  }

  function invalidate() {
    lastDoc = null;
  }

  function beginLiveBuild() {
    cancelLiveFlush();
    lastDoc = null;
    lastGoodDoc = null;
    liveShellReady = false;
    hasDocument = false;
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    }
    frameEl.removeAttribute("src");
    frameEl.removeAttribute("srcdoc");
    showFrame();
    emptyEl.classList.add("hidden");
    frameEl.classList.remove("hidden-frame");
  }

  async function refreshMarkdown(activePath, markdown, options = {}) {
    const {
      liveBuild = false,
      keepLast = true,
      forceMount = false,
      resolveAssetUrl = null,
      repoLinkUrl = null,
    } = options;

    liveBuildActive = false;

    try {
      const doc = await buildMarkdownDocument(markdown ?? "", {
        filePath: activePath,
        resolveAssetUrl,
        repoLinkUrl,
        partial: liveBuild,
      });
      mountDocument(doc, forceMount, false);
      statusEl.textContent = markdownPreviewLabel(activePath);
      return doc;
    } catch (err) {
      console.warn("GitReplay markdown preview failed:", err);
      if (keepLast && hasDocument) {
        showFrame();
        return null;
      }
      frameEl.classList.add("hidden-frame");
      emptyEl.classList.remove("hidden");
      statusEl.textContent = "—";
      return null;
    }
  }

  return {
    setFile,
    refresh,
    refreshAsync,
    refreshMarkdown,
    resolvePreviewBundle,
    clear,
    invalidate,
    beginLiveBuild,
    fileCache,
    getWebStack: (activePath, opts = {}) => getWebStack(fileCache, activePath, opts),
    hasDocument: () => hasDocument,
  };
}
