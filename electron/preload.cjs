const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('atlas', {
  api: (path, method = 'GET', body) => ipcRenderer.invoke('atlas:api', path, method, body),
  importFiles: (caseId, folder = false) => ipcRenderer.invoke('atlas:import', caseId, folder),
  importDropped: (caseId, files) => ipcRenderer.invoke('atlas:drop', caseId, Array.from(files).map(file => webUtils.getPathForFile(file)).filter(Boolean)),
  exportCase: caseId => ipcRenderer.invoke('atlas:export', caseId),
  copy: text => ipcRenderer.invoke('atlas:copy', text),
  window: action => ipcRenderer.invoke('atlas:window', action),
  onEngineStopped: callback => {
    const listener = () => callback();
    ipcRenderer.on('atlas:engine-stopped', listener);
    return () => ipcRenderer.removeListener('atlas:engine-stopped', listener);
  },
});
