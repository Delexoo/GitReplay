import { AUTH_API_ORIGIN } from "./config.js";
import {
  clearInvalidUserToken,
  fetchCurrentUser,
  fetchRepoInfo,
  fetchRepoTree,
  fetchUserRepos,
  getUserGitHubToken,
  hasUserGitHubToken,
  isRateLimitError,
  parseGitHubUrl,
  setUserGitHubToken,
  validateUserGitHubToken,
} from "./github.js";
import {
  consumeOAuthState,
  consumePendingRepo,
  getCachedGitHubUser,
  navigateToApp,
  setCachedGitHubUser,
  setOAuthState,
  setPendingRepo,
  setRepoUrl,
} from "./session-nav.js";

const els = {
  errorBanner: document.getElementById("error-banner"),
  guest: document.getElementById("landing-guest"),
  connected: document.getElementById("landing-connected"),
  account: document.getElementById("welcome-account"),
  userLabel: document.getElementById("welcome-user-label"),
  connectBtn: document.getElementById("connect-github-btn"),
  disconnectBtn: document.getElementById("disconnect-btn"),
  repoInput: document.getElementById("repo-welcome-input"),
  loadBtn: document.getElementById("repo-welcome-btn"),
  searchInput: document.getElementById("repo-search-input"),
  repoList: document.getElementById("repo-list"),
};

let userRepos = [];

function showError(msg) {
  els.errorBanner.textContent = msg;
  els.errorBanner.classList.remove("hidden");
}

function clearError() {
  els.errorBanner.classList.add("hidden");
}

function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function consumeOAuthHash() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  return params;
}

async function handleOAuthReturn() {
  const params = consumeOAuthHash();
  if (!params) return false;

  const expected = consumeOAuthState();
  const returnedState = params.get("state") || "";
  if (!expected || returnedState !== expected) {
    showError("Sign-in could not be verified. Try connecting again.");
    return true;
  }

  const error = params.get("error");
  if (error) {
    showError(params.get("error_description") || "GitHub sign-in was cancelled.");
    return true;
  }

  const token = params.get("access_token");
  if (!token) {
    showError("GitHub did not return an access token. Try again.");
    return true;
  }

  setUserGitHubToken(token);
  const check = await validateUserGitHubToken(token);
  if (!check.valid) {
    clearInvalidUserToken();
    setCachedGitHubUser(null);
    showError(check.message || "Could not verify your GitHub account.");
    return true;
  }

  try {
    const user = await fetchCurrentUser();
    setCachedGitHubUser(user);
  } catch (err) {
    showError(err?.message ?? "Connected, but could not load your profile.");
  }

  return true;
}

function startGitHubConnect() {
  clearError();
  const state = randomState();
  setOAuthState(state);
  const returnTo = new URL("welcome.html", location.href).href;
  const login = new URL("/api/github/login", AUTH_API_ORIGIN);
  login.searchParams.set("return", returnTo);
  login.searchParams.set("state", state);
  location.href = login.toString();
}

function disconnect() {
  setUserGitHubToken("");
  setCachedGitHubUser(null);
  userRepos = [];
  clearError();
  showGuest();
}

function showGuest() {
  els.guest.classList.remove("hidden");
  els.connected.classList.add("hidden");
  els.account.classList.add("hidden");
  els.userLabel.textContent = "";
}

function showConnected(user) {
  els.guest.classList.add("hidden");
  els.connected.classList.remove("hidden");
  els.account.classList.remove("hidden");
  els.userLabel.textContent = user?.login ? `@${user.login}` : "Connected";
}

