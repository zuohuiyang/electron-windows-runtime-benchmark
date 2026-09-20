const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('videoBench', {
  clockPing: () => ipcRenderer.invoke('video-clock-ping'),
  firstFrame: frame => ipcRenderer.send('video-first-frame', frame),
  error: details => ipcRenderer.send('video-error', details)
});
