// Bridge for the FlowDesk pane.
//
// Exposes only what the web app cannot do on its own: handing a real file to
// the operating system, so a document can be dragged or pasted into WhatsApp,
// Claude, Slack, an email — anywhere that accepts a dropped file. A web page
// cannot fabricate a file handle, which is why this has to live here.
//
// The page passes a URL and a filename; the main process downloads to a temp
// file and hands that to the OS. Nothing else is reachable from the page.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('flowdeskNative', {
  /** True when running inside the desktop app, so the web app can adapt. */
  available: true,

  /** Downloads ahead of a drag, so the file is ready when the gesture starts. */
  prepareFile: (url, fileName) => ipcRenderer.invoke('native:prepare-file', { url, fileName }),

  /**
   * Starts an OS-level drag of a file. Resolves once the drag has been handed
   * over; the drop itself is the operating system's business from then on.
   */
  dragFile: (url, fileName) => ipcRenderer.invoke('native:drag-file', { url, fileName }),

  /** Puts the file on the clipboard, ready to paste into another app. */
  copyFile: (url, fileName) => ipcRenderer.invoke('native:copy-file', { url, fileName }),
})
