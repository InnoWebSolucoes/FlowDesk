const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('setupAPI', {
  save: (url) => ipcRenderer.send('setup:save', url),
})
