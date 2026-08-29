// FlowDesk desktop shell: two WebContentsViews (FlowDesk + claude.ai) inside one
// window, with a draggable divider rendered by the shell page underneath them,
// plus a floating WhatsApp panel that hovers above both. claude.ai and WhatsApp
// load as top-level pages in their own persistent sessions, so login cookies
// survive restarts. See README.md for the gotchas this depends on.

const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, Menu, clipboard, nativeImage } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { execFile } = require('node:child_process')
const { FlowdeskSync } = require('./sync')
const config = require('./config')

const DIVIDER_W = 12
const COLLAPSED_W = 16
const MIN_RATIO = 0.2
const MAX_RATIO = 0.85
const CLAUDE_URL = 'https://claude.ai/'
// Navigations inside the Claude pane stay in-pane for these domains; anything
// else (links in Claude's answers, docs, etc.) opens in the default browser.
const CLAUDE_NAV_DOMAINS = ['claude.ai', 'claude.site', 'anthropic.com', 'claudeusercontent.com']

const WHATSAPP_URL = 'https://web.whatsapp.com/'
const WHATSAPP_NAV_DOMAINS = ['whatsapp.com', 'wa.me']
// WhatsApp Web refuses anything it does not recognise as a current desktop
// browser ("update your browser"), and Electron's default UA carries both
// "Electron" and "FlowDesk". Present the underlying Chrome instead — same
// engine, so nothing is being faked about what the page actually runs on.
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/' + process.versions.chrome.split('.')[0] + '.0.0.0 Safari/537.36'

// The floating WhatsApp panel, as a fraction of the window, with a minimum so
// it stays usable on a small screen.
const WA_MIN_W = 380
const WA_MIN_H = 420
const WA_MARGIN = 24
const WA_TITLEBAR_H = 34
// Border left exposed around the page so the chrome's resize grip is reachable.
const WA_EDGE = 6

const DEFAULT_SETTINGS = {
  ratio: 0.6,
  claudeCollapsed: false,
  windowBounds: null,
  flowdeskUrl: null,
  syncRoot: null,
  quickAccessPinned: false,
  whatsappOpen: false,
  // Panel geometry in window coordinates; null until first opened, then
  // remembered across restarts so it reopens where it was left.
  whatsappBounds: null,
}

let settings = { ...DEFAULT_SETTINGS }
let cfg = null
let syncer = null
let setupWin = null
let win = null
let flowView = null
let claudeView = null
let whatsappView = null
let whatsappChrome = null
let overlayView = null
let dragging = false
let waDrag = null
let saveTimer = null
const retryTimers = new Map()

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

// electron-builder stamps the icon into the packaged exe, but a window created
// while running from source has no icon unless we set it explicitly.
const APP_ICON = path.join(__dirname, 'build', 'icon.ico')

function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }
  } catch {
    settings = { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(now = false) {
  const write = () => {
    try {
      fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2))
    } catch {}
  }
  clearTimeout(saveTimer)
  if (now) write()
  else saveTimer = setTimeout(write, 500)
}

// Resolution order: what the user configured > baked-in build config (which in
// dev falls back to the repo .env / the Vite dev server).
function flowdeskUrl() {
  return settings.flowdeskUrl || cfg.flowdeskUrl || ''
}

const clampRatio = (r) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, r))

function hostAllowed(url, domains) {
  try {
    const host = new URL(url).hostname
    return domains.some((d) => host === d || host.endsWith('.' + d))
  } catch {
    return false
  }
}

function openExternal(url) {
  if (/^https?:/i.test(url)) shell.openExternal(url)
}

