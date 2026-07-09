<p align="center">
  <img src="https://img.shields.io/badge/GitReplay-Open%20Source-111111?style=for-the-badge&labelColor=111111&color=FFFFFF" alt="GitReplay" />
</p>

<h1 align="center">GitReplay</h1>

<p align="center">
  <strong>Watch any public GitHub repository build live in your browser.</strong><br />
  Character-by-character replay · live HTML/CSS/JS preview · zero install.
</p>

<p align="center">
  <a href="https://delexoo.github.io/GitReplay/welcome.html"><img src="https://img.shields.io/badge/Live_Demo-open-2ea043?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Live demo" /></a>
  <a href="https://github.com/Delexoo/GitReplay/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-555?style=for-the-badge" alt="MIT License" /></a>
  <a href="https://github.com/Delexoo/GitReplay/stargazers"><img src="https://img.shields.io/github/stars/Delexoo/GitReplay?style=for-the-badge&logo=github&label=Stars" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="https://delexoo.github.io/GitReplay/welcome.html"><strong>delexoo.github.io/GitReplay/welcome.html</strong></a>
</p>

---

## About

**GitReplay** is a free, browser-based developer tool that turns any public GitHub repository into a live coding experience. Paste a repo URL, browse the file tree, and replay files as if they are being typed in real time — with an integrated **Live preview** panel for web projects.

No backend server. No install. All GitHub API calls run directly from your browser. Optional session tokens stay in tab memory only and are cleared when you close the tab.

| | |
|---|---|
| **Author** | [Delexoo](https://github.com/Delexoo) |
| **License** | [MIT](LICENSE) |
| **Hosting** | [GitHub Pages](https://delexoo.github.io/GitReplay/welcome.html) |
| **Stack** | HTML · CSS · JavaScript (ES modules) |

---

## Features

| Feature | Description |
|---------|-------------|
| **Live replay** | Double-click any file to watch it type out character by character |
| **Live preview** | HTML, CSS, JS, and Vite/React projects render as they are built |
| **Parallel web build** | Double-click `index.html` to replay linked HTML, CSS, and JS together |
| **Replay All** | Walk through every file in a repository in sequence |
| **Race mode** | Race multiple HTML, JS, or CSS files side by side |
| **Session auth** | Optional GitHub token per tab for higher API rate limits |
| **Privacy-first** | No server; tokens never leave your browser session |

---

## Quick start

1. Open **[delexoo.github.io/GitReplay/welcome.html](https://delexoo.github.io/GitReplay/welcome.html)**
2. *(Recommended)* Connect a [GitHub personal access token](https://github.com/settings/tokens/new) for the session — no scopes required for public repos
3. Paste a repo URL (e.g. `github.com/vitejs/vite`) and click **Load**
4. **Single-click** a file to browse · **Double-click** to replay it live

---

## Interface

| Panel | Purpose |
|-------|---------|
| **Files** | Repository file tree and replay timeline |
| **Code** | Source view with typing animation during replay |
| **Live preview** | Renders websites, markdown, SVG, and media as they are built |

Drag panel dividers to resize. Layout preferences are saved in your browser.

---

## Replay modes

### Single-file replay
Double-click any file. Use **Pause**, the **Speed** slider, and the **Progress** scrubber to control playback.

### Web project replay
Double-click `index.html` (or a page with linked assets) to replay **HTML, CSS, and JavaScript in parallel** so the preview builds like a real site.

### Replay All
Click **Replay All** in the header to queue every file in the repository.

### Race mode
Select **HTML**, **JS**, or **CSS**, then click **Race** to type multiple files simultaneously.

---

## Live preview

| Content | Code panel | Live preview |
|---------|------------|--------------|
| `.js`, `.ts`, `.html`, `.css` | Full source typing | Web build when applicable |
| README / `.md` | Source typing | Rendered markdown |
| Images / video / audio | Placeholder | Media viewer |
| SVG | Source typing | Rendered graphic |

Supports plain HTML/CSS/JS, Vite + React + TypeScript (in-browser bundle), and committed `dist/` / `build/` output.

---

## GitHub token (optional)

| | |
|---|---|
| **Storage** | Current browser tab only (`sessionStorage`) |
| **Cleared** | When the tab closes |
| **Sent to a server?** | No — direct browser → GitHub API |

Connecting a token raises the limit from **60** to **5,000** requests/hour. GitReplay prompts you if the unauthenticated limit is reached.

---

## FAQ

<details>
<summary><strong>Do I need to install anything?</strong></summary>
<br />
No. Use any modern browser — Chrome, Firefox, Safari, or Edge.
</details>

<details>
<summary><strong>Does it work with private repositories?</strong></summary>
<br />
Not yet. GitReplay supports <strong>public</strong> repositories only.
</details>

<details>
<summary><strong>Why is my React preview blank?</strong></summary>
<br />
Let the replay finish — bundling runs after the entry file is fully typed. If it still fails, try opening a committed <code>dist/index.html</code> or check framework support.
</details>

---

## Contributing

Issues and pull requests are welcome on [GitHub](https://github.com/Delexoo/GitReplay). Please open an issue before large changes.

---

## License

MIT © [Delexoo](https://github.com/Delexoo)

<p align="center">
  <sub>Built for developers, students, and anyone who learns by watching code come together.</sub>
</p>
