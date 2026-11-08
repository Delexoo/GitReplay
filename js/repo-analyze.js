/**
 * Lightweight repo classification from the file tree + optional package.json / README.
 */

function flattenPaths(nodes, out = []) {
  for (const node of nodes ?? []) {
    if (node.type === "file") out.push(node.path);
    else if (node.children?.length) flattenPaths(node.children, out);
  }
  return out;
}

function hasPath(paths, re) {
  return paths.some((p) => re.test(p));
}

function countMatching(paths, re) {
  return paths.filter((p) => re.test(p)).length;
}

function parsePackageJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function depsOf(pkg) {
  if (!pkg) return new Set();
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
    ...Object.keys(pkg.optionalDependencies ?? {}),
  ]);
}

function scoreHtmlPages(paths) {
  return paths
    .filter((p) => /\.(html?|htm)$/i.test(p))
    .filter((p) => !/(^|\/)(node_modules|coverage|\.git)\//i.test(p))
    .sort((a, b) => {
      const score = (p) => {
        const name = p.split("/").pop()?.toLowerCase() ?? "";
        let s = 3;
        if (name === "index.html") s = 0;
        if (/(^|\/)(dist|build|out)\//i.test(p)) s -= 10;
        if (/(^|\/)docs\//i.test(p)) s -= 5;
        return s;
      };
      return score(a) - score(b) || a.localeCompare(b);
    });
}

/**
 * @returns {{
 *   kind: 'website' | 'desktop-app' | 'web-app' | 'library' | 'generic',
 *   label: string,
 *   summary: string,
 *   htmlPages: string[],
 *   primaryHtml: string | null,
 *   signals: string[],
 *   modes: Array<{ id: string, title: string, blurb: string, primary?: boolean }>
 * }}
 */
export function analyzeRepo({
  owner,
  repo,
  description = "",
  language = "",
  tree = [],
  packageJsonRaw = null,
  readmeRaw = null,
} = {}) {
  const paths = flattenPaths(tree);
  const pkg = parsePackageJson(packageJsonRaw);
  const depNames = depsOf(pkg);
  const htmlPages = scoreHtmlPages(paths);
  const signals = [];

  const hasElectron =
    depNames.has("electron") ||
    hasPath(paths, /(^|\/)electron\./i) ||
    Boolean(pkg?.main && /electron/i.test(String(pkg.main)));
  const hasTauri = depNames.has("@tauri-apps/api") || hasPath(paths, /(^|\/)tauri\.conf/i);
  const hasNw = depNames.has("nw") || depNames.has("nw.js");
  const isDesktop = hasElectron || hasTauri || hasNw;

  const hasVite = depNames.has("vite");
  const hasNext = depNames.has("next");
  const hasNuxt = depNames.has("nuxt");
  const hasReact = depNames.has("react");
  const hasVue = depNames.has("vue");
  const hasSvelte = depNames.has("svelte");
  const hasAstro = depNames.has("astro");
  const isSpaFramework = hasVite || hasNext || hasNuxt || hasReact || hasVue || hasSvelte || hasAstro;

  const htmlCount = htmlPages.length;
  const cssCount = countMatching(paths, /\.css$/i);
  const jsCount = countMatching(paths, /\.(js|mjs|cjs|jsx|ts|tsx)$/i);
  const looksLikeSite = htmlCount > 0 || isSpaFramework;

  if (hasElectron) signals.push("Electron");
  if (hasTauri) signals.push("Tauri");
  if (hasVite) signals.push("Vite");
  if (hasNext) signals.push("Next.js");
  if (hasNuxt) signals.push("Nuxt");
  if (hasReact) signals.push("React");
  if (hasVue) signals.push("Vue");
  if (htmlCount) signals.push(`${htmlCount} HTML page${htmlCount === 1 ? "" : "s"}`);
  if (language) signals.push(language);

  let kind = "generic";
  if (isDesktop) kind = "desktop-app";
  else if (htmlCount >= 2 || (htmlCount >= 1 && (cssCount > 0 || jsCount > 0))) kind = "website";
  else if (isSpaFramework) kind = "web-app";
  else if (pkg && (pkg.main || pkg.module || pkg.exports) && htmlCount === 0) kind = "library";

  const name = `${owner}/${repo}`;
  const descBit = (description || "").trim();
  const readmeBit = (readmeRaw || "").split("\n").find((l) => l.trim() && !l.startsWith("#") && !l.startsWith("["))?.trim() ?? "";
  const about = descBit || readmeBit.slice(0, 140);

  let label = "Project";
  let summary = `Explore ${name} by replaying its source files.`;

  if (kind === "desktop-app") {
    label = "Desktop app";
    summary = about
      ? `${name} looks like a desktop app. ${about}`
      : `${name} looks like a desktop app${signals.length ? ` (${signals.slice(0, 3).join(", ")})` : ""}. We can open it in a simulated computer window you can interact with.`;
  } else if (kind === "website") {
    label = htmlCount >= 2 ? "Multi-page website" : "Website";
    summary = about
      ? `${name} looks like a website. ${about}`
      : `${name} looks like a website with ${htmlCount || "a"} page${htmlCount === 1 ? "" : "s"}. We can rebuild every page live in the preview.`;
  } else if (kind === "web-app") {
    label = "Web app";
    summary = about
      ? `${name} looks like a web app. ${about}`
      : `${name} looks like a web app${signals.length ? ` built with ${signals.slice(0, 3).join(", ")}` : ""}. We can simulate it in an interactive window or replay the source.`;
  } else if (kind === "library") {
    label = "Library / package";
    summary = about
      ? `${name} looks like a code library. ${about}`
      : `${name} looks like a library or package — best experienced by replaying its source files.`;
  } else if (looksLikeSite) {
    kind = "website";
    label = "Web project";
    summary = `${name} contains web files we can rebuild in the live preview.`;
  }

  const modes = [];
  const pushMode = (mode) => {
    if (!modes.some((m) => m.id === mode.id)) modes.push(mode);
  };

  if (kind === "website" || (htmlCount > 0 && kind !== "desktop-app")) {
    pushMode({
      id: "site",
      title: htmlCount >= 2 ? "Replay entire website" : "Build the website live",
      blurb:
        htmlCount >= 2
          ? `Rebuild all ${htmlCount} pages in the live preview, one after another.`
          : "Watch HTML, CSS, and JS assemble into the site preview.",
      primary: kind === "website",
    });
  }

  if (kind === "desktop-app" || kind === "web-app" || (looksLikeSite && kind !== "library")) {
    pushMode({
      id: "app",
      title: kind === "desktop-app" ? "Open in a computer window" : "Open interactive app window",
      blurb:
        kind === "desktop-app"
          ? "Simulate a desktop screen with a window around the UI — click and explore inside it."
          : "Run the UI in a framed app window you can interact with.",
      primary: kind === "desktop-app" || kind === "web-app",
    });
  }

  pushMode({
    id: "files",
    title: "Replay all files",
    blurb: "Classic mode — type out every file in the tree, just like before.",
    primary: kind === "library" || kind === "generic",
  });

  if (!modes.some((m) => m.primary) && modes.length) modes[0].primary = true;

  return {
    kind,
    label,
    summary,
    htmlPages,
    primaryHtml: htmlPages[0] ?? null,
    signals,
    modes,
    name,
  };
}

export function findPackageJsonPath(tree) {
  const paths = flattenPaths(tree);
  if (paths.includes("package.json")) return "package.json";
  return paths.find((p) => /(^|\/)package\.json$/i.test(p) && !p.includes("node_modules")) ?? null;
}

export function findReadmePath(tree) {
  const paths = flattenPaths(tree);
  const exact = paths.find((p) => /^readme\.md$/i.test(p.split("/").pop() ?? ""));
  if (exact) return exact;
  return paths.find((p) => /readme\.md$/i.test(p)) ?? null;
}
