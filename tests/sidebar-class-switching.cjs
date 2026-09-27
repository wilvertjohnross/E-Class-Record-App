const {chromium}=require('playwright'),assert=require('assert/strict'),path=require('path');
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true});try{
 const p=await b.newPage({viewport:{width:1440,height:1000}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(require('url').pathToFileURL(path.resolve(__dirname,'../app/index.html')).href);
 assert.equal(await p.locator('header #statusVersion').textContent(),'v'+require('../package.json').version);assert.equal(await p.locator('#statusVersion').count(),1);assert(await p.locator('#statusVersion').isVisible());
 await p.waitForFunction(()=>getComputedStyle(document.getElementById('sidebarHomeBrand')).backgroundColor==='rgb(232, 230, 223)');
 const ids=await p.evaluate(()=>{const a=activeClass();a.meta.className='Class Alpha';a.students=[{id:'alpha',name:'ALPHA, Learner',sex:'M'}];const c=newClass('Class Beta');c.students=[{id:'beta',name:'BETA, Learner',sex:'F'}];APP.classes[c.id]=c;saveState();return[a.id,c.id]});
 for(const tab of ['subjecthome','setup','classroster','gradinghome','term1','term2','term3','final']){
   await p.evaluate(t=>navigateToTab(t),tab);assert(await p.locator('#workspaceClassSelect').isVisible());
   await p.locator('#workspaceClassSelect').selectOption(ids[1]);assert.equal(await p.evaluate(()=>activeTab),tab);assert.equal(await p.evaluate(()=>APP.activeId),ids[1]);
   if(tab==='classroster')assert.equal(await p.locator('input[value="BETA, Learner"]').count(),1);
   if(['term1','term2','term3','final'].includes(tab)){assert.match(await p.locator('#main').textContent(),/BETA, Learner/);assert(!/ALPHA, Learner/.test(await p.locator('#main').textContent()));}
   await p.locator('#workspaceClassSelect').selectOption(ids[0]);assert.equal(await p.evaluate(()=>APP.activeId),ids[0]);
 }
 console.log('PASS class switching preserves page and isolates displayed roster/grades on eight subject pages');
 const imports=await p.evaluate(()=>{
   const cls=activeClass(),before=JSON.stringify(cls),results=[];
   for(const incoming of [{weight:0.4},{subWeights:[20,30,50]}]){
     try{applyOfficialEcrImport(cls,{termNo:1,categories:{EXAM:incoming},students:[]});results.push(false)}
     catch(e){results.push(/fixed setup/.test(e.message)&&JSON.stringify(cls)===before)}
   }
   preflightOfficialEcrSharedConfig(cls,{categories:{EXAM:{weight:0.3,subWeights:[30,30,40]}},students:[]},'term1');
   return results;
 });assert.deepEqual(imports,[true,true]);console.log('PASS fixed examination import conflicts reject transactionally; matching weights accepted');
 await p.evaluate(()=>navigateToTab('gradinghome'));assert.equal(await p.locator('#main h2').first().textContent(),'Term Grades');assert.match(await p.locator('#tabs').textContent(),/Term Grades/);
 await p.evaluate(()=>navigateToTab('adviserhome'));assert.equal(await p.locator('#workspaceClassSelect').count(),0);await p.locator('#sidebarHomeBrand').click();assert.equal(await p.evaluate(()=>activeTab),'welcome');
 console.log('PASS Term Grades labels, adviser separation, clickable logo and visible sidebar version');
 await p.evaluate(()=>navigateToTab('setup'));const exam=p.locator('[data-cat="EXAM"]');assert.equal(await exam.locator('.comp-add,.comp-remove,.cat-mode').count(),0);
 for(const input of await exam.locator('.comp-name,.comp-subweight,.cat-weight').all())assert(await input.evaluate(el=>el.readOnly));
 assert.deepEqual(await p.evaluate(()=>activeClass().categories.EXAM.components.map(c=>[c.name,c.subWeight])),[['ST1',30],['ST2',30],['TE',40]]);
 await exam.locator('.comp-hps').first().fill('40');await exam.locator('.comp-hps').first().dispatchEvent('change');await p.reload();await p.evaluate(()=>navigateToTab('setup'));assert.equal(await exam.locator('.comp-hps').first().inputValue(),'40');
 assert.equal(await p.locator('[data-cat="WW"] .comp-remove').count(),5);assert.equal(await p.locator('[data-cat="PT"] .comp-remove').count(),3);
 await p.evaluate(()=>{const c=activeClass();c.categories.EXAM.mode='simple';c.categories.EXAM.components.push({id:'legacyExam',name:'Legacy exam',hps:10,subWeight:0});saveState();render()});
 assert.equal(await exam.locator('.comp-name').count(),4);assert.match(await exam.textContent(),/Existing examination setup preserved/);
 console.log('PASS examination controls locked, HPS editable/persistent, WW/PT controls retained and legacy exam data preserved');
 for(const width of [1440,980,390,320]){
   await p.setViewportSize({width,height:1000});await p.evaluate(()=>navigateToTab('gradinghome'));assert(await p.locator('#workspaceClassSelect').isVisible());assert(await p.locator('#statusVersion').isVisible());
   const safe=await p.evaluate(()=>{const c=document.querySelector('.workspace-class-controls').getBoundingClientRect(),nav=document.querySelector('.page-shell-nav').getBoundingClientRect();return c.top>=nav.bottom-1||c.right<=nav.left||c.left>=nav.right;});assert(safe,'Class picker overlaps navigation at '+width);
 }
 await p.locator('#btnTheme').click();assert.equal(await p.locator('#sidebarHomeBrand').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(232, 230, 223)');assert(await p.locator('#statusVersion').isVisible());
 assert.deepEqual(errors,[]);console.log('PASS responsive picker separation and sidebar identity in both themes; no renderer errors');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
