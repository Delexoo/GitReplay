import { isMarkdownPath } from "./markdown.js";
import { getPreviewMediaKind, isPreviewableMedia, isWebFile } from "./preview.js";

/** Files whose primary view is the Live preview panel, not the code editor. */
export function isPreviewPrimary(path) {
  if (!path) return false;
  if (isMarkdownPath(path)) return true;
  if (isPreviewableMedia(path)) return true;
  return false;
}

/** True when the code panel should not show raw file contents (binary media only). */
export function isCodePanelExempt(path) {
  if (!path) return false;
  if (isMarkdownPath(path)) return false;
  if (/\.svg$/i.test(path)) return false;
  const kind = getPreviewMediaKind(path);
  return kind === "image" || kind === "video" || kind === "audio";
}

export function usesLivePreview(path) {
  if (!path) return false;
  return isPreviewPrimary(path) || isWebFile(path);
}

export function codePanelPlaceholderLabel(path) {
  if (!path) return "Shown in Live preview";
  if (isMarkdownPath(path)) {
    const name = path.split("/").pop() ?? "Markdown";
    return name.toLowerCase() === "readme.md"
      ? "README is rendered in Live preview →"
      : `${name} is rendered in Live preview →`;
  }
  const kind = getPreviewMediaKind(path);
  if (kind === "image") return "Image shown in Live preview →";
  if (kind === "video") return "Video shown in Live preview →";
  if (kind === "audio") return "Audio shown in Live preview →";
  return "Shown in Live preview →";
}
