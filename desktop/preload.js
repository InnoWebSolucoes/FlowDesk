// Shared by shell.html (divider chrome) and overlay.html (drag capture).
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shellAPI', {
  onLayout: (cb) => ipcRenderer.on('layout', (_e, data) => cb(data)),
  dragStart: () => ipcRenderer.send('divider:dragstart'),
  dragMove: (x, buttons) => ipcRenderer.send('divider:drag', x, buttons),
  dragEnd: () => ipcRenderer.send('divider:dragend'),
  toggle: () => ipcRenderer.send('divider:toggle'),
})
