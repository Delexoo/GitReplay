export const SESSION_KEYS = {
  repoUrl: "gitreplay_repo_url",
  pendingRepo: "gitreplay_pending_repo",
  tokenReturn: "gitreplay_token_return",
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

export function navigateToWelcome() {
  location.href = "welcome.html";
}

export function navigateToToken({ reason = "voluntary", returnTo = "welcome.html" } = {}) {
  sessionStorage.setItem(SESSION_KEYS.tokenReturn, returnTo);
  const params = new URLSearchParams({ reason, return: returnTo });
  location.href = `token.html?${params}`;
}

export function navigateToApp() {
  location.href = "index.html";
}

export function getTokenReturnUrl() {
  const fromQuery = new URLSearchParams(location.search).get("return");
  if (fromQuery) return fromQuery;
  return sessionStorage.getItem(SESSION_KEYS.tokenReturn) ?? "welcome.html";
}

export function resolveReturnPath(path) {
  if (!path || path === "index.html" || path === "/") return "index.html";
  if (path === "welcome.html") return "welcome.html";
  if (path.startsWith("http")) return path;
  return path.replace(/^\//, "");
}
