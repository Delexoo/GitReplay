const ESBUILD_VER = "0.25.8";

const IMPORT_META_ENV_STUB = JSON.stringify({
  MODE: "development",
  DEV: true,
  PROD: false,
  BASE_URL: "/",
  SSR: false,
});

let esbuildInit = null;

async function getEsbuild() {
  if (!esbuildInit) {
    esbuildInit = (async () => {
      const esbuild = await import(
        `https://cdn.jsdelivr.net/npm/esbuild-wasm@${ESBUILD_VER}/esm/browser.js`
      );
      await esbuild.initialize({
        wasmURL: `https://cdn.jsdelivr.net/npm/esbuild-wasm@${ESBUILD_VER}/esm/esbuild.wasm`,
        worker: false,
      });
      return esbuild;
    })();
  }
  return esbuildInit;
}

function loaderForPath(path) {
  const clean = path.split("?")[0];
  if (/\.tsx$/i.test(clean)) return "tsx";
  if (/\.ts$/i.test(clean)) return "ts";
  if (/\.jsx$/i.test(clean)) return "jsx";
  if (/\.json$/i.test(clean)) return "json";
  if (/\.css$/i.test(clean)) return "css";
  if (/\.svg$/i.test(clean)) return "dataurl";
  return "js";
}

function stripImportQuery(specifier) {
  return specifier.split("?")[0];
}

function resolveAlias(specifier) {
  if (specifier.startsWith("@/")) return `src/${specifier.slice(2)}`;
  if (specifier.startsWith("~/")) return specifier.slice(2);
  return specifier;
}

function normalizeImportPath(baseFile, rel) {
  const clean = stripImportQuery(rel);
  if (!clean || /^https?:\/\//i.test(clean) || clean.startsWith("//") || clean.startsWith("data:")) {
    return null;
  }

  const baseDir = baseFile?.includes("/") ? baseFile.split("/").slice(0, -1) : [];
  const parts = clean.startsWith("/")
    ? clean.slice(1).split("/")
    : [...baseDir, ...clean.split("/")];
  const stack = [];
  for (const part of parts) {
    if (part === "..") stack.pop();
    else if (part !== "." && part) stack.push(part);
  }
  return stack.join("/");
}

function resolveInFiles(specifier, importer, files) {
  const clean = stripImportQuery(specifier);

  if (clean.startsWith("/")) {
    const rootPath = clean.slice(1);
    const candidates = [
      rootPath,
      `${rootPath}.ts`,
      `${rootPath}.tsx`,
      `${rootPath}.js`,
      `${rootPath}.jsx`,
      `${rootPath}/index.ts`,
      `${rootPath}/index.tsx`,
      `${rootPath}/index.js`,
      `${rootPath}/index.jsx`,
    ];
    for (const candidate of candidates) {
      if (files.has(candidate)) return candidate;
    }
    return null;
  }

  if (!clean.startsWith(".")) return null;

  const resolved = normalizeImportPath(importer, clean);
  if (!resolved) return null;

  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    `${resolved}.js`,
    `${resolved}.jsx`,
    `${resolved}/index.ts`,
    `${resolved}/index.tsx`,
    `${resolved}/index.js`,
    `${resolved}/index.jsx`,
  ];
  for (const candidate of candidates) {
    if (files.has(candidate)) return candidate;
  }

  const name = resolved.split("/").pop()?.toLowerCase();
  if (!name) return null;
  for (const key of files.keys()) {
    if (key.split("/").pop()?.toLowerCase() === name) return key;
  }
  return null;
}

function esmShUrl(specifier) {
  return `https://esm.sh/${specifier}?dev`;
}

function patchSourceForPreview(source, path) {
  let code = source;
  if (/\.(tsx?|jsx?|js)$/i.test(path)) {
    code = code.replace(/import\.meta\.env\b/g, `(${IMPORT_META_ENV_STUB})`);
  }
  if (path.endsWith("?raw") || /\?raw['"]/.test(path)) {
    return `export default ${JSON.stringify(source)};`;
  }
  if (path.includes("?url")) {
    return `export default "";`;
  }
  return code;
}

function createFsPlugin(files) {
  return {
    name: "gitreplay-fs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.namespace === "gitreplay-external") {
          return { path: args.path, external: true };
        }

        const local = resolveInFiles(args.path, args.importer, files);
        if (local) {
          return { path: local, namespace: "gitreplay" };
        }

        if (!args.path.startsWith(".") && !args.path.startsWith("/")) {
          return {
            path: esmShUrl(args.path),
            namespace: "gitreplay-external",
            external: true,
          };
        }

        return { path: args.path, external: true };
      });

      build.onLoad({ filter: /.*/, namespace: "gitreplay" }, (args) => {
        const raw = files.get(args.path) ?? "";
        const contents = patchSourceForPreview(raw, args.path);
        return { contents, loader: loaderForPath(args.path) };
      });
    },
  };
}

export async function bundlePreviewEntry(filesMap, entryPath) {
  const files = filesMap instanceof Map ? filesMap : new Map(Object.entries(filesMap));
  if (!entryPath || !files.has(entryPath)) return null;

  try {
    const esbuild = await getEsbuild();
    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      format: "esm",
      target: "es2020",
      jsx: "automatic",
      jsxImportSource: "react",
      plugins: [createFsPlugin(files)],
      logLevel: "silent",
    });

    const jsFile =
      result.outputFiles.find((f) => /\.m?js$/i.test(f.path)) ?? result.outputFiles[0];
    const css = result.outputFiles
      .filter((f) => /\.css$/i.test(f.path))
      .map((f) => f.text)
      .join("\n");

    if (!jsFile?.text?.trim()) return null;
    return { js: jsFile.text, css };
  } catch (err) {
    const message = err?.message ?? String(err);
    console.warn("GitReplay preview bundle failed:", message);
    return { error: message };
  }
}

export function normalizeBundledPreview(bundle) {
  if (!bundle) return null;
  if (typeof bundle === "string") return { js: bundle, css: "" };
  if (bundle.error) return null;
  if (bundle.js?.trim()) return { js: bundle.js, css: bundle.css ?? "" };
  return null;
}

export function getBundleError(bundle) {
  if (!bundle || typeof bundle !== "object") return null;
  return bundle.error ?? null;
}
