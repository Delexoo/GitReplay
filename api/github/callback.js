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

function parseState(raw) {
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const data = JSON.parse(json);
    if (!data || typeof data.returnTo !== "string" || typeof data.nonce !== "string") {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function redirectWithHash(res, returnTo, params) {
  const target = new URL(returnTo);
  const hash = new URLSearchParams(params).toString();
  target.hash = hash;
  res.statusCode = 302;
  res.setHeader("Location", target.toString());
  res.end();
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET");
    res.end("Method Not Allowed");
    return;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.statusCode = 500;
    res.end("GitHub OAuth is not configured.");
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state") || "";
  const oauthError = url.searchParams.get("error");
  const oauthDesc = url.searchParams.get("error_description");

  const state = parseState(stateRaw);
  const returnTo =
    state && isAllowedReturn(state.returnTo) ? state.returnTo : DEFAULT_RETURN;

  if (oauthError) {
    redirectWithHash(res, returnTo, {
      error: oauthError,
      error_description: oauthDesc || "GitHub authorization was denied.",
      state: state?.nonce || "",
    });
    return;
  }

  if (!code || !state) {
    redirectWithHash(res, returnTo, {
      error: "invalid_request",
      error_description: "Missing authorization code or state.",
      state: state?.nonce || "",
    });
    return;
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `https://${req.headers.host}/api/github/callback`,
      }),
    });

    const tokenBody = await tokenRes.json();
    if (!tokenRes.ok || !tokenBody.access_token) {
      redirectWithHash(res, returnTo, {
        error: tokenBody.error || "token_exchange_failed",
        error_description:
          tokenBody.error_description || "Could not complete GitHub sign-in.",
        state: state.nonce,
      });
      return;
    }

    redirectWithHash(res, returnTo, {
      access_token: tokenBody.access_token,
      token_type: tokenBody.token_type || "bearer",
      scope: tokenBody.scope || "",
      state: state.nonce,
    });
  } catch {
    redirectWithHash(res, returnTo, {
      error: "network_error",
      error_description: "Could not reach GitHub to finish sign-in.",
      state: state.nonce,
    });
  }
};
