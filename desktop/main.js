// FlowDesk desktop shell: two WebContentsViews (FlowDesk + claude.ai) inside one
// window, with a draggable divider rendered by the shell page underneath them.
// claude.ai loads as a top-level page in its own persistent session, so login
// cookies survive restarts. See README.md for the gotchas this depends on.

const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, Menu } = require('electron')
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

const DEFAULT_SETTINGS = {
  ratio: 0.6,
  claudeCollapsed: false,
  windowBounds: null,
  flowdeskUrl: null,
  syncRoot: null,
  quickAccessPinned: false,
}

let settings = { ...DEFAULT_SETTINGS }
let cfg = null
let syncer = null
let setupWin = null
let win = null
let flowView = null
let claudeView = null
let overlayView = null
let dragging = false
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
  win.webContents.send('layout', { dividerX: leftW, stripW, collapsed })
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
}

function focusedContents() {
  if (claudeView && claudeView.webContents.isFocused()) return claudeView.webContents
  return flowView.webContents
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
    webPreferences: { partition: 'persist:flowdesk', sandbox: true },
  })
  claudeView = new WebContentsView({
    webPreferences: { partition: 'persist:claude', sandbox: true },
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
  win.contentView.addChildView(overlayView)
  overlayView.setBackgroundColor('#00000000')
  overlayView.setVisible(false)
  overlayView.webContents.loadFile(path.join(__dirname, 'overlay.html'))

  attachNavPolicy(flowView, null)
  attachNavPolicy(claudeView, CLAUDE_NAV_DOMAINS)

  keepLoaded(flowView, flowdeskUrl(), {
    retryMs: 5000,
    label: 'FlowDesk',
    hint: 'Check your internet connection. The address can be changed from <b>App &rarr; Change FlowDesk Address&hellip;</b>',
    reportHttpErrors: true,
  })
  keepLoaded(claudeView, CLAUDE_URL, { retryMs: 8000, label: 'Claude' })

  win.loadFile(path.join(__dirname, 'shell.html'))
  win.once('ready-to-show', () => {
    win.show()
    layout()
    flowView.webContents.focus()
  })
  // A drag must not survive the window losing focus: without this a missed
  // release leaves the divider stuck to the cursor.
  win.on('blur', endDrag)
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

ipcMain.on('divider:drag', (_e, x) => {
  if (!dragging || !win || typeof x !== 'number') return
  const [w] = win.getContentSize()
  settings.ratio = clampRatio((x - DIVIDER_W / 2) / (w - DIVIDER_W))
  layout()
})

ipcMain.on('divider:dragend', endDrag)
ipcMain.on('divider:toggle', toggleClaude)

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
    for (const p of ['persist:flowdesk', 'persist:claude']) {
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
