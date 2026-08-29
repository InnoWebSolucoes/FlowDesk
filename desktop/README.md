# FlowDesk Desktop (internal)

Windows desktop app that shows FlowDesk and claude.ai side by side in one
window, and syncs a local folder tree into the app's resource clusters.
Internal tool for Innoweb managers — not for public distribution.

## Installing (for users)

Send them `dist\FlowDesk-Setup-<version>.exe`. They double-click it, choose a
folder if they want, and get a desktop + Start-menu shortcut. It installs per
user, so **no administrator rights are needed**.

Windows SmartScreen will warn "Windows protected your PC" because the installer
is not code-signed (a certificate costs a few hundred euro per year and is not
worth it for an internal 2–3 person tool). Click **More info → Run anyway**.

The FlowDesk address (`https://flow-desk-tan.vercel.app`) is built into the
installer, so there is nothing to configure. If the address ever changes, use
**App → Change FlowDesk Address…**.

Then log in twice, once per pane: FlowDesk on the left with the normal account,
Claude on the right with the emailed **code** (see the gotchas below).

## Building the installer (for Rafa)

```bash
cd desktop
npm install
npm run icon     # regenerates build/icon.ico from public/favicon.svg (rarely needed)
npm run dist     # writes dist/FlowDesk-Setup-<version>.exe
```

`config.js` holds the built-in FlowDesk URL and the Supabase credentials (the
anon key is the public client key the web app already ships to browsers; RLS
does the enforcing). Change the URL there if the deployment moves, and bump
`version` in `package.json` for each new build you hand out.

Windows may fail the build while extracting electron-builder's code-signing
toolkit ("Cannot create symbolic link"). That package contains macOS symlinks
that Windows only allows with Developer Mode on: enable **Settings → System →
For developers → Developer Mode**, then rebuild.

## Building for macOS

A `.dmg` can only be produced **on** macOS — electron-builder refuses outright
on Windows, because the packaging tools it needs are macOS-only. There are two
ways round that.

### Without a Mac: build it on GitHub

`.github/workflows/build-desktop.yml` builds both platforms on GitHub's own
machines, free for this repo.

1. GitHub → the repo → **Actions** → **Build desktop app** → **Run workflow**.
2. When it finishes (a few minutes), open the run and download **FlowDesk-macOS**
   from Artifacts. It contains a `.dmg` for Apple Silicon and one for Intel.

### On a Mac

```bash
cd desktop
npm install
npm run dist:mac      # writes dist/FlowDesk-<version>-<arch>.dmg
```

### Opening it the first time

The app carries an ad-hoc signature but no Apple Developer certificate, so
macOS challenges it on first launch: right-click the app in Applications →
**Open** → **Open** in the dialog. One-time step per machine.

If macOS instead says **"FlowDesk is damaged and can't be opened"**, that is
the quarantine flag Safari and Chrome attach to downloads, not a corrupt app.
Clear it and open normally:

```bash
xattr -cr /Applications/FlowDesk.app
```

An Apple Developer certificate would remove both prompts, but is not worth it
for an internal tool.

Everything else behaves the same as on Windows, except the sync folder lives at
`~/Documents/FlowDesk` and is not pinned to a sidebar — macOS has no equivalent
of Quick Access pinning from an app, so drag that folder into Finder's sidebar
once by hand.

## Running from source (development)

```bash
cd desktop
npm start
```

In development the app reads `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
from the repo's `.env` and loads FlowDesk from `http://localhost:5173`, so run
`npm run dev` in the repo root first.

Note the packaged app and the dev app share a single-instance lock: if one is
already running, launching the other exits silently. Close one first.

## Controls

| Action | How |
| --- | --- |
| Resize split | Drag the divider |
| Hide / show Claude | Click the chevron button on the divider (also: `Ctrl+Shift+C`, or double-click the divider) |
| Show / hide WhatsApp | `Ctrl+Shift+W` (also **View → Toggle WhatsApp**) |
| Move / resize WhatsApp | Drag its title bar; drag the bottom-right corner |
| Reload FlowDesk / Claude | `Ctrl+R` / `Ctrl+Shift+R` |
| Zoom focused pane | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Claude back / forward | `Alt+Left` / `Alt+Right` |
| DevTools for focused pane | `F12` |

## WhatsApp panel

`Ctrl+Shift+W` opens WhatsApp Web as a floating panel above the two panes,
rather than a third column — a third column would squeeze both panes on a
laptop screen. Drag its title bar to move it and the bottom-right corner to
resize; the position is remembered, and **WhatsApp → Reset Panel Position**
puts it back if it ever ends up somewhere awkward.