function formatUpdated(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function renderRepoList(filter = "") {
  const q = filter.trim().toLowerCase();
  const filtered = q
    ? userRepos.filter(
        (r) =>
          r.fullName.toLowerCase().includes(q) ||
          (r.description || "").toLowerCase().includes(q)
      )
    : userRepos;

  if (!userRepos.length) {
    els.repoList.innerHTML = `<p class="repo-list-empty">No repositories found for this account.</p>`;
    return;
  }

  if (!filtered.length) {
    els.repoList.innerHTML = `<p class="repo-list-empty">No repositories match “${filter.trim()}”.</p>`;
    return;
  }

  els.repoList.innerHTML = filtered
    .map((repo) => {
      const badge = repo.private ? `<span class="repo-badge">Private</span>` : "";
      const meta = [repo.language, formatUpdated(repo.updatedAt)].filter(Boolean).join(" · ");
      const desc = repo.description
        ? `<span class="repo-desc">${escapeHtml(repo.description)}</span>`
        : "";
      return `
        <button type="button" class="repo-item" role="option" data-full-name="${escapeAttr(repo.fullName)}">
          <span class="repo-item-top">
            <span class="repo-name">${escapeHtml(repo.fullName)}</span>
            ${badge}
          </span>
          ${desc}
          <span class="repo-meta">${escapeHtml(meta)}</span>
        </button>`;
    })
    .join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/'/g, "&#39;");
}

async function loadUserRepos() {
  els.repoList.innerHTML = `<p class="repo-list-empty">Loading repositories…</p>`;
  try {
    userRepos = await fetchUserRepos({ maxPages: 3, perPage: 100 });
    renderRepoList(els.searchInput.value);
  } catch (err) {
    if (isRateLimitError(err)) {
      els.repoList.innerHTML = `<p class="repo-list-empty">GitHub rate limit reached. Try again in a few minutes.</p>`;
      return;
    }
    els.repoList.innerHTML = `<p class="repo-list-empty">${escapeHtml(err?.message ?? "Could not load repositories.")}</p>`;
  }
}

function setLoading(loading) {
  els.loadBtn.disabled = loading;
  els.loadBtn.textContent = loading ? "Loading…" : "Load";
}

async function openRepo(url) {
  const trimmed = url.trim();
  if (!trimmed) return;

  const parsed = parseGitHubUrl(trimmed);
  if (!parsed) {
    showError("Invalid GitHub URL");
    return;
  }

  clearError();
  setLoading(true);

  try {
    const info = await fetchRepoInfo(parsed.owner, parsed.repo);
    await fetchRepoTree(parsed.owner, parsed.repo, info.defaultBranch);
    setRepoUrl(trimmed.includes("/") && !trimmed.includes("github.com")
      ? `https://github.com/${parsed.owner}/${parsed.repo}`
      : trimmed);
    setPendingRepo("");
    navigateToApp();
  } catch (err) {
    if (isRateLimitError(err)) {
      showError(err.message ?? "GitHub rate limit reached. Try again in a few minutes.");
      return;
    }
    showError(err?.message ?? "Failed to load repository");
  } finally {
    setLoading(false);
  }
}

async function bootConnected() {
  let user = getCachedGitHubUser();
  if (!user && hasUserGitHubToken()) {
    const result = await validateUserGitHubToken(getUserGitHubToken());
    if (!result.valid && !result.networkError) {
      clearInvalidUserToken();
      setCachedGitHubUser(null);
      showGuest();
      return;
    }
    if (result.valid) {
      try {
        user = await fetchCurrentUser();
        setCachedGitHubUser(user);
      } catch (err) {
        if (!result.networkError) {
          showError(err?.message ?? "Could not load your GitHub profile.");
        }
      }
    }
  }

  if (!hasUserGitHubToken()) {
    showGuest();
    return;
  }

  showConnected(user);
  const pending = consumePendingRepo();
  if (pending) els.repoInput.value = pending;
  await loadUserRepos();
  requestAnimationFrame(() => els.searchInput.focus());
}

els.connectBtn.addEventListener("click", startGitHubConnect);
els.disconnectBtn.addEventListener("click", disconnect);
els.loadBtn.addEventListener("click", () => openRepo(els.repoInput.value));
els.repoInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") openRepo(els.repoInput.value);
});
els.searchInput.addEventListener("input", () => renderRepoList(els.searchInput.value));
els.repoList.addEventListener("click", (e) => {
  const item = e.target.closest(".repo-item");
  if (!item) return;
  const fullName = item.getAttribute("data-full-name");
  if (fullName) openRepo(fullName);
});

(async () => {
  await handleOAuthReturn();
  await bootConnected();
})();
