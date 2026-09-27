'use strict';
// Uses the existing extension lifecycle; no new preload/IPC allowlist needed.
function registerKeyboardMenu(context,MenuItem){
  context.app.on('browser-window-created',(_event,win)=>{
    win.webContents.on('did-finish-load',()=>{
      if(win!==context.getMainWindow()||win.isDestroyed())return;
      const menu=context.Menu.getApplicationMenu();
      const help=menu&&menu.items.find(item=>String(item.label).replace(/&/g,'')==='Help');
      if(!help||!help.submenu||help.submenu.items.some(item=>item.id==='klas-keyboard-shortcuts'))return;
      help.submenu.append(new MenuItem({id:'klas-keyboard-shortcuts',label:'Keyboard Shortcuts',submenu:[{
        label:'Edit Page Shortcuts…',
        click:()=>{
          if(win.isDestroyed())return;
          // Fixed application code, never an expression supplied by a record or shortcut.
          win.webContents.executeJavaScript('window.klasOpenKeyboardShortcuts && window.klasOpenKeyboardShortcuts()').catch(err=>console.warn('Could not open keyboard settings:',err.message));
        }
      }]}));
      context.Menu.setApplicationMenu(menu);
    });
  });
}
module.exports={registerKeyboardMenu};
