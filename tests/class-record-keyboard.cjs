const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),Module=require('module');
const root=path.resolve(__dirname,'..'),report=[];const pass=x=>{report.push(x);console.log('PASS '+x)};
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('dialog',d=>d.accept());
 await p.goto(require('url').pathToFileURL(root+'/app/index.html').href);
 await p.evaluate(()=>navigateToTab('setup'));
 for(const [cat,max]of [['WW',5],['PT',3]]){
   const area=p.locator('[data-cat="'+cat+'"]');assert.equal(await area.locator('.comp-remove').count(),max);assert(await area.locator('.comp-add').isDisabled());
   await area.locator('.comp-remove').last().click();assert.equal(await area.locator('.comp-remove').count(),max-1);assert(await area.locator('.comp-add').isEnabled());
   await area.locator('.comp-add').click();assert.equal(await area.locator('.comp-remove').count(),max);assert(await area.locator('.comp-add').isDisabled());
 }
 pass('WW/PT remove and add controls enforce maximums 5/3');
 for(const cat of ['WW','PT']){
   const area=p.locator('[data-cat="'+cat+'"]');while(await area.locator('.comp-remove').count())await area.locator('.comp-remove').last().click();
   assert(await area.locator('.comp-add').isEnabled());await area.locator('.comp-add').click();
 }
 const sparse=await p.evaluate(()=>officialEcrPayload(activeClass(),'term1'));
 const m=new Module(path.join(root,'main-extension.js'),module);m.filename=path.join(root,'main-extension.js');m.paths=module.paths;m._compile(fs.readFileSync(m.filename,'utf8')+'\nmodule.exports.test={buildOfficialEcrBuffer,buildOfficialGsBuffer};',m.filename);
 for(const build of Object.values(m.exports.test)){const buffer=build(sparse,{fs,resolveResource:r=>path.join(root,r)});assert(buffer.length>0);}
 pass('Empty categories can add items again; fewer WW/PT items export through ECR and GS engines');
 await p.evaluate(()=>{const c=activeClass();c.categories=defaultCategories();c.categories.WW.components.push({id:'legacy6',name:'WW6',hps:50,subWeight:0});saveState();render()});
 assert.equal(await p.locator('[data-cat="WW"] .comp-remove').count(),6);assert(await p.locator('[data-cat="WW"] .comp-add').isDisabled());
 await p.locator('[data-cat="WW"] .comp-remove').last().click();assert.equal(await p.locator('[data-cat="WW"] .comp-remove').count(),5);pass('Legacy excess items preserved with additions disabled; unscored excess can be removed');
 await p.evaluate(()=>{const c=activeClass();c.students=[{id:'m1',name:'MALE, One',sex:'M'},{id:'m2',name:'MALE, Two',sex:'M'},{id:'f1',name:'FEMALE, One',sex:'F'}];c.scores.term3={m1:{WW:{[c.categories.WW.components[0].id]:0}}};saveState()});
 await p.locator('[data-cat="WW"] .comp-remove').first().click();assert.equal(await p.locator('[data-cat="WW"] .comp-remove').count(),5);pass('A score of zero in another term protects the item from deletion');
 await p.evaluate(()=>{delete activeClass().scores.term3.m1.WW[activeClass().categories.WW.components[0].id];activeClass().categories.PT.components[0].hps=0;saveState()});
 for(const term of ['term1','term2','term3']){
   await p.evaluate(t=>navigateToTab(t),term);
   const inputs=p.locator('tr[data-sid="m1"] .score-input');await inputs.nth(0).fill('12');await inputs.nth(0).press('Tab');assert(await inputs.nth(1).evaluate(el=>el===document.activeElement));
   await inputs.nth(1).fill('15');await inputs.nth(1).press('Enter');assert(await p.locator('tr[data-sid="m2"] .score-input').nth(1).evaluate(el=>el===document.activeElement));
   await p.keyboard.press('Shift+Enter');assert(await inputs.nth(1).evaluate(el=>el===document.activeElement));await p.keyboard.press('Shift+Tab');assert(await inputs.nth(0).evaluate(el=>el===document.activeElement));
   await inputs.nth(4).focus();await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.activeElement.dataset.cat),'PT');assert.equal(await p.evaluate(()=>document.activeElement.dataset.hps),'50');
   const middle=p.locator('tr[data-sid="m2"] .score-input').nth(1);await middle.focus();await p.keyboard.press('Enter');assert(await p.locator('tr[data-sid="f1"] .score-input').nth(1).evaluate(el=>el===document.activeElement));await p.keyboard.press('Enter');assert(await p.locator('tr[data-sid="f1"] .score-input').nth(1).evaluate(el=>el===document.activeElement));
   await inputs.nth(0).fill('999');await p.keyboard.press('Tab');assert(await inputs.nth(0).evaluate(el=>el===document.activeElement));assert.equal(await inputs.nth(0).inputValue(),'12');assert.equal(await inputs.nth(0).getAttribute('aria-invalid'),'true');
   await inputs.nth(0).fill('17');await inputs.nth(1).click();assert(await inputs.nth(1).evaluate(el=>el===document.activeElement));assert.equal(await inputs.nth(0).inputValue(),'17');
   assert.equal(await p.evaluate(t=>activeClass().scores[t].m1.WW[activeClass().categories.WW.components[0].id],term),17);
   const last=p.locator('tr[data-sid="f1"] .score-input').last();await last.focus();await last.press('Tab');assert(!(await last.evaluate(el=>el===document.activeElement)));
 }
 pass('All three terms: Tab/Shift+Tab, Enter/Shift+Enter, group boundary, inactive item skip, last-row boundary and native Tab exit');
 pass('Invalid entry retains focus/restores prior score; mouse click and edited-cell focus survive computed-cell refresh');
 await p.reload();assert.equal(await p.evaluate(()=>activeClass().scores.term2.m1.WW[activeClass().categories.WW.components[0].id]),17);pass('Entered scores survive reload');
 await p.keyboard.press('Control+Shift+5');assert.equal(await p.evaluate(()=>activeTab),'term1');await p.keyboard.press('Control+Shift+K');assert(await p.locator('#keyboardShortcutEditor').isVisible());
 const editor=p.locator('#keyboardShortcutEditor'),term2=editor.locator('[data-shortcut="term2"]');await term2.focus();await term2.press('Control+Shift+5');assert.match(await editor.locator('#shortcutError').textContent(),/already assigned/);
 await term2.press('Control+Shift+P');assert.match(await editor.locator('#shortcutError').textContent(),/reserved/);
 await term2.press('Control+Shift+A');assert.equal(await term2.inputValue(),'Ctrl+Shift+A');
 await editor.locator('#shortcutCancel').click();await p.keyboard.press('Control+Shift+A');assert.equal(await p.evaluate(()=>activeTab),'term1');
 await p.keyboard.press('Control+Shift+K');await p.locator('[data-shortcut="term2"]').press('Control+Shift+A');await p.locator('[data-shortcut="gs1"]').press('Control+Shift+F');await p.locator('#shortcutSave').click();
 await p.keyboard.press('Control+Shift+A');assert.equal(await p.evaluate(()=>activeTab),'term2');await p.reload();await p.keyboard.press('Control+Shift+A');assert.equal(await p.evaluate(()=>activeTab),'term2');
 await p.keyboard.press('Control+Shift+F');assert.equal(await p.evaluate(()=>TERM_VIEW_MODE.term1),'gs');await p.keyboard.press('Control+Shift+5');assert.equal(await p.evaluate(()=>TERM_VIEW_MODE.term1),'record');
 await p.keyboard.press('Control+Shift+9');assert.equal(await p.evaluate(()=>activeTab),'adviserhome');
 pass('Page shortcuts, editable assignments, duplicate/reserved detection, Cancel, persistence and record/GS routing');
 await p.keyboard.press('Control+Shift+K');await p.locator('#shortcutReset').click();await p.locator('#shortcutSave').click();await p.keyboard.press('Control+Shift+A');assert.equal(await p.evaluate(()=>activeTab),'adviserhome');pass('Reset defaults removes custom assignments');
 await p.keyboard.press('Control+Shift+K');for(const width of [1440,980,390,320]){await p.setViewportSize({width,height:900});assert(await p.locator('#keyboardShortcutEditor').isVisible());assert(await p.locator('#shortcutSave').isVisible());assert.equal(await p.evaluate(()=>{const d=document.getElementById('keyboardShortcutEditor');return d.scrollWidth>d.clientWidth+1}),false);}await p.keyboard.press('Escape');pass('Editor remains usable at 320–1440 widths and Escape closes it');
 assert.deepEqual(errors,[]);pass('No renderer errors');
 // Exercise native Help integration with a menu/lifecycle fixture, without invoking Excel.
 const events={},loads={},help={label:'Help',submenu:{items:[],append(item){this.items.push(item)}}},menu={items:[help]};let script='';const win={isDestroyed:()=>false,webContents:{on:(name,fn)=>loads[name]=fn,executeJavaScript:s=>{script=s;return Promise.resolve()}}};
 require('../keyboard-menu').registerKeyboardMenu({app:{on:(name,fn)=>events[name]=fn},getMainWindow:()=>win,Menu:{getApplicationMenu:()=>menu,setApplicationMenu:m=>assert.equal(m,menu)}},class{constructor(options){Object.assign(this,options)}});
 events['browser-window-created']({},win);loads['did-finish-load']();loads['did-finish-load']();assert.equal(help.submenu.items.length,1);help.submenu.items[0].submenu[0].click();assert.match(script,/klasOpenKeyboardShortcuts/);pass('Help > Keyboard Shortcuts > Edit Page Shortcuts installed once after main-window load');
 console.log(JSON.stringify({passed:report.length,report},null,2));
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