function layout() {
  if (!win || win.isDestroyed()) return
  const [w, h] = win.getContentSize()
  const collapsed = settings.claudeCollapsed
  const stripW = collapsed ? COLLAPSED_W : DIVIDER_W
  const leftW = collapsed ? w - stripW : Math.round((w - stripW) * clampRatio(settings.ratio))
  flowView.setBounds({ x: 0, y: 0, width: leftW, height: h })
  claudeView.setVisible(!collapsed)
  if (!collapsed) {
    claudeView.setBounds({ x: leftW + stripW, y: 0, width: w - leftW - stripW, height: h })
  }
  if (overlayView) overlayView.setBounds({ x: 0, y: 0, width: w, height: h })
  layoutWhatsapp(w, h)
  win.webContents.send('layout', { dividerX: leftW, stripW, collapsed })
}

// Default position for the panel the first time it is opened: bottom-right,
// roughly a third of the window, the way a chat window usually sits.
function defaultWhatsappBounds(w, h) {
  const width = Math.max(WA_MIN_W, Math.min(460, Math.round(w * 0.32)))
  const height = Math.max(WA_MIN_H, Math.round(h * 0.72))
  return { x: w - width - WA_MARGIN, y: h - height - WA_MARGIN, width, height }
}

// Keeps the panel inside the window: without this, shrinking the window would
// strand it off-screen with no way to drag it back.
function clampWhatsappBounds(b, w, h) {
  const width = Math.max(WA_MIN_W, Math.min(b.width, w - WA_MARGIN))
  const height = Math.max(WA_MIN_H, Math.min(b.height, h - WA_MARGIN))
  return {
    width,
    height,
    x: Math.max(0, Math.min(b.x, w - width)),
    y: Math.max(0, Math.min(b.y, h - height)),
  }
}

function layoutWhatsapp(w, h) {
  if (!whatsappView || !whatsappChrome) return
  const open = settings.whatsappOpen
  whatsappView.setVisible(open)
  whatsappChrome.setVisible(open)
  if (!open) return

  const b = clampWhatsappBounds(settings.whatsappBounds || defaultWhatsappBounds(w, h), w, h)
  settings.whatsappBounds = b
  // The chrome view draws the title bar, border and resize grip; the WhatsApp
  // page is inset below the title bar and short of the bottom-right corner, so
  // the grip stays clickable — the page view sits above the chrome and would
  // otherwise swallow the corner.
  whatsappChrome.setBounds(b)
  whatsappView.setBounds({
    x: b.x + WA_EDGE,
    y: b.y + WA_TITLEBAR_H,
    width: b.width - WA_EDGE * 2,
    height: b.height - WA_TITLEBAR_H - WA_EDGE,
  })
}

function waitingPage(label, url, hint) {
  return (
    '<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;align-items:center;' +
    'justify-content:center;height:100vh;background:#18181b;color:#a1a1aa;font-family:system-ui">' +
    '<div style="text-align:center;max-width:32rem;padding:2rem">' +
    `<h2 style="color:#e4e4e7;font-weight:600;margin:0 0 .5rem">${label} is unreachable</h2>` +
    '<p style="margin:.25rem 0">Retrying automatically&hellip;</p>' +
    (hint ? `<p style="font-size:.85rem;margin:.25rem 0">${hint}</p>` : '') +
    `<code style="font-size:.8rem;color:#71717a">${url}</code></div></body>`
  )
}

// Shown when the FlowDesk address itself looks wrong (404 / 402 / 5xx), where
// retrying forever would just spin: offer the address dialog instead.
function badAddressPage(url, status) {
  return (
    '<!doctype html><meta charset="utf-8"><body style="margin:0;display:flex;align-items:center;' +
    'justify-content:center;height:100vh;background:#18181b;color:#a1a1aa;font-family:system-ui">' +
    '<div style="text-align:center;max-width:34rem;padding:2rem">' +
    '<h2 style="color:#e4e4e7;font-weight:600;margin:0 0 .5rem">FlowDesk did not load</h2>' +
    `<p style="margin:.25rem 0">The server answered with an error (${status}).</p>` +
    '<p style="font-size:.85rem;margin:.75rem 0">If the address is wrong, change it from the menu: ' +
    '<b style="color:#d4d4d8">App &rarr; Change FlowDesk Address&hellip;</b><br>' +
    'Otherwise the site may be temporarily down &mdash; use <b style="color:#d4d4d8">Ctrl+R</b> to retry.</p>' +
    `<code style="font-size:.8rem;color:#71717a">${url}</code></div></body>`
  )
}

