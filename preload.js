const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eclassAPI', {
  loadDataSync: () => ipcRenderer.sendSync('data:load-sync'),
  saveData: (text) => ipcRenderer.invoke('data:save', text),
  exportBackup: (text) => ipcRenderer.invoke('backup:export', text),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  getDataLocation: () => ipcRenderer.invoke('data:location'),
  printCurrent: () => ipcRenderer.invoke('print:current'),
  exportOfficialEcr: (payload, mode) => ipcRenderer.invoke('ecr:export-official', payload, mode)
});
