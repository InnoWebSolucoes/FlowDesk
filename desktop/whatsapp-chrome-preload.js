// Bridge for the WhatsApp panel's frame (title bar, border, resize grip).
//
// The frame is a separate view drawn behind the WhatsApp page, because the page
// itself belongs to WhatsApp and cannot be asked to host our controls. All this
// exposes is moving, resizing and closing the panel.

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('waPanel', {
  close: () => ipcRenderer.send('whatsapp:close'),
  raise: () => ipcRenderer.send('whatsapp:raise'),

  /** mode: 'move' (title bar) or 'resize' (corner grip). */
  dragStart: (mode) => ipcRenderer.send('whatsapp:movestart', mode),
  /** Offset from where the press began, so the main process needs no cursor API. */
  drag: (dx, dy, buttons) => ipcRenderer.send('whatsapp:move', dx, dy, buttons),
  dragEnd: () => ipcRenderer.send('whatsapp:moveend'),
})