// Loads url into the view and keeps retrying (with an inline status page) when
// it can't be reached — covers "Vite dev server not started yet" and offline.
function keepLoaded(view, url, { retryMs, label, hint, reportHttpErrors }) {
  const wc = view.webContents
  wc.on('did-fail-load', (_e, code, _desc, _failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3 = aborted (e.g. by a newer load)
    wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(waitingPage(label, url, hint)))
    clearTimeout(retryTimers.get(wc.id))
    retryTimers.set(wc.id, setTimeout(() => wc.loadURL(url), retryMs))
  })
  // A reachable host that answers 4xx/5xx (wrong address, disabled deployment)
  // never fires did-fail-load, so surface it rather than showing a blank pane.
  if (reportHttpErrors) {
    wc.on('did-navigate', (_e, navUrl, statusCode) => {
      if (statusCode >= 400 && navUrl.startsWith('http')) {
        wc.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(badAddressPage(url, statusCode)))
      }
    })
  }
  wc.loadURL(url)
}

function attachNavPolicy(view, allowDomains) {
  const wc = view.webContents
  // Popups (target=_blank, window.open) always go to the default browser.
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  if (allowDomains) {
    wc.on('will-navigate', (event, url) => {
      if (!hostAllowed(url, allowDomains)) {
        event.preventDefault()
        openExternal(url)
      }
    })
  }
}

// Borrows the current Supabase access token from the logged-in FlowDesk pane.
async function getFlowdeskAccessToken() {
  if (!flowView) return null
  try {
    const raw = await flowView.webContents.executeJavaScript(
      `(() => {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (k && k.startsWith('sb-') && k.endsWith('-auth-token')) return localStorage.getItem(k)
          }
        } catch {}
        return null
      })()`,
      true,
    )
    if (!raw) return null
    const json = raw.startsWith('base64-')
      ? Buffer.from(raw.slice(7), 'base64').toString('utf8')
      : raw
    const sess = JSON.parse(json)
    return sess?.access_token ?? sess?.currentSession?.access_token ?? null
  } catch {
    return null
  }
}

function syncRootDir() {
  return settings.syncRoot || path.join(app.getPath('documents'), 'FlowDesk')
}

// Pin the sync folder to Explorer's Quick Access so it shows up in the
// sidebar of every save dialog. Once, best-effort.
function pinToQuickAccess(dir) {
  // Explorer-specific: macOS has no equivalent an app can invoke, and running
  // powershell.exe there would throw.
  if (process.platform !== 'win32' || settings.quickAccessPinned) return
  const script =
    `$s = New-Object -ComObject shell.application; ` +
    `$s.Namespace('${dir.replace(/'/g, "''")}').Self.InvokeVerb('pintohome')`
  execFile('powershell.exe', ['-NoProfile', '-Command', script], (err) => {
    if (!err) {
      settings.quickAccessPinned = true
      saveSettings()
    }
  })
}

function startSync() {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    console.warn('[sync] Supabase config missing — folder sync disabled')
    return
  }
  const root = syncRootDir()
  fs.mkdirSync(root, { recursive: true })
  syncer = new FlowdeskSync({
    root,
    supabaseUrl: cfg.supabaseUrl,
    supabaseAnonKey: cfg.supabaseAnonKey,
    getAccessToken: getFlowdeskAccessToken,
  })
  syncer.start()
  pinToQuickAccess(root)
}

