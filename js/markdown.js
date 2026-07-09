const MARKED_VER = "15.0.7";

const REMOTE_URL = /^(https?:|\/\/|data:|#|mailto:|tel:|javascript:)/i;

let markedInit = null;

async function getMarked() {
  if (!markedInit) {
    markedInit = (async () => {
      const { marked } = await import(
        `https://cdn.jsdelivr.net/npm/marked@${MARKED_VER}/lib/marked.esm.js`
      );
      marked.setOptions({
        gfm: true,
        breaks: false,
        headerIds: true,
        mangle: false,
      });
      return marked;
    })();
  }
  return markedInit;
}

export function isMarkdownPath(path) {
  if (!path) return false;
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  return name.endsWith(".md") || name.endsWith(".markdown");
}

function normalizePath(baseFile, rel) {
  if (!rel || REMOTE_URL.test(rel.trim())) return null;

  const baseDir = baseFile?.includes("/") ? baseFile.split("/").slice(0, -1) : [];
  const parts = rel.trim().startsWith("/")
    ? rel.trim().slice(1).split("/")
    : [...baseDir, ...rel.trim().split("/")];
  const stack = [];
  for (const part of parts) {
    if (part === "..") stack.pop();
    else if (part !== "." && part) stack.push(part);
  }
  return stack.join("/");
}

function stabilizePartialMarkdown(text) {
  let doc = text ?? "";
  const fenceCount = (doc.match(/```/g) ?? []).length;
  if (fenceCount % 2 === 1) doc += "\n```";
  return doc;
}

function stripUnsafeHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/\son\w+\s*=\s*(['"])[^'"]*\1/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "");
}

function rewriteMarkdownHtml(html, filePath, resolveAssetUrl, repoLinkUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div class="markdown-body">${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;

  for (const img of root.querySelectorAll("img")) {
    const src = img.getAttribute("src");
    if (!src || REMOTE_URL.test(src.trim())) continue;
    const resolved = normalizePath(filePath, src);
    const remote = resolved ? resolveAssetUrl?.(resolved) : null;
    if (remote) img.setAttribute("src", remote);
  }

  for (const el of root.querySelectorAll("[src]")) {
    const src = el.getAttribute("src");
    if (!src || REMOTE_URL.test(src.trim())) continue;
    const resolved = normalizePath(filePath, src);
    const remote = resolved ? resolveAssetUrl?.(resolved) : null;
    if (remote) el.setAttribute("src", remote);
  }

  for (const a of root.querySelectorAll("a")) {
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#") || REMOTE_URL.test(href.trim())) continue;
    const resolved = normalizePath(filePath, href);
    if (!resolved) continue;
    const asset = resolveAssetUrl?.(resolved);
    const page = repoLinkUrl?.(resolved);
    if (/\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(resolved) && asset) {
      a.setAttribute("href", asset);
    } else if (page) {
      a.setAttribute("href", page);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener");
    } else if (asset) {
      a.setAttribute("href", asset);
    }
  }

  return root.innerHTML;
}

const MARKDOWN_CSS = `
html, body {
  margin: 0;
  background: #ffffff;
  color: #1f2328;
}
body {
  padding: 24px 16px 48px;
}
.markdown-body {
  box-sizing: border-box;
  max-width: 980px;
  margin: 0 auto;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  word-wrap: break-word;
}
.markdown-body > :first-child { margin-top: 0 !important; }
.markdown-body > :last-child { margin-bottom: 0 !important; }
.markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 {
  margin-top: 1.25em;
  margin-bottom: 0.75em;
  font-weight: 600;
  line-height: 1.25;
}
.markdown-body h1 { font-size: 2em; padding-bottom: 0.25em; border-bottom: 1px solid #d8dee4; }
.markdown-body h2 { font-size: 1.5em; padding-bottom: 0.2em; border-bottom: 1px solid #d8dee4; }
.markdown-body h3 { font-size: 1.25em; }
.markdown-body p, .markdown-body ul, .markdown-body ol, .markdown-body blockquote, .markdown-body pre, .markdown-body table, .markdown-body details {
  margin-top: 0;
  margin-bottom: 1em;
}
.markdown-body ul, .markdown-body ol { padding-left: 2em; }
.markdown-body li + li { margin-top: 0.25em; }
.markdown-body blockquote {
  padding: 0 1em;
  color: #656d76;
  border-left: 4px solid #d0d7de;
}
.markdown-body code {
  padding: 0.2em 0.4em;
  font-size: 85%;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  background: rgba(175, 184, 193, 0.2);
  border-radius: 6px;
}
.markdown-body pre {
  padding: 16px;
  overflow: auto;
  font-size: 85%;
  line-height: 1.45;
  background: #f6f8fa;
  border-radius: 6px;
}
.markdown-body pre code {
  padding: 0;
  background: transparent;
  border-radius: 0;
  font-size: inherit;
}
.markdown-body table {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow: auto;
  border-spacing: 0;
  border-collapse: collapse;
}
.markdown-body th, .markdown-body td {
  padding: 6px 13px;
  border: 1px solid #d0d7de;
}
.markdown-body th {
  font-weight: 600;
  background: #f6f8fa;
}
.markdown-body tr:nth-child(2n) { background: #f6f8fa; }
.markdown-body img {
  max-width: 100%;
  height: auto;
  box-sizing: border-box;
  background: #fff;
}
.markdown-body a { color: #0969da; text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }
.markdown-body hr {
  height: 1px;
  margin: 24px 0;
  background: #d8dee4;
  border: 0;
}
.markdown-body details {
  border: 1px solid #d0d7de;
  border-radius: 6px;
  padding: 0.5em 0.75em;
}
.markdown-body summary {
  cursor: pointer;
  font-weight: 600;
  margin: -0.5em -0.75em;
  padding: 0.5em 0.75em;
}
.markdown-body details[open] > summary { margin-bottom: 0.5em; border-bottom: 1px solid #d0d7de; }
.markdown-body input[type="checkbox"] { margin-right: 0.5em; }
`;

export async function buildMarkdownDocument(markdown, options = {}) {
  const { filePath = "README.md", resolveAssetUrl = null, repoLinkUrl = null, partial = false } =
    options;
  const source = partial ? stabilizePartialMarkdown(markdown) : (markdown ?? "");
  if (!source.trim()) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${MARKDOWN_CSS}</style></head><body><article class="markdown-body"></article></body></html>`;
  }

  const marked = await getMarked();
  const rawHtml = marked.parse(source);
  const safeHtml = stripUnsafeHtml(rawHtml);
  const bodyHtml = rewriteMarkdownHtml(safeHtml, filePath, resolveAssetUrl, repoLinkUrl);

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${MARKDOWN_CSS}</style></head><body><article class="markdown-body">${bodyHtml}</article></body></html>`;
}

export function markdownPreviewLabel(path) {
  const name = path?.split("/").pop() ?? "Markdown";
  return name.toLowerCase() === "readme.md" ? "README" : name;
}
