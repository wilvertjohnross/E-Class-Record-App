/* Local page shortcuts. No global OS hooks; preferences travel with backups. */
(() => {
  const pages=[
    ['welcome','Welcome'],['subjecthome','Class Overview'],['setup','Class Setup'],
    ['classroster','Learner Roster'],['gradinghome','Term Grades'],
    ['term1','Class Record — Term 1'],['term2','Class Record — Term 2'],['term3','Class Record — Term 3'],
    ['final','Final Grades'],['adviserhome','Advisory Overview'],['roster','SF1'],['sf2','SF2 — Attendance'],
    ['advisersummary','Adviser Summary of Final Grades'],['sf9setup','SF9 Setup'],['report','SF9 — Report Cards'],
    ['gs1','Grading Sheet — Term 1'],['gs2','Grading Sheet — Term 2'],['gs3','Grading Sheet — Term 3']
  ];
  const defaults=Object.fromEntries(pages.map(([id],i)=>[id,i<10?'Ctrl+Shift+'+i:'']));
  const editorKey='Ctrl+Shift+K';
  // Preserve editing, printing, browser/Electron tools and window shortcuts.
  const reserved=new Set(['I','J','C','N','T','W','P','Q','B','O','H','D','R','S','V','Z','U','Y','L','M','E'].map(k=>'Ctrl+Shift+'+k));
  reserved.add(editorKey);
  const valid=combo=>combo===''||(/^Ctrl\+Shift\+[A-Z0-9]$/.test(combo)&&!reserved.has(combo));
  function current(){
    const saved=APP.settings&&APP.settings.pageShortcuts;
    if(!saved||typeof saved!=='object'||Array.isArray(saved))return {...defaults};
    const used=new Set();
    return Object.fromEntries(pages.map(([id])=>{
      const combo=Object.hasOwn(saved,id)?saved[id]:defaults[id];
      const value=typeof combo==='string'&&valid(combo)&&!used.has(combo)?combo:'';
      if(value)used.add(value);return[id,value];
    }));
  }
  function combination(event){
    if(event.isComposing||event.metaKey||event.altKey||event.getModifierState('AltGraph')||!event.ctrlKey||!event.shiftKey)return '';
    const key=event.code.startsWith('Key')?event.code.slice(3):event.code.startsWith('Digit')?event.code.slice(5):'';
    return /^[A-Z0-9]$/.test(key)?'Ctrl+Shift+'+key:'';
  }
  function modalOpen(){return !!document.querySelector('dialog[open],.app-modal-backdrop,[role="dialog"][aria-modal="true"]');}
  function finishScore(){
    const input=document.activeElement;
    if(input&&input.matches('.score-input')){
      const check=validateRawScoreEntry(input.value,input.dataset.hps);
      if(!check.ok){markRawScoreError(input,check.message);input.select();return false;}
    }
    if(input&&typeof input.blur==='function')input.blur();
    return true;
  }
  function navigate(id){
    if(!finishScore())return;
    if(/^gs[123]$/.test(id))navigateToTab('term'+id.slice(2),{termView:'gs'});
    else navigateToTab(id,{termView:/^term[123]$/.test(id)?'record':''});
  }
  function openEditor(){
    const origin=document.activeElement;
    if(modalOpen()||!finishScore())return;
    const draft=current(),dialog=document.createElement('dialog');
    dialog.id='keyboardShortcutEditor';dialog.className='app-modal shortcut-editor no-print';
    dialog.setAttribute('aria-labelledby','shortcutTitle');
    dialog.innerHTML=`<h2 id="shortcutTitle">Page keyboard shortcuts</h2>
      <p>Choose a shortcut box, then press Ctrl + Shift + a letter or number. Backspace clears it. Common editing and window shortcuts are reserved.</p>
      <p class="hint">Ctrl + Shift + K opens this editor. In Class Records, Tab moves across and Enter moves down; Shift reverses direction.</p>
      <div class="shortcut-list"><table class="data"><thead><tr><th>Page</th><th>Shortcut</th><th></th></tr></thead><tbody>
      ${pages.map(([id,label])=>`<tr><td>${esc(label)}</td><td><input type="text" readonly data-shortcut="${id}" aria-label="Shortcut for ${esc(label)}" placeholder="Not assigned"></td><td><button type="button" class="small" data-clear="${id}" aria-label="Clear shortcut for ${esc(label)}">Clear</button></td></tr>`).join('')}
      </tbody></table></div><p id="shortcutError" role="alert" class="app-modal-error"></p>
      <div class="app-modal-actions"><button type="button" id="shortcutReset">Reset defaults</button><button type="button" id="shortcutCancel">Cancel</button><button type="button" class="primary" id="shortcutSave">Save shortcuts</button></div>`;
    document.body.appendChild(dialog);
    const error=dialog.querySelector('#shortcutError');
    const refresh=()=>dialog.querySelectorAll('[data-shortcut]').forEach(input=>input.value=draft[input.dataset.shortcut]);
    refresh();
    const close=()=>{dialog.close();dialog.remove();if(origin&&origin.isConnected)origin.focus();};
    dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    dialog.querySelector('#shortcutCancel').onclick=close;
    dialog.querySelector('#shortcutReset').onclick=()=>{Object.assign(draft,defaults);error.textContent='';refresh();};
    dialog.querySelectorAll('[data-clear]').forEach(button=>button.onclick=()=>{draft[button.dataset.clear]='';refresh();error.textContent='';});
    dialog.querySelectorAll('[data-shortcut]').forEach(input=>input.addEventListener('keydown',event=>{
      if(['Tab','Escape','Control','Shift'].includes(event.key))return;
      event.preventDefault();event.stopPropagation();
      if(['Backspace','Delete'].includes(event.key)&&!event.ctrlKey&&!event.altKey){draft[input.dataset.shortcut]='';refresh();error.textContent='';return;}
      const combo=combination(event);
      if(!combo||!valid(combo)){error.textContent='Choose Ctrl + Shift with an available letter or number. That combination is reserved or unsupported.';return;}
      const conflict=pages.find(([id])=>id!==input.dataset.shortcut&&draft[id]===combo);
      if(conflict){error.textContent=combo+' is already assigned to '+conflict[1]+'. Clear its assignment first.';return;}
      draft[input.dataset.shortcut]=combo;refresh();error.textContent='';
    }));
    dialog.querySelector('#shortcutSave').onclick=async()=>{
      const button=dialog.querySelector('#shortcutSave'),settings=ensureAppSettings(),previous=settings.pageShortcuts;
      button.disabled=true;settings.pageShortcuts={...draft};
      try{
        const result=await saveState();if(!result||result.ok===false)throw Error('Shortcuts could not be saved. Please retry.');
        close();
      }catch(err){
        if(previous===undefined)delete settings.pageShortcuts;else settings.pageShortcuts=previous;
        try{localStorage.setItem(STORE_KEY,JSON.stringify(APP));}catch(_){}
        error.textContent=err.message;button.disabled=false;
      }
    };
    dialog.showModal();dialog.querySelector('[data-shortcut]').focus();
  }
  document.addEventListener('keydown',event=>{
    const combo=combination(event);if(!combo||event.repeat||modalOpen())return;
    if(combo===editorKey){event.preventDefault();openEditor();return;}
    const id=pages.find(([id])=>current()[id]===combo)?.[0];
    if(id){event.preventDefault();navigate(id);}
  },true);
  window.klasOpenKeyboardShortcuts=openEditor;
  const style=document.createElement('style');
  style.textContent='.shortcut-editor{width:min(760px,94vw);max-width:94vw;max-height:90vh;box-sizing:border-box;color:var(--ink);background:var(--paper,#fff);border:1px solid var(--line,#cbd5d9);border-radius:18px;padding:24px}.shortcut-editor::backdrop{background:rgba(0,0,0,.45)}.shortcut-list{max-height:52vh;overflow:auto}.shortcut-editor table{width:100%}.shortcut-editor table.data th,.shortcut-editor table.data td{text-align:left;padding:8px}.shortcut-editor table.data input{width:170px;max-width:100%;box-sizing:border-box}.shortcut-editor input:focus{outline:2px solid var(--accent,#00878b);outline-offset:2px}@media(max-width:520px){.shortcut-editor{padding:14px}.shortcut-editor table.data td,.shortcut-editor table.data th{padding:4px}.shortcut-editor table.data input{width:125px}.shortcut-editor .app-modal-actions{flex-wrap:wrap}}';
  document.head.appendChild(style);
})();