function configureSessions() {
  const claudeSes = session.fromPartition('persist:claude')
  const allowed = new Set([
    'clipboard-sanitized-write',
    'clipboard-read',
    'notifications',
    'fullscreen',
    'media', // claude.ai voice dictation
  ])
  claudeSes.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  try {
    claudeSes.setSpellCheckerLanguages(['en-US', 'pt-BR'])
  } catch {}

  const waSes = session.fromPartition('persist:whatsapp')
  // WhatsApp needs notifications for new messages, clipboard for paste, and
  // media for voice notes and calls. Everything else is denied.
  const waAllowed = new Set([
    'clipboard-sanitized-write',
    'clipboard-read',
    'notifications',
    'fullscreen',
    'media',
  ])
  waSes.setPermissionRequestHandler((_wc, permission, cb) => cb(waAllowed.has(permission)))
  waSes.setUserAgent(CHROME_UA)
  try {
    waSes.setSpellCheckerLanguages(['en-US', 'pt-BR'])
  } catch {}
}

function focusedContents() {
  if (whatsappView && whatsappView.webContents.isFocused()) return whatsappView.webContents
  if (claudeView && claudeView.webContents.isFocused()) return claudeView.webContents
  return flowView.webContents
}

let whatsappLoaded = false

function ensureWhatsappLoaded() {
  if (whatsappLoaded || !whatsappView) return
  whatsappLoaded = true
  keepLoaded(whatsappView, WHATSAPP_URL, { retryMs: 8000, label: 'WhatsApp' })
}

function toggleWhatsapp(force) {
  if (!win || win.isDestroyed()) return
  settings.whatsappOpen = typeof force === 'boolean' ? force : !settings.whatsappOpen
  saveSettings()
  if (settings.whatsappOpen) ensureWhatsappLoaded()
  layout()
  if (settings.whatsappOpen) {
    // The panel floats above both panes, so it must come to the front and take
    // focus — otherwise typing would still go to whatever was underneath.
    raiseWhatsapp()
    whatsappView.webContents.focus()
  } else {
    flowView.webContents.focus()
  }
}

// Re-adds the panel views on top of the stack. addChildView on a view already
// in the tree moves it to the front, which is how z-order is expressed here.
function raiseWhatsapp() {
  if (!win || win.isDestroyed() || !whatsappView || !whatsappChrome) return
  win.contentView.addChildView(whatsappChrome)
  win.contentView.addChildView(whatsappView)
  // The drag overlay has to stay above everything, or resizing the split would
  // lose the pointer to whichever pane it passed over.
  if (overlayView) win.contentView.addChildView(overlayView)
}

function toggleClaude() {
  endDrag()
  settings.claudeCollapsed = !settings.claudeCollapsed
  saveSettings()
  layout()

  // Menu accelerators only fire while a view in the window has focus. Hiding
  // the Claude pane leaves focus in a view that is no longer visible, so the
  // shortcut would not fire again until something else was clicked. Move focus
  // to whichever pane is actually on screen.
  const target = settings.claudeCollapsed ? flowView : claudeView
  if (target && !target.webContents.isDestroyed()) target.webContents.focus()
}

function endDrag() {
  if (!dragging) return
  dragging = false
  if (overlayView) overlayView.setVisible(false)
  saveSettings()
}

