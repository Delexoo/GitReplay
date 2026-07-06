import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config({ path: ".env.local" });
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "8kb" }));
const PORT = process.env.PORT ?? 8080;
const IS_PROD = process.env.NODE_ENV === "production";

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;
/** @type {Map<string, { status: number, body: string, expires: number }>} */
const apiCache = new Map();

function githubHeaders() {
  const headers = { ...GITHUB_HEADERS };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function cacheKey(url) {
  return url;
}

function readCache(url) {
  const entry = apiCache.get(cacheKey(url));
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    apiCache.delete(cacheKey(url));
    return null;
  }
  return entry;
}

function writeCache(url, status, body) {
  if (!status || status < 200 || status >= 300) return;
  if (apiCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = apiCache.keys().next().value;
    if (oldest) apiCache.delete(oldest);
  }
  apiCache.set(cacheKey(url), {
    status,
    body,
    expires: Date.now() + CACHE_TTL_MS,
  });
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    authenticated: !!process.env.GITHUB_TOKEN,
    cacheEntries: apiCache.size,
  });
});

app.post("/api/validate-token", async (req, res) => {
  const token = String(req.body?.token ?? "").trim();
  if (!token) {
    res.status(400).json({ valid: false, message: "Paste a GitHub token to continue" });
    return;
  }

  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        ...GITHUB_HEADERS,
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      res.json({ valid: true });
      return;
    }

    let message = "Invalid GitHub token. Create one with no scopes for public repos.";
    try {
      const body = await response.json();
      if (body.message) message = body.message;
    } catch {
      /* ignore */
    }
    res.json({ valid: false, message });
  } catch {
    res.status(502).json({
      valid: false,
      message: "Could not reach GitHub. Check your connection and try again.",
      networkError: true,
    });
  }
});

app.get("/api/github/*path", async (req, res) => {
  const apiPath = req.params.path;
  const queryIndex = req.originalUrl.indexOf("?");
  const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
  const url = `https://api.github.com/${apiPath}${query}`;

  const cached = readCache(url);
  if (cached) {
    res.setHeader("X-GitReplay-Cache", "HIT");
    res.status(cached.status);
    res.setHeader("Content-Type", "application/json");
    res.send(cached.body);
    return;
  }

  try {
    const response = await fetch(url, { headers: githubHeaders() });
    const body = await response.text();

    writeCache(url, response.status, body);

    res.setHeader("X-GitReplay-Cache", "MISS");
    res.status(response.status);
    res.setHeader("Content-Type", "application/json");
    res.send(body);
  } catch {
    res.status(502).json({ message: "Failed to reach GitHub API" });
  }
});

app.use(express.static(__dirname));

app.listen(PORT, "0.0.0.0", () => {
  const auth = process.env.GITHUB_TOKEN ? "with API token" : "unauthenticated (rate limits apply)";
  console.log(`GitReplay listening on :${PORT} (${auth})`);
  if (IS_PROD && !process.env.GITHUB_TOKEN) {
    console.warn(
      "WARNING: GITHUB_TOKEN is not set. Set it in your host's environment variables before going public."
    );
  }
});
