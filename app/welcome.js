/* KLAS welcome/profile: optional local settings, separate from official records. */
const WELCOME_TABS = {subjecthome:'Class Overview',setup:'Class Setup',classroster:'Learner Roster',term1:'Class Record — Term 1',term2:'Class Record — Term 2',term3:'Class Record — Term 3',final:'Final Grades',adviserhome:'Advisory Overview',roster:'SF1',sf2:'SF2',advisersummary:'Summary of Subject Grades',sf9setup:'SF9 Setup',report:'SF9',sf5:'SF5',sf10:'SF10'};
let welcomeClockTimer = null;
function welcomeSettings(state=APP){
  const value=state.settings&&state.settings.welcome;
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
}
function welcomeProfile(){
  const p=APP.settings&&APP.settings.teacherProfile;
  return p&&typeof p==='object'&&!Array.isArray(p)?p:{};
}
function welcomeInitialTab(state){
  const w=welcomeSettings(state);
  delete w.skipStartup;
  return 'welcome';
}
function welcomeRememberView(){
  if(activeTab==='welcome')return;
  if(welcomeClockTimer){clearInterval(welcomeClockTimer);welcomeClockTimer=null;}
  if(!Object.hasOwn(WELCOME_TABS,activeTab))return;
  const settings=ensureAppSettings(),old=welcomeSettings();
  if(old.lastTab===activeTab&&old.lastClassId===APP.activeId)return;
  settings.welcome={...old,lastTab:activeTab,lastClassId:APP.activeId};
  saveState();
}
function welcomeGreeting(date=new Date()){
  const hour=date.getHours();
  const greeting=hour<12?'Good morning':hour<18?'Good afternoon':'Good evening';
  const p=welcomeProfile(),name=String(p.displayName||'').trim();
  const title=['Sir','Ma’am'].includes(p.title)?p.title:'';
  return name?`${greeting}, ${title?title+' ':''}${name}!`:`${greeting}!`;
}
function welcomeTick(){
  const clock=document.getElementById('welcomeClock');if(!clock)return;
  const now=new Date();clock.textContent=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  clock.dateTime=now.toISOString();
  document.getElementById('welcomeDate').textContent=now.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric',year:'numeric'});
  document.getElementById('welcomeGreeting').textContent=welcomeGreeting(now);

}
function welcomePhotoSafe(value){return typeof value==='string'&&value.length<=4*1024*1024&&/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value);}
function welcomeMarkBackup(){
  ensureAppSettings().welcome={...welcomeSettings(),lastBackupAt:new Date().toISOString()};
  saveState();
  const el=document.getElementById('welcomeBackupStatus');if(el)el.textContent=welcomeBackupLabel();
}
function welcomeBackupLabel(){
  const date=new Date(welcomeSettings().lastBackupAt||'');
  return Number.isFinite(date.getTime())?`Last successful backup: ${date.toLocaleString()}`:'No successful backup recorded yet.';
}
function welcomeButtonIcons(root){
  const paths={profile:'M20 21v-2a7 7 0 0 0-14 0v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',continue:'M5 12h14 M13 6l6 6-6 6',teaching:'M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3z M12 6v15',adviser:'M16 21v-2a6 6 0 0 0-12 0v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 8 M20 15a5 5 0 0 1 2 4v2',add:'M12 5v14 M5 12h14',upload:'M12 16V3 M7 8l5-5 5 5 M4 15v6h16v-6',download:'M12 3v13 M7 11l5 5 5-5 M4 17v4h16v-4',save:'M5 3h12l4 4v14H3V3z M7 3v6h10V3 M7 21v-8h10v8',close:'M6 6l12 12 M6 18L18 6'};
  const targets={'#welcomeEditProfile':'profile','#welcomeContinue':'continue','[data-go-tab="subjecthome"]':'teaching','#welcomeAdviser':'adviser','[data-click-id="btnNewClass"]':'add','[data-click-id="btnImport"]':'upload','[data-click-id="btnExport"]':'download','#profileSave':'save','#profileClose':'close'};
  for(const [selector,name] of Object.entries(targets)){const button=root.querySelector(selector);if(button)button.insertAdjacentHTML('afterbegin','<svg class="welcome-button-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="'+paths[name]+'"/></svg>');}
}
function renderWelcome(main){
  const profile=welcomeProfile(),settings=welcomeSettings(),cls=activeClass(),adviser=adviserClass();
  const hasProfile=!!String(profile.displayName||'').trim();
  const lastCls=APP.classes[settings.lastClassId]||cls;
  const lastTab=Object.hasOwn(WELCOME_TABS,settings.lastTab)?settings.lastTab:'subjecthome';
  const hasLast=!!settings.lastTab;
  const initials=String(profile.displayName||'Teacher').trim().split(/\s+/).slice(0,2).map(s=>Array.from(s)[0]||'').join('').toUpperCase();
  main.innerHTML=`<section class="welcome-page">
    <img class="welcome-background" src="assets/welcome-classroom.png" alt="" aria-hidden="true">
    <div class="welcome-content">
      <div class="welcome-brand welcome-artwork"><img class="welcome-banner" src="assets/klas-banner.png" alt="KLAS — The One Place for Every Class"></div>
      <div class="welcome-hero">
        <div class="welcome-person"><div class="welcome-avatar">${welcomePhotoSafe(profile.photoDataUri)?`<img src="${esc(profile.photoDataUri)}" alt="Teacher profile photo">`:`<span aria-hidden="true">${esc(initials)}</span>`}</div>
          <div><p class="welcome-eyebrow">YOUR TEACHING WORKSPACE</p><h1 id="welcomeGreeting"></h1>${profile.employeeId?`<p class="welcome-employee">Employee ID: ${esc(profile.employeeId)}</p>`:''}<div class="welcome-profile-details"><p class="welcome-school">${esc(cls?.meta?.schoolName||'Welcome to your teaching workspace.')}</p><button id="welcomeEditProfile" class="small ghost-alt" type="button">${hasProfile?'Edit Profile':'Set Up Profile'}</button></div></div>
        </div>
        <div class="welcome-time"><time id="welcomeClock"></time><p id="welcomeDate"></p><span>Computer’s local time</span></div>
      </div>
      <div class="welcome-bottom"><div class="welcome-actions">
        <div class="welcome-action welcome-continue"><span class="welcome-eyebrow">${hasLast?'PICK UP WHERE YOU LEFT OFF':'READY WHEN YOU ARE'}</span><h2>${hasLast?'Continue working':'Start your teaching day'}</h2><p>${hasLast?esc((roleForTab(lastTab)==='adviser'?'Advisory workspace':lastCls?.meta?.className||'Teaching class')+' · '+WELCOME_TABS[lastTab]):'Create a teaching class or restore an existing backup.'}</p><button id="welcomeContinue" class="primary" type="button">${hasLast?'Continue Working':'Open Class Overview'}</button></div>
        <div class="welcome-action"><span class="welcome-eyebrow">TEACHING</span><h2>Subject Teacher</h2><p>Manage your classes, learners and grading.</p><button class="ghost-alt" data-go-tab="subjecthome" type="button">Open Teaching Classes</button></div>
        <div class="welcome-action"><span class="welcome-eyebrow">ADVISORY</span><h2>Adviser</h2><p>${adviserSf1Ready(adviser)?'Your SF1 masterlist is ready. Open your advisory records.':'Set up your advisory class with an SF1 masterlist.'}</p><button id="welcomeAdviser" class="ghost-alt" type="button">${adviserSf1Ready(adviser)?'Open Advisory Workspace':'Upload SF1'}</button></div>
      </div>
      <dialog id="welcomeProfilePanel" class="welcome-profile" aria-labelledby="welcomeProfileTitle"><div class="welcome-modal-heading"><h2 id="welcomeProfileTitle">Teacher profile</h2><button type="button" id="profileClose" class="ghost-alt" aria-label="Close profile setup">Close</button></div>
        <form id="welcomeProfileForm"><p>Your display profile is separate from official teacher names and signatories.</p>
          <div class="welcome-profile-grid">
            <div class="field"><label for="profileDisplayName">Display name</label><input id="profileDisplayName" type="text" maxlength="80" required value="${esc(profile.displayName||'')}" autocomplete="nickname"></div>
            <div class="field"><label for="profileTitle">Preferred title</label><select id="profileTitle"><option value="">No title</option><option value="Sir" ${profile.title==='Sir'?'selected':''}>Sir</option><option value="Ma’am" ${profile.title==='Ma’am'?'selected':''}>Ma’am</option></select></div>
            <div class="field"><label for="profileEmployeeId">Employee ID (optional)</label><input id="profileEmployeeId" type="text" maxlength="60" value="${esc(profile.employeeId||'')}"></div>
            <div class="field"><label for="profilePhoto">Profile photo (optional)</label><input id="profilePhoto" type="file" accept="image/png,image/jpeg,image/webp"><small>PNG, JPG or WebP, up to 10 MB.</small><label class="welcome-check"><input id="profileRemovePhoto" type="checkbox"> Remove current photo</label></div>
          </div><p id="profileError" class="welcome-error" role="alert"></p><button class="primary" id="profileSave" type="submit">Save Profile</button><span class="welcome-local-note">Saved on this computer and included in backups.</span>
        </form>
      </dialog>
      </div>
    </div>
  </section>`;
  welcomeButtonIcons(main);
  welcomeTick();if(welcomeClockTimer)clearInterval(welcomeClockTimer);welcomeClockTimer=setInterval(welcomeTick,1000);
  document.getElementById('welcomeEditProfile').onclick=()=>{const p=document.getElementById('welcomeProfilePanel');p.showModal();document.getElementById('profileDisplayName').focus();};
  document.getElementById('profileClose').onclick=()=>document.getElementById('welcomeProfilePanel').close();
  document.getElementById('welcomeContinue').onclick=()=>{if(lastCls)APP.activeId=lastCls.id;activeTab=hasLast?lastTab:'subjecthome';render();};
  document.getElementById('welcomeAdviser').onclick=()=>{activeTab='adviserhome';render();if(!adviserSf1Ready(adviser))importOfficialSf1IntoClass(adviser);};
  document.getElementById('welcomeProfileForm').onsubmit=async e=>{
    e.preventDefault();const form=e.currentTarget,button=document.getElementById('profileSave'),error=document.getElementById('profileError');
    if(!form.reportValidity())return;const displayName=document.getElementById('profileDisplayName').value.trim();
    if(!displayName){error.textContent='Enter your display name.';return;}
    button.disabled=true;error.textContent='';
    try{
      const file=document.getElementById('profilePhoto').files[0];
      let photoDataUri=document.getElementById('profileRemovePhoto').checked?'':profile.photoDataUri||'';
      if(file)photoDataUri=await resizeSchoolLogo(file);
      if(photoDataUri&&!welcomePhotoSafe(photoDataUri))throw new Error('Please choose a smaller profile photo.');
      ensureAppSettings().teacherProfile={displayName,title:document.getElementById('profileTitle').value,employeeId:document.getElementById('profileEmployeeId').value.trim(),photoDataUri};
      const result=await saveState();if(result&&result.ok===false)throw new Error('Profile could not be saved to disk. Please retry.');
      if(activeTab==='welcome'){render();document.getElementById('welcomeEditProfile').focus();}
    }catch(err){if(error.isConnected)error.textContent=err.message;}finally{if(button.isConnected)button.disabled=false;}
  };
}
