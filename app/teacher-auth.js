(()=>{"use strict";
const ENDPOINT="https://fldwqkmadsyrbslxunvi.supabase.co/functions/v1/teacher-auth";
const RECOVERY="https://fldwqkmadsyrbslxunvi.supabase.co/functions/v1/teacher-auth-recovery";
const SUPABASE_KEY="sb_publishable_SIcfjo1FVwIhiJT2-Uy1iw_-P1mkZoz";
const KEY="klas.teacher.session";
let mode="login",busy=false;
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
async function post(url,body){
 let r;
 try{r=await fetch(url,{method:"POST",headers:{"content-type":"application/json","apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY},body:JSON.stringify(body)})}
 catch(err){throw new Error("KLAS could not reach the authentication service. Check your internet connection and try again.")}
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(d.error||"Unable to complete the request.");
 return d;
}
function eye(id){return '<button class="klas-eye" type="button" data-eye="'+id+'" aria-label="Show password" title="Show password"><span aria-hidden="true">Show</span></button>'}
function pass(label,id,ac="current-password",disabled=false){return '<label for="'+id+'">'+label+'</label><div class="klas-password-wrap"><input id="'+id+'" type="password" autocomplete="'+ac+'" required'+(disabled?' disabled':'')+'>'+eye(id)+'</div>'}
function intro(title,text){return '<div class="klas-auth-heading"><span class="klas-auth-kicker">KLAS TEACHER</span><h2>'+title+'</h2><p class="hint">'+text+'</p></div>'}
function render(){
 const p=document.getElementById("klas-auth-panel");if(!p)return;
 if(mode==="login")p.innerHTML=intro("Welcome back","Sign in using your verified DepEd email and private KLAS password.")+'<form id="klas-auth-form"><label for="ta-email">DepEd Email</label><input id="ta-email" type="email" autocomplete="username" inputmode="email" placeholder="name@deped.gov.ph" required>'+pass("Password","ta-password")+'<button class="klas-auth-primary" id="ta-submit" type="submit">Sign In</button></form><div id="ta-msg" aria-live="polite"></div><div class="klas-auth-links"><button class="klas-auth-link" type="button" data-mode="register">Create Teacher Account</button><button class="klas-auth-link" type="button" data-mode="recover">Forgot Password?</button></div>';
 if(mode==="register")p.innerHTML=intro("Create Teacher Account","Verify your official DepEd email, then create your private KLAS password.")+'<form id="klas-auth-form"><label for="ta-email">DepEd Email</label><input id="ta-email" type="email" autocomplete="username" inputmode="email" placeholder="name@deped.gov.ph" required><div class="klas-auth-note">KLAS uses your official DepEd mailbox only to verify your Teacher identity.</div><div id="verify-fields" hidden><label for="ta-code">Verification Code</label><input id="ta-code" class="klas-code" maxlength="8" autocomplete="one-time-code" spellcheck="false" placeholder="8-character code" disabled>'+pass("Create Password","ta-password","new-password",true)+pass("Confirm Password","ta-confirm","new-password",true)+'<p class="klas-password-rule">Use at least 12 characters with uppercase, lowercase, a number, and a symbol.</p></div><button class="klas-auth-primary" id="ta-submit" type="submit">Send Verification Code</button></form><div id="ta-msg" aria-live="polite"></div><div class="klas-auth-links single"><button class="klas-auth-link" type="button" data-mode="login">Back to Sign In</button></div>';
 if(mode==="recover")p.innerHTML=intro("Reset Teacher Password","Receive a one-time reset code through your verified DepEd mailbox.")+'<form id="klas-auth-form"><label for="ta-email">DepEd Email</label><input id="ta-email" type="email" autocomplete="username" inputmode="email" placeholder="name@deped.gov.ph" required><div id="verify-fields" hidden><label for="ta-code">Reset Code</label><input id="ta-code" class="klas-code" maxlength="10" autocomplete="one-time-code" spellcheck="false" placeholder="10-character code" disabled>'+pass("New Password","ta-password","new-password",true)+pass("Confirm Password","ta-confirm","new-password",true)+'<p class="klas-password-rule">Use at least 12 characters with uppercase, lowercase, a number, and a symbol.</p></div><button class="klas-auth-primary" id="ta-submit" type="submit">Send Reset Code</button></form><div id="ta-msg" aria-live="polite"></div><div class="klas-auth-links single"><button class="klas-auth-link" type="button" data-mode="login">Back to Sign In</button></div>';
 bind();
}
function msg(t,error=false){const e=document.getElementById("ta-msg");if(e)e.innerHTML=t?'<div class="klas-auth-message'+(error?" error":"")+'">'+esc(t)+'</div>':""}
function setBusy(on,label){busy=on;const b=document.getElementById("ta-submit");if(!b)return;if(on){b.dataset.label=b.textContent;b.disabled=true;b.innerHTML='<span class="klas-spinner" aria-hidden="true"></span>'+esc(label)}else{b.disabled=false;b.textContent=b.dataset.label||b.textContent}}
function bind(){
 document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{if(busy)return;mode=b.dataset.mode;render()});
 document.querySelectorAll("[data-eye]").forEach(b=>b.onclick=()=>{const i=document.getElementById(b.dataset.eye);if(!i)return;const show=i.type==="password";i.type=show?"text":"password";b.querySelector("span").textContent=show?"Hide":"Show";b.setAttribute("aria-label",show?"Hide password":"Show password");b.title=show?"Hide password":"Show password"});
 const f=document.getElementById("klas-auth-form");if(f)f.onsubmit=submit;
}
async function submit(e){
 e.preventDefault();if(busy)return;
 const email=document.getElementById("ta-email")?.value.trim().toLowerCase()||"",password=document.getElementById("ta-password")?.value||"",confirm=document.getElementById("ta-confirm")?.value||"",code=document.getElementById("ta-code")?.value.trim().toUpperCase()||"",fields=document.getElementById("verify-fields");
 msg("");
 try{
  if(mode==="login"){setBusy(true,"Signing in...");const d=await post(ENDPOINT,{action:"login",email,password});localStorage.setItem(KEY,JSON.stringify({session:d.session,user:d.user,memberships:d.memberships||[],savedAt:Date.now()}));openApp(d.user);return}
  if(fields?.hidden){setBusy(true,mode==="register"?"Sending verification code...":"Sending reset code...");const d=await post(mode==="register"?ENDPOINT:RECOVERY,{action:mode==="register"?"register":"request",email});fields.querySelectorAll("input").forEach(i=>i.disabled=false);fields.hidden=false;const b=document.getElementById("ta-submit");if(b){b.dataset.label=mode==="register"?"Verify & Create Account":"Reset Password"}msg(d.message||"Check your DepEd mailbox for the code.");return}
  if(password!==confirm){msg("Passwords do not match.",true);return}
  if(mode==="register"){setBusy(true,"Creating account...");const d=await post(ENDPOINT,{action:"verify",email,code,password});localStorage.setItem(KEY,JSON.stringify({session:d.session,user:d.user,memberships:d.memberships||[],savedAt:Date.now()}));openApp(d.user);return}
  setBusy(true,"Resetting password...");const d=await post(RECOVERY,{action:"complete",email,code,newPassword:password});msg(d.message||"Password updated. You can now sign in.");setTimeout(()=>{mode="login";busy=false;render()},1300);return;
 }catch(x){msg(x.message||"Unable to complete the request.",true)}
 finally{if(document.getElementById("klas-auth-gate")&&!document.getElementById("klas-auth-gate").hidden)setBusy(false)}
}
function openApp(user){busy=false;document.getElementById("klas-auth-gate").hidden=true;let b=document.getElementById("klas-auth-user");if(!b){b=document.createElement("button");b.id="klas-auth-user";b.className="klas-auth-user";document.body.appendChild(b)}b.textContent=(user?.displayName||user?.email||"Teacher")+" · Sign out";b.onclick=()=>{localStorage.removeItem(KEY);location.reload()}}
function init(){const gate=document.createElement("div");gate.id="klas-auth-gate";gate.innerHTML='<img class="klas-auth-background" src="assets/welcome-classroom.png" alt=""><div class="klas-auth-wash"></div><div class="klas-auth-shell"><section class="klas-auth-brand"><img class="klas-auth-banner" src="assets/klas-banner.png" alt="KLAS"><div class="klas-auth-brand-copy"><span class="klas-auth-eyebrow">THE ONE PLACE FOR EVERY KLAS</span><h1>Empowering teachers.<br>Connecting every classroom.</h1><p>Secure access to your KLAS Teacher workspace using your verified DepEd identity.</p><div class="klas-auth-values"><span>Learn</span><span>Plan</span><span>Assess</span><span>Inspire</span></div></div></section><section class="klas-auth-panel" id="klas-auth-panel"></section></div>';document.body.appendChild(gate);render();requestAnimationFrame(()=>{const p=document.getElementById("klas-auth-panel");if(p&&!p.children.length)render()});let saved=null;try{saved=JSON.parse(localStorage.getItem(KEY)||"null")}catch{}if(saved?.session?.access_token&&saved?.user)openApp(saved.user)}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();