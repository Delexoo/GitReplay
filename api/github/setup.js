/**
 * One-time GitHub App Manifest helper.
 * Open /api/github/setup while signed into GitHub, create the app, and this
 * route stores GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET on Vercel then redeploys.
 */
const HOMEPAGE = "https://delexoo.github.io/GitReplay/";
const APP_URL = "https://delexoo.github.io/GitReplay/index.html";
const AUTH_ORIGIN = "https://gitreplay-red.vercel.app";
const CALLBACK = `${AUTH_ORIGIN}/api/github/callback`;
const SETUP_RETURN = `${AUTH_ORIGIN}/api/github/setup`;

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 48px auto; padding: 0 20px; color: #111; }
    code, pre { background: #f4f4f5; border-radius: 8px; padding: 2px 6px; }
    pre { padding: 14px; overflow: auto; white-space: pre-wrap; }
    a.btn { display: inline-block; margin-top: 16px; padding: 10px 16px; background: #111; color: #fff; border-radius: 8px; text-decoration: none; }
    .muted { color: #6b7280; }
    button { margin-top:16px;padding:10px 16px;background:#111;color:#fff;border:0;border-radius:8px;cursor:pointer; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

async function upsertEnv(key, value, { token, projectId, teamId }) {
  const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : "";
  const listRes = await fetch(
    `https://api.vercel.com/v9/projects/${projectId}/env${qs}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const list = await listRes.json();
  const existing = (list.envs || []).find(
    (e) => e.key === key && e.target?.includes("production")
  );

  if (existing) {
    const res = await fetch(
      `https://api.vercel.com/v9/projects/${projectId}/env/${existing.id}${qs}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          value,
          target: ["production", "preview", "development"],
          type: "encrypted",
        }),
      }
    );
    if (!res.ok) throw new Error(`Failed to update ${key}: ${await res.text()}`);
    return;
  }

  const res = await fetch(
    `https://api.vercel.com/v10/projects/${projectId}/env${qs}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key,
        value,
        type: "encrypted",
        target: ["production", "preview", "development"],
      }),
    }
  );
  if (!res.ok) throw new Error(`Failed to create ${key}: ${await res.text()}`);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get("code");

  if (!code) {
    const manifest = {
      name: "GitReplay",
      url: HOMEPAGE,
      hook_attributes: {
        url: `${SETUP_RETURN}/hooks`,
        active: false,
      },
      redirect_url: SETUP_RETURN,
      callback_urls: [CALLBACK],
      description: "Watch GitHub repos build live in the browser.",
      public: true,
      request_oauth_on_install: true,
      default_permissions: {
        metadata: "read",
        contents: "read",
      },
      default_events: [],
    };

    const escaped = JSON.stringify(manifest).replace(/'/g, "&#39;");
    const body = htmlPage(
      "Set up GitReplay OAuth",
      `
      <h1>Register GitReplay on GitHub</h1>
      <p class="muted">Creates a GitHub App with read access to repositories. You only need to do this once while signed into GitHub.</p>
      <form action="https://github.com/settings/apps/new" method="post">
        <input type="hidden" name="manifest" value='${escaped}' />
        <button type="submit">Create GitHub App</button>
      </form>
      `
    );
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(body);
    return;
  }

  try {
    const convertRes = await fetch(
      `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );
    const data = await convertRes.json();
    if (!convertRes.ok) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        htmlPage(
          "Setup failed",
          `<h1>Could not finish setup</h1><pre>${JSON.stringify(data, null, 2)}</pre>`
        )
      );
      return;
    }

    const clientId = data.client_id;
    const clientSecret = data.client_secret;
    const token = process.env.VERCEL_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    const teamId = process.env.VERCEL_TEAM_ID || "";

    let wireNote = "";
    if (token && projectId) {
      try {
        await upsertEnv("GITHUB_CLIENT_ID", clientId, { token, projectId, teamId });
        await upsertEnv("GITHUB_CLIENT_SECRET", clientSecret, {
          token,
          projectId,
          teamId,
        });
        wireNote =
          "<p>Credentials were saved to Vercel. A production redeploy is required for Connect with GitHub to work — run <code>vercel deploy --prod</code> or push to main.</p>";
      } catch (err) {
        wireNote = `<p>Could not auto-save to Vercel: ${String(err.message || err)}</p>
        <p>Add these manually:</p>
        <pre>GITHUB_CLIENT_ID=${clientId}
GITHUB_CLIENT_SECRET=${clientSecret}</pre>`;
      }
    } else {
      wireNote = `<p>Add these environment variables on the Vercel <code>gitreplay</code> project, then redeploy:</p>
      <pre>GITHUB_CLIENT_ID=${clientId}
GITHUB_CLIENT_SECRET=${clientSecret}</pre>`;
    }

    const body = htmlPage(
      "GitReplay OAuth ready",
      `
      <h1>GitHub App created</h1>
      ${wireNote}
      <p class="muted">Callback URL: <code>${CALLBACK}</code></p>
      <p class="muted">Homepage: <code>${HOMEPAGE}</code></p>
      <a class="btn" href="${APP_URL}">Open GitReplay</a>
      `
    );
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(body);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain");
    res.end(String(err?.message || err));
  }
};
