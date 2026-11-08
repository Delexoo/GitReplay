const DEFAULT_RETURN = "https://delexoo.github.io/GitReplay/index.html";

function allowedReturns() {
  const extras = (process.env.GITHUB_OAUTH_RETURN_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    "https://delexoo.github.io",
    "http://localhost",
    "http://127.0.0.1",
    ...extras,
  ];
}

function isAllowedReturn(url) {
  try {
    const parsed = new URL(url);
    return allowedReturns().some((origin) => {
      try {
        const allowed = new URL(origin.includes("://") ? origin : `https://${origin}`);
        return parsed.origin === allowed.origin;
      } catch {
        return parsed.href.startsWith(origin);
      }
    });
  } catch {
    return false;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const returnTo = url.searchParams.get("return") || DEFAULT_RETURN;
  const state = url.searchParams.get("state") || "";

  if (!isAllowedReturn(returnTo)) {
    res.statusCode = 400;
    res.end("Invalid return URL.");
    return;
  }

  if (!state || state.length < 8) {
    res.statusCode = 400;
    res.end("Missing or invalid state.");
    return;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    res.statusCode = 500;
    res.end("GitHub OAuth is not configured (missing GITHUB_CLIENT_ID).");
    return;
  }

  const payload = Buffer.from(
    JSON.stringify({ returnTo, nonce: state }),
    "utf8"
  ).toString("base64url");

  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", clientId);
  // Classic OAuth Apps use scopes; GitHub Apps ignore this and use app permissions.
  authorize.searchParams.set("scope", "read:user repo");
  authorize.searchParams.set("state", payload);
  authorize.searchParams.set(
    "redirect_uri",
    `https://${req.headers.host}/api/github/callback`
  );
  authorize.searchParams.set("allow_signup", "true");

  res.statusCode = 302;
  res.setHeader("Location", authorize.toString());
  res.end();
};
