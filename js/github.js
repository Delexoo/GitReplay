const memoryCache = new Map();
const CACHE_KEY = "gitreplay_api_cache";
const CACHE_TTL = 60 * 60 * 1000;

const HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

function loadDiskCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw);
    const now = Date.now();
    for (const [key, entry] of Object.entries(entries)) {
      if (now - entry.at < CACHE_TTL) memoryCache.set(key, entry.data);
    }
  } catch {
    /* ignore */
  }
}

function saveDiskCache(key, data) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const entries = raw ? JSON.parse(raw) : {};
    entries[key] = { at: Date.now(), data };
    const now = Date.now();
    for (const k of Object.keys(entries)) {
      if (now - entries[k].at > CACHE_TTL) delete entries[k];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
}

loadDiskCache();

const TOKEN_KEY = "gitreplay_github_token";

function tokenStore() {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Move any legacy localStorage token into sessionStorage once, then drop local copy. */
function migrateLegacyToken() {
  try {
    const legacy = localStorage.getItem(TOKEN_KEY);
    if (!legacy) return;
    const store = tokenStore();
    if (store && !store.getItem(TOKEN_KEY)) store.setItem(TOKEN_KEY, legacy);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

migrateLegacyToken();

export function getUserGitHubToken() {
  try {
    return tokenStore()?.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setUserGitHubToken(token) {
  const trimmed = token.trim();
  const store = tokenStore();
  if (!store) return;
  try {
    if (trimmed) store.setItem(TOKEN_KEY, trimmed);
    else store.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function notifyTokenCleared(reason = "invalid") {
  window.dispatchEvent(new CustomEvent("gitreplay:token-cleared", { detail: { reason } }));
}

export function clearInvalidUserToken() {
  if (!getUserGitHubToken()) return false;
  setUserGitHubToken("");
  notifyTokenCleared("invalid");
  return true;
}

export function hasUserGitHubToken() {
  return Boolean(getUserGitHubToken());
}

async function validateUserGitHubTokenDirect(token) {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.ok) return { valid: true };
    let message = "Invalid GitHub token.";
    try {
      const body = await response.json();
      if (body.message) message = body.message;
    } catch {
      /* ignore */
    }
    return { valid: false, message };
  } catch {
    return {
      valid: false,
      message: "Could not verify token. Check your connection and try again.",
      networkError: true,
    };
  }
}

export async function validateUserGitHubToken(token) {
  return validateUserGitHubTokenDirect(token);
}

function requestHeaders() {
  const headers = { ...HEADERS };
  const userToken = getUserGitHubToken();
  if (userToken) headers.Authorization = `Bearer ${userToken}`;
  return headers;
}

export function isRateLimitError(err) {
  const msg = String(err?.message ?? err ?? "");
  return /rate limit/i.test(msg);
}

function parseApiError(status, body) {
  if (status === 401) {
    if (hasUserGitHubToken()) {
      return "Invalid GitHub token. Check your token and try again.";
    }
    return "GitHub authentication failed. Try again or add a personal access token.";
  }
  if (status === 403 && body.includes("rate limit")) {
    if (hasUserGitHubToken()) {
      return "GitHub rate limit reached on your token. Try again in a few minutes.";
    }
    return "GitHub rate limit reached. Add your GitHub token to continue.";
  }
  try {
    const json = JSON.parse(body);
    return json.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function githubFetch(apiUrl) {
  if (memoryCache.has(apiUrl)) return memoryCache.get(apiUrl);

  let response = await fetch(apiUrl, { headers: requestHeaders() });

  if (response.status === 401 && hasUserGitHubToken()) {
    clearInvalidUserToken();
    response = await fetch(apiUrl, { headers: HEADERS });
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(parseApiError(response.status, body));
  }

  const data = await response.json();
  memoryCache.set(apiUrl, data);
  saveDiskCache(apiUrl, data);
  return data;
}

export function parseGitHubUrl(input) {
  const trimmed = input.trim();
  const patterns = [
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/,
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^([^/]+)\/([^/]+)$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        owner: match[1],
        repo: match[2].replace(/\.git$/, ""),
      };
    }
  }

  return null;
}

function decodeBase64(content) {
  const cleaned = content.replace(/\n/g, "");
  const binary = atob(cleaned);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function fetchRepoInfo(owner, repo) {
  const data = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`);

  return {
    owner,
    repo,
    description: data.description,
    defaultBranch: data.default_branch,
    stars: data.stargazers_count,
    language: data.language,
  };
}

export function buildFileTree(items) {
  const root = [];
  const sorted = [...items].sort((a, b) => a.path.localeCompare(b.path));

  for (const item of sorted) {
    const parts = item.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const currentPath = parts.slice(0, i + 1).join("/");

      if (isLast) {
        current.push({
          path: currentPath,
          type: item.type === "blob" ? "file" : "dir",
          size: item.size,
          children: item.type === "tree" ? [] : undefined,
        });
      } else {
        let dir = current.find((n) => n.path === currentPath && n.type === "dir");
        if (!dir) {
          dir = { path: currentPath, type: "dir", children: [] };
          current.push(dir);
        }
        current = dir.children;
      }
    }
  }

  return root;
}

export async function fetchRepoTree(owner, repo, branch) {
  const data = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  );

  const blobs = data.tree.filter((item) => item.type === "blob");
  return {
    tree: buildFileTree(blobs),
    truncated: data.truncated,
  };
}

export async function fetchFileContent(owner, repo, filePath, ref) {
  const rawPath = filePath.split("/").map(encodeURIComponent).join("/");
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${rawPath}`;

  const rawRes = await fetch(rawUrl);
  if (rawRes.ok) return rawRes.text();

  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const data = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${ref}`
  );

  if (data.encoding === "base64") {
    return decodeBase64(data.content);
  }

  return data.content;
}

export async function fetchCommits(owner, repo, branch, maxPages = 1) {
  const commits = [];

  for (let page = 1; page <= maxPages; page++) {
    const batch = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=30&page=${page}`
    );

    if (batch.length === 0) break;

    commits.push(
      ...batch.map((c) => ({
        sha: c.sha,
        message: c.commit.message.split("\n")[0],
        author: c.commit.author.name,
        date: c.commit.author.date,
      }))
    );

    if (batch.length < 30) break;
  }

  return commits.reverse();
}

function extractAddedChars(patch) {
  if (!patch) return "";

  const lines = patch.split("\n");
  const added = [];

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added.push(line.slice(1));
    }
  }

  return added.join("\n");
}

export async function buildReplayTimeline(owner, repo, branch, maxCommits = 10) {
  const allCommits = await fetchCommits(owner, repo, branch, 1);
  const commitsToProcess = allCommits.slice(-maxCommits);

  const fileContents = new Map();
  const steps = [];
  let stepIndex = 0;

  for (const commit of commitsToProcess) {
    await sleep(100);

    const detail = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${commit.sha}`
    );

    const files = detail.files ?? [];

    for (const file of files) {
      if (file.status === "removed") {
        fileContents.delete(file.filename);
        continue;
      }

      const targetPath =
        file.status === "renamed" && file.previous_filename
          ? file.previous_filename
          : file.filename;

      const previousContent = fileContents.get(targetPath) ?? "";
      const addedChars = extractAddedChars(file.patch);
      const isNewFile = file.status === "added";

      let newContent;
      if (isNewFile) {
        newContent = addedChars;
      } else {
        newContent = previousContent + addedChars;
        if (file.status === "renamed" && file.previous_filename) {
          fileContents.delete(file.previous_filename);
        }
      }

      fileContents.set(file.filename, newContent);

      if (addedChars.length > 0 || isNewFile) {
        steps.push({
          index: stepIndex++,
          path: file.filename,
          commitSha: commit.sha.slice(0, 7),
          commitMessage: commit.message,
          commitDate: commit.date,
          author: commit.author,
          action: file.status === "renamed" ? "renamed" : file.status,
          previousPath: file.previous_filename,
          content: newContent,
          charsAdded: isNewFile ? newContent.length : addedChars.length,
          isNewFile,
        });
      }
    }
  }

  return {
    owner,
    repo,
    defaultBranch: branch,
    totalCommits: commitsToProcess.length,
    steps,
  };
}
