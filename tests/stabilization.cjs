/* Run with Node; requires Playwright and an installed Microsoft Edge browser. */
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),Module=require('module');
const root=path.resolve(__dirname,'..'),results=[];
const pass=x=>{results.push(x);console.log('PASS '+x);};
const state=require('../app/state-validation'),disk=require('../state-persistence');
function expose(file,names){const m=new Module(path.join(root,file),module);m.filename=path.join(root,file);m.paths=module.paths;m._compile(fs.readFileSync(m.filename,'utf8')+'\nmodule.exports.test={'+names.join(',')+'}',m.filename);return m.exports.test;}
(async()=>{const b=await chromium.launch({channel:'msedge',headless:true});try{
const p=await b.newPage();p.on('dialog',d=>d.accept());const errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto(require('url').pathToFileURL(root+'/app/index.html').href);
const checks=await p.evaluate(async()=>{
 const checks=[];const check=(v,msg)=>{if(!v)throw Error(msg);checks.push(msg)};
 const clone=v=>JSON.parse(JSON.stringify(v));
 const rejects=(fn,re)=>{try{fn()}catch(e){return re.test(e.message)}return false};
 const make=()=>{const c=newClass('Synthetic class');c.students=[{id:'s',name:'TEST, Learner',sex:'F'}];return c};
 const payload=(hps)=>({termNo:2,categories:{WW:{hps}},students:[]});
 const c=make();let before=JSON.stringify(c);
 applyOfficialEcrImport(c,payload(['',null,undefined,'  ']));check(before===JSON.stringify(c),'Blank/null/missing/whitespace HPS preserved');
 applyOfficialEcrImport(c,payload([0]));check(c.categories.WW.components[0].hps===0,'Explicit zero remains distinct');
 const cross=make(),id=cross.categories.WW.components[0].id;cross.scores.term1={s:{WW:{[id]:50}}};before=JSON.stringify(cross);
 check(rejects(()=>applyOfficialEcrImport(cross,payload([10])),/TERM1/)&&before===JSON.stringify(cross),'Cross-term HPS conflict rejects without mutation');
 check(rejects(()=>applyOfficialEcrImport(cross,payload([100])),/Confirm/)&&before===JSON.stringify(cross),'Valid shared HPS change requires explicit cross-term confirmation');
 applyOfficialEcrImport(cross,payload([100]),{allowCrossTermChange:true});check(cross.categories.WW.components[0].hps===100,'Confirmed cross-term change applied');
 const invalid=make();before=JSON.stringify(invalid);
 const bad={termNo:1,meta:{section:'changed'},students:[{name:'TEST, Learner',scores:{WW:[999]}}]};
 check(rejects(()=>applyOfficialEcrImport(invalid,bad),/raw score/)&&before===JSON.stringify(invalid),'Invalid imported raw score rolls back metadata and scores');
 const a=createAdviserWorkspace();a.students=Array.from({length:999},(_,i)=>({id:'s'+i,name:'Existing '+i,lrn:String(100000000000+i),sex:'M'}));
 const sf={meta:{section:'New'},learners:[{name:'NEW, One',lrn:'200000000001',sex:'F'},{name:'NEW, Two',lrn:'200000000002',sex:'M'}]};before=JSON.stringify(a);
 check(rejects(()=>applyOfficialSf1Import(a,sf,{removeAbsent:false}),/1,000/)&&before===JSON.stringify(a),'SF1 over-capacity merge leaves all records untouched');
 applyOfficialSf1Import(a,sf,{removeAbsent:true});check(a.students.length===2&&a.meta.section==='New','SF1 replacement counts final roster rather than temporary combined roster');
 before=JSON.stringify(a);check(rejects(()=>applyOfficialSf1Import(a,{...sf,learners:[...sf.learners,{name:'BAD',lrn:'x',sex:'?'}]}),/identity/)&&before===JSON.stringify(a),'SF1 invalid trailing learner leaves earlier matches and metadata unchanged');
 check(rejects(()=>applyOfficialSf1Import(a,{...sf,learners:[sf.learners[0],sf.learners[0]]}),/duplicate/)&&before===JSON.stringify(a),'SF1 duplicate LRN rejected transactionally');
 const g=make();for(const t of ['term1','term2','term3']){g.scores[t]={s:{}};for(const k of ['WW','PT','EXAM']){g.categories[k].components.forEach(x=>x.hps=100);g.scores[t].s[k]=Object.fromEntries(g.categories[k].components.map(x=>[x.id,70]));}}
 check(studentFinalResult(g,'s').final===75&&studentFinalResult(g,'s').band==='Connecting','Final 75 uses Connecting without second transmutation');
 const old=clone(APP);delete old.classes[old.activeId].scores.term3;const beforeOld=JSON.stringify(old),normalized=validateBackupForImport(old);
 check(JSON.stringify(old)===beforeOld&&normalized.classes[old.activeId].scores.term3,'Legacy missing empty term normalized on detached copy');
 before=JSON.stringify(APP);check(rejects(()=>validateBackupForImport({classes:{c:{id:'c',meta:{},students:[]}}}),/missing/)&&before===JSON.stringify(APP),'Malformed backup rejected without mutation');
 await saveState();const stable=JSON.stringify(APP),local=localStorage.getItem(STORE_KEY);const next=clone(APP);next.classes[next.activeId].meta.className='Imported';
 const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===STORE_KEY)throw Error('quota');return original.call(this,k,v)};
 let failed=false;try{await commitBackupImport(next)}catch(e){failed=true}finally{Storage.prototype.setItem=original}
 check(failed&&JSON.stringify(APP)===stable&&localStorage.getItem(STORE_KEY)===local,'Failed browser backup save restores in-memory and stored state');
 await commitBackupImport(next);check(activeClass().meta.className==='Imported'&&JSON.parse(localStorage.getItem(STORE_KEY+'.before-import')).classes[next.activeId].meta.className!=='Imported','Successful backup import retains recoverable pre-import snapshot');
 const skip=clone(APP);skip.settings.welcome={skipStartup:true,lastTab:'term1'};check(welcomeInitialTab(skip)==='welcome','Retired startup preference no longer hides Welcome');
 const simple=make();simple.categories.EXAM.mode='simple';simple.categories.EXAM.components[0].hps=0;simple.scores.term1={s:{EXAM:{[simple.categories.EXAM.components[1].id]:10,[simple.categories.EXAM.components[2].id]:20}}};
 const official=officialEcrPayload(simple,'term1');check(official.categories.EXAM.mode==='simple'&&official.students[0].EXAM.componentPs[1]===13.33&&official.students[0].EXAM.componentPs[2]===26.67,'Simple examination payload has mode and proportional component contributions');
 return {checks,official,app:clone(APP)};
});checks.checks.forEach(pass);
// Legacy repair UI must protect even zero scores.
await p.evaluate(()=>{const c=activeClass();c.students=[{id:'legacyS',name:'LEGACY, Test',sex:'M'}];c.categories.WW.components.push({id:'six',name:'WW6',hps:50,subWeight:0});c.scores.term1={legacyS:{WW:{six:0}}};activeTab='setup';render()});
await p.locator('[data-cat="WW"] .comp-remove').last().click();assert.equal(await p.evaluate(()=>activeClass().categories.WW.components.length),6);
await p.evaluate(()=>{delete activeClass().scores.term1.legacyS.WW.six});await p.locator('[data-cat="WW"] .comp-remove').last().click();assert.equal(await p.evaluate(()=>activeClass().categories.WW.components.length),5);assert.equal(await p.locator('[data-cat="WW"] .comp-remove').count(),0);pass('Legacy scored item protected; unscored repair returns to fixed five controls');
const ext=expose('main-extension.js',['validatePayload','examinationWeight','buildOfficialEcrBuffer','buildOfficialGsBuffer']);ext.validatePayload(checks.official);assert.equal(ext.examinationWeight(checks.official.categories.EXAM,0),0);assert(Math.abs(ext.examinationWeight(checks.official.categories.EXAM,1)-100/3)<1e-8);
const Zip=require('adm-zip');for(const build of [ext.buildOfficialEcrBuffer,ext.buildOfficialGsBuffer]){const zip=new Zip(build(checks.official,{fs,resolveResource:r=>path.join(root,r)}));const xml=zip.readAsText('xl/worksheets/sheet1.xml');assert(xml.includes('13.33')&&xml.includes('26.67'));assert(!/<f[ >]/.test(xml));}pass('Simple EX accepted by backend; ECR and GS contain proportional values without formulas');
const imp=require('../flex-importers');for(const blanks of [0,2]){const s=new imp._test.MatrixSheet('Synthetic');[['LRN','Name','Sex'],...Array.from({length:blanks},()=>[]),['123456789012','TEST, Valid','F'],['123456789012','Duplicate','F'],['bad','Invalid','M'],['123456789013','Unknown','?']].forEach((r,i)=>r.forEach((v,j)=>s.set(i,j,v)));const parsed=imp._test.parseSf1Sheet(s);assert.equal(parsed.learners.length,1);assert.equal(parsed.warnings.length,3);}pass('Compact and spaced SF1 headers preserve duplicate/LRN/sex checks');
// Disposable persistence sandbox, never the installed profile.
const tmp=fs.mkdtempSync(path.join(require('os').tmpdir(),'klas-test-'));const paths={root:tmp,dataFile:path.join(tmp,'data.json'),recoveryFile:path.join(tmp,'previous.json'),backupDir:path.join(tmp,'Backups')};fs.mkdirSync(paths.backupDir);
const ctx={fs,path,ensureDataFolders:()=>paths};disk.save(ctx,JSON.stringify(checks.app));const prior=fs.readFileSync(paths.dataFile,'utf8'),candidate=JSON.parse(prior);candidate.classes[candidate.activeId].meta.className='Disk import';candidate._persistence.backupImport=true;disk.save(ctx,JSON.stringify(candidate));assert.equal(fs.readFileSync(paths.recoveryFile,'utf8'),prior);assert(fs.readdirSync(paths.backupDir).some(x=>x.startsWith('before-import-')));assert(!JSON.parse(fs.readFileSync(paths.dataFile))._persistence.backupImport);pass('Desktop atomic save preserves previous and dedicated pre-import backups');
const good=fs.readFileSync(paths.dataFile,'utf8');assert.throws(()=>disk.save(ctx,JSON.stringify({classes:{c:{meta:{},students:[]}}})));assert.equal(fs.readFileSync(paths.dataFile,'utf8'),good);
const faultyFs=Object.create(fs);faultyFs.renameSync=(src,dst)=>{if(dst===paths.dataFile)throw Error('simulated disk failure');fs.renameSync(src,dst)};assert.throws(()=>disk.save({...ctx,fs:faultyFs},JSON.stringify(checks.app)),/simulated/);assert.equal(fs.readFileSync(paths.dataFile,'utf8'),good);pass('Malformed and interrupted disk writes leave primary records intact');
const handlers={},listeners={},sender={};disk.register({...ctx,getMainWindow:()=>({isDestroyed:()=>false,webContents:sender}),ipcMain:{removeHandler(){},handle:(k,fn)=>handlers[k]=fn,removeAllListeners(){},on:(k,fn)=>listeners[k]=fn}});assert.equal((await handlers['data:save']({sender:{}},good)).ok,false);assert.equal((await handlers['data:save']({sender},'{"classes":{}}')).ok,false);const event={sender};listeners['data:load-sync'](event);assert.deepEqual(JSON.parse(event.returnValue),state.validateBackupForImport(JSON.parse(good)));pass('Installed-bootstrap-compatible handlers enforce sender identity and shared validation');
assert.deepEqual(errors,[]);pass('No renderer errors');
console.log(JSON.stringify({passed:results.length,results},null,2));
}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)});
