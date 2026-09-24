/* Overlay-compatible persistence. Uses the bootstrap's paths and sender identity. */
'use strict';
const crypto=require('crypto');
const {validateBackupForImport}=require('./app/state-validation');
function parseState(text){
  if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>64*1024*1024)throw Error('Application data exceeds the JSON safety limit.');
  return validateBackupForImport(JSON.parse(text));
}
function atomicWrite(fs,file,text){
  const tmp=file+'.tmp-'+crypto.randomBytes(8).toString('hex');
  try{
    const fd=fs.openSync(tmp,'wx');
    try{fs.writeFileSync(fd,text,'utf8');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    if(fs.readFileSync(tmp,'utf8')!==text)throw Error('Data verification failed before replacement.');
    fs.renameSync(tmp,file);
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function save(ctx,text){
  const state=parseState(text),p=ctx.ensureDataFolders(),{fs,path}=ctx;
  const importing=state._persistence&&state._persistence.backupImport===true;
  if(state._persistence)delete state._persistence.backupImport;
  let previous;
  if(fs.existsSync(p.dataFile)){
    try{previous=JSON.stringify(parseState(fs.readFileSync(p.dataFile,'utf8')));}catch(err){
      // Keep corrupt input for recovery rather than silently destroying evidence.
      const quarantine=path.join(p.backupDir,'unreadable-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex')+'.json');
      fs.copyFileSync(p.dataFile,quarantine);
    }
  }
  if(previous){
    atomicWrite(fs,p.recoveryFile,previous);
    if(importing)atomicWrite(fs,path.join(p.backupDir,'before-import-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex')+'.json'),previous);
  }
  const normalized=JSON.stringify(state);
  // Daily backup failure must happen before the primary commit.
  const daily=path.join(p.backupDir,'auto-backup-'+new Date().toISOString().slice(0,10)+'.json');
  if(!fs.existsSync(daily))atomicWrite(fs,daily,previous||normalized);
  atomicWrite(fs,p.dataFile,normalized);
  return {ok:true,path:p.dataFile,bytes:Buffer.byteLength(normalized)};
}
function register(ctx){
  const trusted=event=>{const win=ctx.getMainWindow();return !!(win&&!win.isDestroyed()&&event&&event.sender===win.webContents);};
  ctx.ipcMain.removeHandler('data:save');
  ctx.ipcMain.handle('data:save',async(event,text)=>{
    if(!trusted(event))return{ok:false,error:'Request rejected from an untrusted window.'};
    try{return save(ctx,text);}catch(err){return{ok:false,error:err.message};}
  });
  ctx.ipcMain.removeHandler('backup:import');
  ctx.ipcMain.handle('backup:import',async event=>{
    if(!trusted(event))return{ok:false,error:'Request rejected from an untrusted window.'};
    try{
      const {canceled,filePaths}=await ctx.dialog.showOpenDialog(ctx.getMainWindow(),{title:'Import Gradebook Backup',properties:['openFile'],filters:[{name:'JSON Backup',extensions:['json']}]});
      if(canceled||!filePaths||!filePaths[0])return{cancelled:true};
      const file=filePaths[0],stat=ctx.fs.statSync(file);
      if(!stat.isFile()||stat.size>64*1024*1024)throw Error('Backup exceeds the 64 MB safety limit.');
      return{ok:true,text:JSON.stringify(parseState(ctx.fs.readFileSync(file,'utf8'))),path:file};
    }catch(err){return{ok:false,error:err.message};}
  });
  ctx.ipcMain.removeHandler('backup:export');
  ctx.ipcMain.handle('backup:export',async(event,text)=>{
    if(!trusted(event))return{ok:false,error:'Request rejected from an untrusted window.'};
    try{
      const normalized=JSON.stringify(parseState(text),null,2);
      const {canceled,filePath}=await ctx.dialog.showSaveDialog(ctx.getMainWindow(),{title:'Export Gradebook Backup',defaultPath:ctx.path.join(ctx.app.getPath('documents'),'eclass-record-backup-'+new Date().toISOString().slice(0,10)+'.json'),filters:[{name:'JSON Backup',extensions:['json']}]});
      if(canceled||!filePath)return{ok:false,cancelled:true};
      atomicWrite(ctx.fs,filePath,normalized);return{ok:true,path:filePath};
    }catch(err){return{ok:false,error:err.message};}
  });
  ctx.ipcMain.removeAllListeners('data:load-sync');
  ctx.ipcMain.on('data:load-sync',event=>{
    event.returnValue=null;if(!trusted(event))return;
    const p=ctx.ensureDataFolders();
    for(const file of [p.dataFile,p.recoveryFile])try{
      if(ctx.fs.existsSync(file)){event.returnValue=JSON.stringify(parseState(ctx.fs.readFileSync(file,'utf8')));return;}
    }catch(err){console.warn('Data candidate could not be loaded:',err.message);}
  });
}
module.exports={parseState,atomicWrite,save,register};