function buildMenu() {
  const zoomBy = (delta) => {
    const wc = focusedContents()
    wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta)
  }
  const template = [
    {
      label: 'App',
      submenu: [
        { label: 'Open FlowDesk Folder', click: () => shell.openPath(syncRootDir()) },
        { label: 'Change FlowDesk Address…', click: createSetupWindow },
        {
          label: 'Start FlowDesk at Login',
          type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
        },
        {
          label: 'Sync FlowDesk Folders Now',
          click: () => {
            if (syncer) syncer.syncTree().catch((e) => console.error('[sync]', e))
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Claude Panel', accelerator: 'CmdOrCtrl+Shift+C', click: toggleClaude },
        { label: 'Toggle WhatsApp', accelerator: 'CmdOrCtrl+Shift+W', click: () => toggleWhatsapp() },
        {
          label: 'Reset Split',
          click: () => {
            settings.ratio = DEFAULT_SETTINGS.ratio
            saveSettings()
            layout()
          },
        },
        { type: 'separator' },
        // reload() keeps the current page; loadURL() would jump back to the
        // app root, which reads as being logged out.
        { label: 'Reload FlowDesk', accelerator: 'CmdOrCtrl+R', click: () => flowView.webContents.reload() },
        { label: 'Reload Claude', accelerator: 'CmdOrCtrl+Shift+R', click: () => claudeView.webContents.reload() },
        { type: 'separator' },
        { label: 'Go to FlowDesk Home', click: () => flowView.webContents.loadURL(flowdeskUrl()) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoomBy(0.5) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoomBy(-0.5) },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => zoomBy(0) },
        { type: 'separator' },
        { label: 'DevTools (Focused Pane)', accelerator: 'F12', click: () => focusedContents().openDevTools({ mode: 'detach' }) },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Claude',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => {
            const nh = claudeView.webContents.navigationHistory
            if (nh && nh.canGoBack()) nh.goBack()
          },
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => {
            const nh = claudeView.webContents.navigationHistory
            if (nh && nh.canGoForward()) nh.goForward()
          },
        },
        { label: 'Home (claude.ai)', click: () => claudeView.webContents.loadURL(CLAUDE_URL) },
      ],
    },
    {
      label: 'WhatsApp',
      submenu: [
        { label: 'Show WhatsApp', accelerator: 'CmdOrCtrl+Shift+W', click: () => toggleWhatsapp(true) },
        { label: 'Hide WhatsApp', click: () => toggleWhatsapp(false) },
        { type: 'separator' },
        { label: 'Reload WhatsApp', click: () => whatsappView.webContents.reload() },
        {
          label: 'Reset Panel Position',
          click: () => {
            settings.whatsappBounds = null
            saveSettings()
            layout()
          },
        },
        { type: 'separator' },
        {
          // Signing out of WhatsApp Web is done from the phone; clearing the
          // partition is the equivalent from this side, and forces a fresh QR.
          label: 'Log Out (clear WhatsApp session)',
          click: async () => {
            try {
              await session.fromPartition('persist:whatsapp').clearStorageData()
              whatsappView.webContents.loadURL(WHATSAPP_URL)
            } catch (e) {
              console.error('[whatsapp] logout', e)
            }
          },
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow() {
  const bounds = settings.windowBounds || { width: 1600, height: 950 }
  win = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#18181b',
    title: 'FlowDesk',
    icon: APP_ICON,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })

  flowView = new WebContentsView({
    webPreferences: {
      partition: 'persist:flowdesk',
      sandbox: true,
      // Lets the web app hand a real file to the OS, which a page cannot do
      // by itself. See flowdesk-preload.js for the whole surface.
      preload: path.join(__dirname, 'flowdesk-preload.js'),
    },
  })
  claudeView = new WebContentsView({
    webPreferences: { partition: 'persist:claude', sandbox: true },
  })
  // The floating WhatsApp panel is two views: a chrome view drawing the title
  // bar / border / resize grip, and the WhatsApp page inset inside it. They are
  // separate because a WebContentsView cannot host another view's page, and the
  // title bar has to stay ours (drag, close) rather than WhatsApp's.
  whatsappChrome = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'whatsapp-chrome-preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  whatsappView = new WebContentsView({
    webPreferences: { partition: 'persist:whatsapp', sandbox: true },
  })
  // Full-window transparent view shown only while dragging the divider, so the
  // shell keeps receiving mouse events that would otherwise land on the panes.
  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.contentView.addChildView(flowView)
  win.contentView.addChildView(claudeView)
  win.contentView.addChildView(whatsappChrome)
  win.contentView.addChildView(whatsappView)
  win.contentView.addChildView(overlayView)
  overlayView.setBackgroundColor('#00000000')
  overlayView.setVisible(false)
  overlayView.webContents.loadFile(path.join(__dirname, 'overlay.html'))

  whatsappChrome.setVisible(false)
  whatsappView.setVisible(false)
  whatsappChrome.webContents.loadFile(path.join(__dirname, 'whatsapp-chrome.html'))

  attachNavPolicy(flowView, null)
  attachNavPolicy(claudeView, CLAUDE_NAV_DOMAINS)
  attachNavPolicy(whatsappView, WHATSAPP_NAV_DOMAINS)

  // Clicking anywhere in the panel should bring it forward, in case something
  // else was raised above it.
  whatsappView.webContents.on('focus', raiseWhatsapp)

  keepLoaded(flowView, flowdeskUrl(), {
    retryMs: 5000,
    label: 'FlowDesk',
    hint: 'Check your internet connection. The address can be changed from <b>App &rarr; Change FlowDesk Address&hellip;</b>',
    reportHttpErrors: true,
  })
  keepLoaded(claudeView, CLAUDE_URL, { retryMs: 8000, label: 'Claude' })

  // WhatsApp loads on first open rather than at startup: it is a heavy page,
  // and someone who never opens the panel should not pay for it. Once loaded it
  // stays loaded, so messages keep arriving while the panel is hidden.
  if (settings.whatsappOpen) ensureWhatsappLoaded()

  win.loadFile(path.join(__dirname, 'shell.html'))
  win.once('ready-to-show', () => {
    win.show()
    layout()
    flowView.webContents.focus()
  })
  // A drag must not survive the window losing focus: without this a missed
  // release leaves the divider stuck to the cursor.
  win.on('blur', () => {
    endDrag()
    if (waDrag) {
      waDrag = null
      saveSettings()
    }
  })
  win.on('resize', layout)
  win.on('resized', () => {
    settings.windowBounds = win.getBounds()
    saveSettings()
  })
  win.on('moved', () => {
    settings.windowBounds = win.getBounds()
    saveSettings()
  })
  win.on('maximize', layout)
  win.on('unmaximize', layout)
  win.on('closed', () => {
    win = null
  })
}

