import { parseGitHubUrl, fetchRepoInfo, fetchRepoTree, isRateLimitError } from "./github.js";
import {
  consumePendingRepo,
  navigateToApp,
  navigateToToken,
  setPendingRepo,
  setRepoUrl,
} from "./session-nav.js";

const els = {
  errorBanner: document.getElementById("error-banner"),
  repoInput: document.getElementById("repo-welcome-input"),
  loadBtn: document.getElementById("repo-welcome-btn"),
};

function showError(msg) {
  els.errorBanner.textContent = msg;
  els.errorBanner.classList.remove("hidden");
}

function clearError() {
  els.errorBanner.classList.add("hidden");
}

function setLoading(loading) {
  els.loadBtn.disabled = loading;
  els.loadBtn.textContent = loading ? "Loading…" : "Load";
}

async function loadFromWelcome() {
  const url = els.repoInput.value.trim();
  if (!url) return;

  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    showError("Invalid GitHub URL");
    return;
  }

  clearError();
  setLoading(true);

  try {
    const info = await fetchRepoInfo(parsed.owner, parsed.repo);
    await fetchRepoTree(parsed.owner, parsed.repo, info.defaultBranch);
    setRepoUrl(url);
    setPendingRepo("");
    navigateToApp();
  } catch (err) {
    if (isRateLimitError(err)) {
      setPendingRepo(url);
      navigateToToken({ reason: "rateLimit", returnTo: "welcome.html" });
      return;
    }
    showError(err?.message ?? "Failed to load repository");
  } finally {
    setLoading(false);
  }
}

const pending = consumePendingRepo();
if (pending) els.repoInput.value = pending;

els.loadBtn.addEventListener("click", loadFromWelcome);
els.repoInput.addEventListener("keydown", (e) => e.key === "Enter" && loadFromWelcome());
requestAnimationFrame(() => els.repoInput.focus());
