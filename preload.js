const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eclassAPI', {
  loadDataSync: () => ipcRenderer.sendSync('data:load-sync'),
  saveData: (text) => ipcRenderer.invoke('data:save', text),
  exportBackup: (text) => ipcRenderer.invoke('backup:export', text),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  getDataLocation: () => ipcRenderer.invoke('data:location'),
  printCurrent: () => ipcRenderer.invoke('print:current'),
  importOfficialSf1: () => ipcRenderer.invoke('sf1:import-official'),
  exportOfficialEcr: (payload, mode) => ipcRenderer.invoke('ecr:export-official', payload, mode),
  importOfficialEcr: () => ipcRenderer.invoke('ecr:import-official'),

  // Stable local update bridge introduced in v1.0.9. Future .ecrupdate
  // packages can extend renderer and main-process behavior without requiring
  // another full setup installation for ordinary development iterations.
  getUpdateInfo: () => ipcRenderer.invoke('update:info'),
  checkDownloadedUpdates: () => ipcRenderer.invoke('update:scan'),
  installLocalUpdateFile: () => ipcRenderer.invoke('update:choose-file'),
  runtimeInvoke: (action, payload) => ipcRenderer.invoke('runtime:invoke', action, payload),
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  }
});