ipcMain.on('divider:dragstart', () => {
  if (settings.claudeCollapsed || dragging || !win) return
  dragging = true
  overlayView.setVisible(true)
  layout()
  overlayView.webContents.focus()
})

ipcMain.on('divider:drag', (_e, x, buttons) => {
  // A trackpad can deliver a move after the release was missed. If nothing is
  // held any more, the drag is over regardless of what the renderer reported.
  if (typeof buttons === 'number' && buttons === 0) {
    endDrag()
    return
  }
  if (!dragging || !win || typeof x !== 'number') return
  const [w] = win.getContentSize()
  settings.ratio = clampRatio((x - DIVIDER_W / 2) / (w - DIVIDER_W))
  layout()
})

ipcMain.on('divider:dragend', endDrag)
ipcMain.on('divider:toggle', toggleClaude)

// ─── Floating WhatsApp panel ────────────────────────────────────────────────

ipcMain.on('whatsapp:close', () => toggleWhatsapp(false))
ipcMain.on('whatsapp:raise', raiseWhatsapp)

// Moving and resizing are driven from the chrome view's title bar and grip. The
// renderer reports the pointer offset since the press, because a WebContentsView
// has no window-level drag of its own.
ipcMain.on('whatsapp:movestart', (_e, mode) => {
  if (!settings.whatsappOpen || !settings.whatsappBounds) return
  waDrag = { mode, start: { ...settings.whatsappBounds } }
  raiseWhatsapp()
})

ipcMain.on('whatsapp:move', (_e, dx, dy, buttons) => {
  // A release can be missed (pointer leaves the view, window loses focus); if
  // nothing is held any more the gesture is over whatever the renderer thinks.
  if (typeof buttons === 'number' && buttons === 0) {
    waDrag = null
    saveSettings()
    return
  }
  if (!waDrag || !win || win.isDestroyed()) return
  const [w, h] = win.getContentSize()
  const s = waDrag.start
  const next =
    waDrag.mode === 'resize'
      ? { x: s.x, y: s.y, width: s.width + dx, height: s.height + dy }
      : { x: s.x + dx, y: s.y + dy, width: s.width, height: s.height }
  settings.whatsappBounds = clampWhatsappBounds(next, w, h)
  layoutWhatsapp(w, h)
})

