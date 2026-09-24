/* Shared, detached legacy-compatible state validation. */
(function(root){
function validateBackupForImport(data){
  if(!data || typeof data!=="object" || Array.isArray(data) || !data.classes || typeof data.classes!=="object" || Array.isArray(data.classes) || !Object.keys(data.classes).length) throw new Error("Not a valid E-Class Record backup file.");
  const forbidden=new Set(["__proto__","prototype","constructor"]);
  const safeId=/^[A-Za-z0-9_.:-]{1,160}$/;let nodes=0;
  const walk=(v,depth=0)=>{
    if(++nodes>500000||depth>24) throw new Error("Backup structure exceeds safety limits.");
    if(v===null || typeof v==="boolean" || typeof v==="string") return;
    if(typeof v==="number"){if(!Number.isFinite(v))throw new Error("Backup contains an invalid number.");return;}
    if(typeof v!=="object") throw new Error("Backup contains an unsupported value.");
    if(Array.isArray(v)){if(v.length>100000)throw new Error("Backup contains an oversized array.");v.forEach(x=>walk(x,depth+1));return;}
    for(const [k,x] of Object.entries(v)){if(forbidden.has(k))throw new Error("Backup contains a prohibited property.");if(k.length>256)throw new Error("Backup contains an invalid property name.");walk(x,depth+1);}
  };
  walk(data);
  if(Object.keys(data.classes).length>2000) throw new Error("Backup contains too many classes.");
  const roleRecords=Object.entries(data.classes);
  if(data.adviserWorkspace!==undefined){
    if(!data.adviserWorkspace||typeof data.adviserWorkspace!=="object"||Array.isArray(data.adviserWorkspace)) throw new Error("Backup contains an invalid Adviser workspace.");
    roleRecords.push(["adviserWorkspace",data.adviserWorkspace]);
  }
  for(const [cid,cls] of roleRecords){
    if(!safeId.test(cid)||!cls||typeof cls!=="object"||Array.isArray(cls)) throw new Error("Backup contains an invalid class record.");
    if(!Array.isArray(cls.students)||cls.students.length>1000) throw new Error("Backup contains an invalid learner list.");
    for(const st of cls.students){if(!st||typeof st!=="object"||Array.isArray(st)||!st.id||!safeId.test(String(st.id)))throw new Error("Backup contains an invalid learner identifier.");}
    if(cls.categories!==undefined){
      if(!cls.categories||typeof cls.categories!=="object"||Array.isArray(cls.categories))throw new Error("Backup contains invalid grading categories.");
      for(const [key,cat] of Object.entries(cls.categories)){
        if(!safeId.test(key)||!cat||typeof cat!=="object"||Array.isArray(cat))throw new Error("Backup contains an invalid grading category.");
        if(cat.components!==undefined){if(!Array.isArray(cat.components)||cat.components.length>200)throw new Error("Backup contains an invalid component list.");for(const c of cat.components){if(!c||typeof c!=="object"||Array.isArray(c)||!c.id||!safeId.test(String(c.id)))throw new Error("Backup contains an invalid assessment-component identifier.");}}
      }
    }
    if(cls.sf2!==undefined){
      if(!cls.sf2||typeof cls.sf2!=="object"||Array.isArray(cls.sf2))throw new Error("Backup contains invalid SF2 data.");
      if(cls.sf2.activeMonth!==undefined&&cls.sf2.activeMonth!==""&&!/^20\d{2}-(0[1-9]|1[0-2])$/.test(String(cls.sf2.activeMonth)))throw new Error("Backup contains an invalid active SF2 month.");
      const months=cls.sf2.months===undefined?{}:cls.sf2.months;
      if(!months||typeof months!=="object"||Array.isArray(months)||Object.keys(months).length>24)throw new Error("Backup contains an invalid SF2 month collection.");
      const sf2SummaryKeys=new Set(["enrollmentFirstFriday","lateEnrollment","registeredEnd","dropout","transferredOut","transferredIn"]);
      for(const [monthKey,month] of Object.entries(months)){
        if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(monthKey)||!month||typeof month!=="object"||Array.isArray(month))throw new Error("Backup contains an invalid SF2 month.");
        const datePrefix=monthKey+"-";
        if(month.schoolDays!==undefined){
          if(!Array.isArray(month.schoolDays)||month.schoolDays.length>31)throw new Error("Backup contains an invalid SF2 school-day list.");
          const seen=new Set();
          for(const d of month.schoolDays){const ds=String(d);if(!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(ds)||!ds.startsWith(datePrefix)||seen.has(ds))throw new Error("Backup contains an invalid or duplicate SF2 school day.");seen.add(ds);}
        }
        if(month.marks!==undefined){
          if(!month.marks||typeof month.marks!=="object"||Array.isArray(month.marks)||Object.keys(month.marks).length>1000)throw new Error("Backup contains invalid SF2 attendance marks.");
          for(const [sid,marks] of Object.entries(month.marks)){
            if(!safeId.test(String(sid))||!marks||typeof marks!=="object"||Array.isArray(marks)||Object.keys(marks).length>31)throw new Error("Backup contains an invalid SF2 learner attendance record.");
            for(const [date,status] of Object.entries(marks)){if(!date.startsWith(datePrefix)||!/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)||!["A","T","L","C","P"].includes(String(status).toUpperCase()))throw new Error("Backup contains an invalid SF2 attendance code or date.");}
          }
        }
        if(month.remarks!==undefined){
          if(!month.remarks||typeof month.remarks!=="object"||Array.isArray(month.remarks)||Object.keys(month.remarks).length>1000)throw new Error("Backup contains invalid SF2 remarks.");
          for(const [sid,remark] of Object.entries(month.remarks)){if(!safeId.test(String(sid))||typeof remark!=="string"||remark.length>2000)throw new Error("Backup contains an invalid SF2 learner remark.");}
        }
        if(month.summary!==undefined){
          if(!month.summary||typeof month.summary!=="object"||Array.isArray(month.summary))throw new Error("Backup contains an invalid SF2 summary.");
          for(const [field,pair] of Object.entries(month.summary)){
            if(!sf2SummaryKeys.has(field)||!pair||typeof pair!=="object"||Array.isArray(pair))throw new Error("Backup contains an invalid SF2 summary field.");
            for(const sex of ["M","F"]){const v=pair[sex];if(v===undefined||v===""||v===null)continue;const n=Number(v);if(!Number.isFinite(n)||n<0||n>100000)throw new Error("Backup contains an invalid SF2 summary value.");}
          }
        }
      }
    }
  }
  if(data.activeId!==undefined&&data.activeId!==null&&data.activeId!==""){if(!safeId.test(String(data.activeId))||!Object.prototype.hasOwnProperty.call(data.classes,String(data.activeId)))throw new Error("Backup contains an invalid active class identifier.");}
  if(data.settings&&data.settings.schoolLogoDataUri!==undefined&&data.settings.schoolLogoDataUri!==null&&data.settings.schoolLogoDataUri!==""){
    const logo=String(data.settings.schoolLogoDataUri);
    if(logo.length>8*1024*1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(logo)) throw new Error("Backup contains an invalid school-logo image.");
  }
  const copy=JSON.parse(JSON.stringify(data));
  const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  const records=[...Object.values(copy.classes),...(copy.adviserWorkspace?[copy.adviserWorkspace]:[])];
  for(const cls of records){
    if(!record(cls.meta)||!record(cls.categories)||!record(cls.scores)) throw new Error('Backup is missing class metadata, grading categories or scores.');
    const ids=new Set();
    for(const st of cls.students){if(ids.has(st.id))throw new Error('Backup contains duplicate learner identifiers.');ids.add(st.id);if(st.name!==undefined&&typeof st.name!=='string')throw new Error('Invalid learner name.');}
    for(const key of ['WW','PT','EXAM']){
      const cat=cls.categories[key];
      if(!record(cat)||!Array.isArray(cat.components))throw new Error('Backup is missing '+key+' components.');
      if(!['simple','custom'].includes(cat.mode))throw new Error('Invalid category mode.');
      if(cat.weight===''||cat.weight===null||!Number.isFinite(Number(cat.weight))||Number(cat.weight)<0||Number(cat.weight)>1)throw new Error('Invalid category weight.');
      const comps=new Set();
      for(const c of cat.components){
        if(comps.has(c.id))throw new Error('Duplicate component identifier.');comps.add(c.id);
        if(c.hps===''||c.hps===null||!Number.isFinite(Number(c.hps))||Number(c.hps)<0)throw new Error('Invalid component HPS.');
        if(c.subWeight===undefined)c.subWeight=0;
        if(!Number.isFinite(Number(c.subWeight))||Number(c.subWeight)<0||Number(c.subWeight)>100)throw new Error('Invalid component weight.');
      }
    }
    for(const t of ['term1','term2','term3']){
      if(cls.scores[t]===undefined)cls.scores[t]={};
      if(!record(cls.scores[t]))throw new Error('Invalid term scores.');
      for(const [sid,sc] of Object.entries(cls.scores[t])){
        if(!safeId.test(sid)||!record(sc))throw new Error('Invalid learner scores.');
        for(const key of ['WW','PT','EXAM']){
          if(sc[key]===undefined)sc[key]={};
          if(!record(sc[key]))throw new Error('Invalid category scores.');
          for(const [id,v] of Object.entries(sc[key]))if(!safeId.test(id)||(v!==''&&v!==null&&(!['number','string'].includes(typeof v)||!Number.isFinite(Number(v))||Number(v)<0)))throw new Error('Invalid raw score.');
        }
      }
    }
    for(const key of ['otherGrades','attendance','comments','subjectConfig']){
      if(cls[key]===undefined)cls[key]={};
      if(!record(cls[key]))throw new Error('Invalid '+key+' data.');
    }
    for(const key of ['otherGrades','attendance','comments'])for(const [sid,value] of Object.entries(cls[key])){
      if(!safeId.test(sid)||!record(value))throw new Error('Invalid learner '+key+' record.');
      for(const [field,entry] of Object.entries(value)){
        if(key==='comments'){if(typeof entry!=='string')throw new Error('Invalid learner comment.');continue;}
        if(!record(entry))throw new Error('Invalid '+key+' entry.');
        for(const v of Object.values(entry))if(v!==''&&v!==null&&(!['number','string'].includes(typeof v)||!Number.isFinite(Number(v))))throw new Error('Invalid '+key+' value.');
      }
    }
  }
  if(copy.settings!==undefined&&!record(copy.settings))throw new Error('Invalid settings.');
  if(copy.settings)for(const key of ['welcome','teacherProfile']){
    if(copy.settings[key]!==undefined&&!record(copy.settings[key]))throw new Error('Invalid '+key+' settings.');
  }
  if(copy._persistence!==undefined&&!record(copy._persistence))throw new Error('Invalid save metadata.');
  if(copy.settings&&record(copy.settings.welcome))delete copy.settings.welcome.skipStartup;
  if(!copy.activeId)copy.activeId=Object.keys(copy.classes)[0];
  return copy;
}

if(typeof module==='object'&&module.exports)module.exports={validateBackupForImport};else root.KlasState={validateBackupForImport};
})(typeof globalThis!=='undefined'?globalThis:this);
