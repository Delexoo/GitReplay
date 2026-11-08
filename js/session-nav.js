export const SESSION_KEYS = {
  repoUrl: "gitreplay_repo_url",
  pendingRepo: "gitreplay_pending_repo",
  oauthState: "gitreplay_oauth_state",
  githubUser: "gitreplay_github_user",
};

export function setRepoUrl(url) {
  if (url) sessionStorage.setItem(SESSION_KEYS.repoUrl, url);
  else sessionStorage.removeItem(SESSION_KEYS.repoUrl);
}

export function getRepoUrl() {
  return sessionStorage.getItem(SESSION_KEYS.repoUrl) ?? "";
}

export function setPendingRepo(url) {
  if (url) sessionStorage.setItem(SESSION_KEYS.pendingRepo, url);
  else sessionStorage.removeItem(SESSION_KEYS.pendingRepo);
}

export function consumePendingRepo() {
  const url = sessionStorage.getItem(SESSION_KEYS.pendingRepo) ?? "";
  sessionStorage.removeItem(SESSION_KEYS.pendingRepo);
  return url;
}

export function setOAuthState(state) {
  if (state) sessionStorage.setItem(SESSION_KEYS.oauthState, state);
  else sessionStorage.removeItem(SESSION_KEYS.oauthState);
}

export function consumeOAuthState() {
  const state = sessionStorage.getItem(SESSION_KEYS.oauthState) ?? "";
  sessionStorage.removeItem(SESSION_KEYS.oauthState);
  return state;
}

export function setCachedGitHubUser(user) {
  try {
    if (user) sessionStorage.setItem(SESSION_KEYS.githubUser, JSON.stringify(user));
    else sessionStorage.removeItem(SESSION_KEYS.githubUser);
  } catch {
    /* ignore */
  }
}

export function getCachedGitHubUser() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEYS.githubUser);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function navigateToHome() {
  location.href = "index.html";
}

/** @deprecated use navigateToHome */
export function navigateToWelcome() {
  navigateToHome();
}

export function navigateToReplay() {
  location.href = "replay.html";
}

/** @deprecated use navigateToReplay */
export function navigateToApp() {
  navigateToReplay();
}