ipcMain.on('whatsapp:moveend', () => {
  if (!waDrag) return
  waDrag = null
  saveSettings()
})

/**
 * WhatsApp addresses a chat by digits only, including the country code. Numbers
 * in FlowDesk are typed however the manager types them — "(11) 98765-4321",
 * "+55 11 98765 4321" — so strip the formatting and assume Brazil when no
 * country code is present, which is the case for every local number.
 */
function normalisePhone(raw) {
  const text = String(raw || '').trim()
  let digits = text.replace(/\D/g, '')
  if (!digits) return null

  // A leading + (or the 00 dialled from Brazil) means the country code is
  // already there — never add another. Without this a US "+1 415 555 2671"
  // would be read as a bare 11-digit Brazilian number and reach a stranger.
  const hasCountryCode = text.startsWith('+') || digits.startsWith('00')
  if (digits.startsWith('00')) digits = digits.slice(2)

  // Otherwise 10 or 11 digits is a local Brazilian number (area + subscriber).
  if (!hasCountryCode && (digits.length === 10 || digits.length === 11)) {
    digits = '55' + digits
  }
  // Shorter than this cannot carry a country code plus a real number.
  return digits.length >= 10 ? digits : null
}

ipcMain.handle('native:open-whatsapp', async (_event, { phone, message } = {}) => {
  if (!win || win.isDestroyed()) return { ok: false, error: 'No window' }
  toggleWhatsapp(true)

  if (!phone) return { ok: true } // just open the panel

  const digits = normalisePhone(phone)
  if (!digits) return { ok: false, error: 'That phone number is not usable' }

  // web.whatsapp.com/send opens the conversation directly. It needs the page to
  // be logged in; if it is not, WhatsApp shows its own QR screen instead, which
  // is the right thing to show anyway.
  let url = `https://web.whatsapp.com/send?phone=${digits}`
  if (message) url += `&text=${encodeURIComponent(String(message).slice(0, 2000))}`
  whatsappView.webContents.loadURL(url)
  return { ok: true, phone: digits }
})

