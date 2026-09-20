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
  importOfficialEcr: () => ipcRenderer.invoke('ecr:import-official')
});
