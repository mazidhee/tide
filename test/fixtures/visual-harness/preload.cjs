const { contextBridge, ipcRenderer } = require('electron')
// Stands in for the app's window.tide: a visual must never reach it
contextBridge.exposeInMainWorld('tide', { secret: 'the vault path', vault: { read: () => 'note text' } })
contextBridge.exposeInMainWorld('harness', {
  ports: () => ipcRenderer.invoke('harness:ports'),
  watch: (h) => ipcRenderer.invoke('harness:watch', h),
  unwatch: (h) => ipcRenderer.invoke('harness:unwatch', h),
  pid: (h) => ipcRenderer.invoke('harness:pid', h),
  kill: (h) => ipcRenderer.invoke('harness:kill', h),
  alive: (p) => ipcRenderer.invoke('harness:alive', p),
  frames: () => ipcRenderer.invoke('harness:frames'),
  killed: () => ipcRenderer.invoke('harness:killed'),
  done: (r) => ipcRenderer.invoke('harness:done', r)
})