// First run (or "Change FlowDesk Address"): ask for the FlowDesk URL.
function createSetupWindow() {
  if (setupWin && !setupWin.isDestroyed()) {
    setupWin.focus()
    return
  }
  setupWin = new BrowserWindow({
    width: 560,
    height: 420,
    resizable: false,
    backgroundColor: '#18181b',
    title: 'FlowDesk Setup',
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'setup-preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  setupWin.setMenuBarVisibility(false)
  setupWin.loadFile(path.join(__dirname, 'setup.html'))
  setupWin.on('closed', () => {
    setupWin = null
    // Closing setup without ever configuring a URL leaves nothing to show.
    if (!flowdeskUrl() && !win) app.quit()
  })
}

ipcMain.on('setup:save', (_e, url) => {
  if (typeof url !== 'string' || !url) return
  settings.flowdeskUrl = url
  saveSettings(true)
  if (setupWin && !setupWin.isDestroyed()) setupWin.close()
  if (win && !win.isDestroyed()) {
    flowView.webContents.loadURL(url) // live change from the menu
  } else {
    createWindow()
    startSync()
  }
})

// ─── Dragging a document out to another app ─────────────────────────────────

/** Where downloaded copies live for the session, cleared on quit. */
const dragCacheDir = () => path.join(app.getPath('temp'), 'flowdesk-drag')

/**
 * Downloads the document to a temp file so the OS has something real to hand
 * over. Reuses a file already fetched this session rather than downloading the
 * same document repeatedly.
 */
async function materialise(url, fileName) {
  const dir = dragCacheDir()
  fs.mkdirSync(dir, { recursive: true })

  const safe = String(fileName || 'document').replace(/[^\w.\- ]+/g, '_').slice(0, 120)
  const target = path.join(dir, safe)

  // A signed URL changes every hour, so an existing file is still the right
  // bytes for the same document — only re-fetch when it is missing.
  if (!fs.existsSync(target)) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Could not fetch the file (${res.status})`)
    fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()))
  }
  return target
}

ipcMain.handle('native:prepare-file', async (_event, { url, fileName }) => {
  try {
    await materialise(url, fileName)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('native:drag-file', async (event, { url, fileName }) => {
  try {
    const filePath = await materialise(url, fileName)
    // A drag needs an icon; the file's own icon keeps it recognisable.
    let icon = await app.getFileIcon(filePath, { size: 'normal' }).catch(() => null)
    if (!icon || icon.isEmpty()) {
      icon = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 64 })
    }
    event.sender.startDrag({ file: filePath, icon })
    return { ok: true }
  } catch (e) {
    console.error('[native:drag-file]', e)
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('native:copy-file', async (_event, { url, fileName }) => {
  try {
    const filePath = await materialise(url, fileName)

    if (process.platform === 'win32') {
      // Electron's writeBuffer('CF_HDROP') does not register the real Windows
      // clipboard format — Windows reports no file on the clipboard — so the
      // copy goes through PowerShell's Clipboard.SetFileDropList, which uses
      // the genuine API that Explorer, WhatsApp and Office all read.
      await new Promise((resolve, reject) => {
        const ps = [
          'Add-Type -AssemblyName System.Windows.Forms',
          '$c = New-Object System.Collections.Specialized.StringCollection',
          '$c.Add($env:FLOWDESK_CLIP_FILE) | Out-Null',
          '[System.Windows.Forms.Clipboard]::SetFileDropList($c)',
        ].join('; ')

        execFile(
          'powershell.exe',
          ['-NoProfile', '-STA', '-Command', ps],
          { env: { ...process.env, FLOWDESK_CLIP_FILE: filePath } },
          (err) => (err ? reject(err) : resolve()),
        )
      })
    } else {
      // macOS reads a file URL from the pasteboard.
      clipboard.writeBuffer('public.file-url', Buffer.from(`file://${filePath}`, 'utf8'))
    }

    return { ok: true, path: filePath }
  } catch (e) {
    console.error('[native:copy-file]', e)
    return { ok: false, error: e.message }
  }
})

// Temp copies are per-session; clear them so they do not accumulate.
app.on('will-quit', () => {
  try {
    fs.rmSync(dragCacheDir(), { recursive: true, force: true })
  } catch {}
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(() => {
    // Without this, Windows groups the dev run under Electron's own icon.
    if (process.platform === 'win32') app.setAppUserModelId('com.innoweb.flowdesk')
    loadSettings()
    cfg = config.resolve(app.isPackaged)
    configureSessions()
    buildMenu()
    if (!flowdeskUrl()) {
      createSetupWindow() // first run on a fresh install
    } else {
      createWindow()
      startSync()
    }
  })
  app.on('window-all-closed', () => app.quit())

  // Cookies and localStorage are written lazily; without an explicit flush a
  // login made in this session can be lost when the process exits, which shows
  // up as "logged out again on every restart". flushStorageData() is fire and
  // forget (it returns nothing), so also flush periodically rather than relying
  // on the last moments of shutdown.
  function flushSessions() {
    for (const p of ['persist:flowdesk', 'persist:claude', 'persist:whatsapp']) {
      try {
        session.fromPartition(p).flushStorageData()
      } catch {}
    }
  }
  setInterval(flushSessions, 60 * 1000).unref()

  app.on('before-quit', () => {
    if (syncer) syncer.stop()
    saveSettings(true)
    flushSessions()
  })
}
