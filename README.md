<p align="center">
  <strong>GitReplay</strong><br />
  Watch any public GitHub repository build live in your browser.
</p>

<p align="center">
  <a href="https://delexoo.github.io/GitReplay/welcome.html"><img src="https://img.shields.io/badge/Open%20GitReplay-111?style=for-the-badge" alt="Open GitReplay" /></a>
</p>

<p align="center">
  <a href="https://delexoo.github.io/GitReplay/welcome.html"><strong>delexoo.github.io/GitReplay/welcome.html</strong></a>
</p>

---

## What is GitReplay?

GitReplay lets you paste a public GitHub repo and watch its files appear as if someone is typing them in real time — with a **live website preview** on the right for HTML, CSS, JS, and React/Vite projects.

Open the app in your browser. Nothing to download or install.

---

## Quick start

1. Go to **[delexoo.github.io/GitReplay/welcome.html](https://delexoo.github.io/GitReplay/welcome.html)**
2. *(Recommended)* Click **Connect GitHub for this session** and paste a [personal access token](https://github.com/settings/tokens/new) — no scopes needed for public repos
3. Paste a repo URL (e.g. `github.com/vitejs/vite`) and click **Load**
4. **Single-click** a file to read it · **Double-click** to replay it live

---

## The interface

GitReplay has three main panels:

| Panel | What it does |
|-------|----------------|
| **Files** | Repo file tree — click folders to expand, click files to browse |
| **Code** | Shows file contents; animates during replay |
| **Live preview** | Renders the site as web files are built |

Drag the dividers between panels to resize them. Your layout is remembered in the browser.

---

## Loading a repository

On the welcome screen, paste any of these formats:

- `github.com/owner/repo`
- `https://github.com/owner/repo`
- `owner/repo`

Click **Load**. The file tree fills in on the left and the repo name appears in the header.

After the first load, you can also use the search bar at the top to load a different repo.

---

## Browsing files

- **Single-click** a file → opens it in the Code panel
- **Single-click** a folder → expands or collapses it
- Web files (HTML, CSS, JS, TSX) also update the **Live preview** when you browse them
- Images, video, and audio open in the preview panel when selected

---

## Replaying files (live build)

**Double-click** any file to start a live replay. You'll see:

- Characters typing out in the Code panel
- The preview updating as you go (for web files)
- **Pause** / play controls in the header
- **Speed** slider — from slow motion to extremely fast
- **Progress** slider — scrub forward or backward within the current file

When replay finishes, click **Replay** in the header to watch the same session again.

<details>
<summary><strong>Double-clicking HTML / web projects</strong></summary>

<br />

When you double-click `index.html` (or a page with linked CSS/JS), GitReplay often replays **all related web files together** — HTML, styles, and scripts type out in parallel so the preview builds like a real site.

For Vite/React repos, open `index.html` or `src/main.tsx` and let the replay finish; the preview bundles the project in your browser when complete.

</details>

---

## Replay All

Click **Replay All** in the header to walk through **every file** in the repository, one after another.

- The **Progress** bar spans the full queue — scrub to jump between files
- The current file is highlighted in black in the file tree
- A **Building…** pill appears in the preview while generation is active

---

## Race mode

1. Choose a file type: **HTML**, **JS**, or **CSS**
2. Click **Race**
3. Multiple files of that type type out at the same time — first to finish wins

Useful for comparing parallel implementations or just for fun.

---

## Live preview

The right-hand panel shows what the repo would look like in a browser.

| What you see | When |
|--------------|------|
| Page building line-by-line | During replay |
| Full rendered site | After replay, or when browsing a complete HTML page |
| Image / video / audio | When you select media files |
| **Building…** spinner | While code is actively generating |

<details>
<summary><strong>Fullscreen preview</strong></summary>

<br />

Click the **fullscreen** icon in the preview header. Replay controls move to the bottom of the screen. Press **Esc** or click the icon again to exit.

</details>

<details>
<summary><strong>Supported project types</strong></summary>

<br />

| Type | Preview |
|------|---------|
| Plain HTML / CSS / JS | ✅ Live + full preview |
| Vite + React + TypeScript | ✅ Bundled preview after build completes |
| Committed `dist/` or `build/` folder | ✅ Loads built output |
| Vue / Svelte / Next.js | ❌ Not yet supported |

</details>

---

## GitHub token (session)

Connecting a token is **optional** but recommended — it raises GitHub's API limit from 60 to 5,000 requests per hour for your session.

| | |
|---|---|
| **Where it's stored** | Only in your current browser tab |
| **When it's cleared** | When you **close the tab** |
| **Sent to a server?** | No — calls go directly from your browser to GitHub |

**To connect:**

1. Click **Connect GitHub for this session** on the welcome screen, or the **Token** button in the header
2. Create a token at [github.com/settings/tokens/new](https://github.com/settings/tokens/new) — no scopes required
3. Paste it and click **Save**

If you hit a rate limit without a token, GitReplay will prompt you to add one.

---

## Tips

- **Slow down** the speed slider to follow along while learning
- **Scrub progress** to jump to a specific moment in a long file
- For React/Vite repos, double-click **`index.html`** and wait for the replay to finish for the best preview
- If preview is empty, try single-clicking **`dist/index.html`** when the repo includes a production build

---

## FAQ

<details>
<summary><strong>Do I need to download or install anything?</strong></summary>

<br />

No. Open [welcome.html](https://delexoo.github.io/GitReplay/welcome.html) in Chrome, Firefox, Safari, or Edge and start using it.

</details>

<details>
<summary><strong>Can I use private repositories?</strong></summary>

<br />

Not yet. GitReplay works with **public** repositories only.

</details>

<details>
<summary><strong>Why did loading fail or ask for a token?</strong></summary>

<br />

GitHub limits how many API requests unauthenticated users can make. Connect a personal access token for the current tab session to continue loading repos.

</details>

<details>
<summary><strong>Why is my preview blank on a React project?</strong></summary>

<br />

Let the replay finish completely — bundling runs after the entry file is fully typed. If it still fails, the repo may need a committed `dist/` folder, or the project may use a framework GitReplay doesn't support yet.

</details>

---

## License

MIT © [Delexoo](https://github.com/Delexoo)
