import {
  clearInvalidUserToken,
  getUserGitHubToken,
  hasUserGitHubToken,
  setUserGitHubToken,
  validateUserGitHubToken,
} from "./github.js";
import {
  consumePendingRepo,
  getTokenReturnUrl,
  navigateToApp,
  resolveReturnPath,
  setRepoUrl,
} from "./session-nav.js";

const params = new URLSearchParams(location.search);
const reason = params.get("reason") ?? "voluntary";
const returnTo = resolveReturnPath(getTokenReturnUrl());

const els = {
  errorBanner: document.getElementById("error-banner"),
  heading: document.getElementById("welcome-token-heading"),
  sub: document.getElementById("welcome-token-sub"),
  tokenInput: document.getElementById("token-input"),
  tokenBtn: document.getElementById("token-btn"),
  backLink: document.getElementById("token-back-link"),
};

function showError(msg) {
  els.errorBanner.textContent = msg;
  els.errorBanner.classList.remove("hidden");
}

function clearError() {
  els.errorBanner.classList.add("hidden");
}

function finishTokenPage() {
  const pending = consumePendingRepo();
  if (pending) {
    setRepoUrl(pending);
    navigateToApp();
    return;
  }
  location.href = returnTo;
}

async function connectToken() {
  const token = els.tokenInput.value.trim();
  if (!token) {
    if (reason === "voluntary") {
      setUserGitHubToken("");
      finishTokenPage();
      return;
    }
    showError("Paste a GitHub token to continue");
    return;
  }

  clearError();
  els.tokenBtn.disabled = true;
  els.tokenBtn.textContent = reason === "rateLimit" ? "Checking…" : "Saving…";

  try {
    const result = await validateUserGitHubToken(token);
    if (result.valid) {
      setUserGitHubToken(token);
      finishTokenPage();
      return;
    }
    showError(result.message ?? "Invalid GitHub token. Create one with no scopes for public repos.");
  } catch {
    showError("Could not verify token. Check your connection and try again.");
  } finally {
    els.tokenBtn.disabled = false;
    els.tokenBtn.textContent = reason === "rateLimit" ? "Continue" : "Save";
  }
}

if (reason === "rateLimit") {
  els.heading.textContent = "Rate limit reached";
  els.sub.textContent = "Add a personal access token to keep loading repos.";
  els.tokenBtn.textContent = "Continue";
  els.backLink.classList.add("hidden");
} else {
  els.heading.textContent = "GitHub token";
  els.sub.textContent =
    "Optional. Stored in this tab only — cleared when you close it.";
  els.tokenBtn.textContent = "Save";
}

els.backLink.href = returnTo;

if (hasUserGitHubToken()) {
  validateUserGitHubToken(getUserGitHubToken()).then((result) => {
    if (!result.valid && !result.networkError) clearInvalidUserToken();
  });
}

const existing = getUserGitHubToken();
if (existing) els.tokenInput.value = existing;

els.tokenBtn.addEventListener("click", connectToken);
els.tokenInput.addEventListener("keydown", (e) => e.key === "Enter" && connectToken());
requestAnimationFrame(() => els.tokenInput.focus());