**Logging in:** scan the QR with your phone (WhatsApp → Settings → Linked
devices → Link a device), or use "Log in with phone number" on the same screen.
Tick **Stay logged in on this browser** so it survives restarts. The session
lives in its own partition (`persist:whatsapp`), separate from Claude's, so the
two never interfere. **WhatsApp → Log Out** clears it and brings back the QR.

The page loads on first open rather than at startup — it is heavy, and there is
no reason to pay for it if nobody opens the panel. Once loaded it stays loaded,
so messages keep arriving while the panel is hidden.

**From a project:** the contact phone on a project's About tab has a green
WhatsApp button next to it. Clicking it opens the panel straight to that
conversation, with the project name pre-filled in the message box. Numbers
typed without a country code are treated as Brazilian; write `+1 …`, `+351 …`
and so on for anywhere else, and the `+` is respected.

WhatsApp Web is served the underlying Chrome user agent, because it refuses
anything it does not recognise as a current desktop browser ("update your
browser"). Same engine either way, so nothing is being misrepresented about
what the page runs on.

## How login persistence works

The Claude and WhatsApp panes each run in their own persistent Electron session
(`persist:claude`, `persist:whatsapp`), stored under
`%APPDATA%/flowdesk-desktop/Partitions/`. Cookies and local storage survive
restarts, so you log in once and stay logged in. To log out, use the site's own
logout — or delete that folder to fully reset the pane.

## Folder sync (save files straight into the app)

The app maintains `Documents\FlowDesk\<Project>\<Cluster>\…` on this machine,
mirroring the projects and clusters in the database (nested clusters included),
and pins that folder to Explorer's Quick Access so it appears in the sidebar of
every save dialog. Save any file into a cluster folder — from Claude's download
button, the browser, anywhere — and it is uploaded into that cluster in
FlowDesk within a few seconds (a Windows notification confirms it). Saving into
a project's root folder puts the file in that project's main space.

Details:

- Uploads use **your** login from the FlowDesk pane, so you must be signed in
  there; while signed out, files queue up and upload once you sign in.
- Each manager's machine runs its own mirror — files anyone uploads appear in
  the app for everyone (reopen the project to refresh).
- New/renamed projects and clusters appear locally within ~5 minutes, or
  immediately via **App → Sync FlowDesk Folders Now**.
- Editing an already-uploaded file re-uploads it in place. Deleting or moving a
  local file does **not** delete anything in the app.
- Bookkeeping and log live in `Documents\FlowDesk\.flowdesk\` (`sync.log`,
  `manifest.json`, `mapping.json`). Delete `manifest.json` to force re-upload.
- Files placed directly in the `FlowDesk` root (not inside a project) are
  ignored and logged.

## Gotchas (read before first login)

1. **Log in with the email code, not the email link.** On claude.ai's login
   screen, enter your email; the email you receive contains a magic **link** and
   a **code**. Clicking the link opens your default *browser* and logs the
   browser in — the app stays logged out. Type the **code** into the app's
   Claude pane instead.
2. **Google sign-in will not work.** Google blocks OAuth inside embedded
   webviews (`disallowed_useragent`). Email login is the way in. Both accounts
   here should be usable via email code.
3. **This is claude.ai (web), not Claude Desktop.** Everything your
   subscription includes on claude.ai works — chats, projects, artifacts, file
   uploads. Claude-Desktop-only features (local MCP servers, desktop extensions)
   do not exist here.
4. **Unsupported by Anthropic.** claude.ai's terms don't cover third-party
   shells, and a future anti-bot or login change on their side can break this
   without warning. Keep using claude.ai in the browser as the fallback; nothing
   about your account is tied to this app. If login ever hits an endless
   Cloudflare verification loop, that's the signal it broke.
5. **Popups open in your default browser by design.** Any `target="_blank"`
   link (links in Claude's answers, "open artifact in new tab", docs links)
   goes to the system browser. In-pane navigation stays in-pane only for
   claude.ai / anthropic.com / claude.site / claudeusercontent.com.
6. **Downloads** (artifact exports, generated files) use Chromium's normal
   save-file flow.
7. **Voice dictation** works — the shell grants claude.ai microphone,
   clipboard, notification, and fullscreen permissions; everything else is
   denied.
8. **Left pane shows "FlowDesk is unreachable"?** The Vite dev server isn't
   running (or `FLOWDESK_URL` points at the wrong place). It retries every 3s
   and recovers on its own once the server is up.
9. **Window/layout state** (split ratio, collapsed state, window bounds) is
   saved to `%APPDATA%/flowdesk-desktop/settings.json`.

## Files

- `main.js` — main process: window, the two `WebContentsView` panes, sessions,
  layout, menu, IPC.
- `shell.html` — the page underneath the panes; renders the draggable divider.
- `overlay.html` — invisible full-window layer shown only during a divider
  drag, so mouse events keep reaching the shell instead of the panes.
- `preload.js` — small IPC bridge shared by shell and overlay.
