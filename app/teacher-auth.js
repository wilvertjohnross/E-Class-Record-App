(()=>{"use strict";
const ENDPOINT="https://fldwqkmadsyrbslxunvi.supabase.co/functions/v1/teacher-auth";
const RECOVERY="https://fldwqkmadsyrbslxunvi.supabase.co/functions/v1/teacher-auth-recovery";
const KEY="klas.teacher.session";
let mode="login";
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
async function post(url,body){const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"Unable to connect to KLAS.");return d}
function pass(label,id,ac="current-password"){return '<label for="'+id+'">'+label+'</label><div class="klas-password-wrap"><input id="'+id+'" type="password" autocomplete="'+ac+'" required><button class="klas-eye" type="button" data-eye="'+id+'" aria-label="Show password" title="Show password">◉</button></div>'}
function render(){
 const p=document.getElementById("klas-auth-panel");if(!p)return;
 if(mode==="login")p.innerHTML='<h2>Teacher Sign In</h2><p class="hint">Use your verified DepEd email and KLAS password.</p><form id="klas-auth-form"><label>DepEd Email</label><input id="ta-email" type="email" autocomplete="username" placeholder="name@deped.gov.ph" required>'+pass("Password","ta-password")+'<button class="klas-auth-primary">Sign In</button></form><div id="ta-msg"></div><div class="klas-auth-links"><button class="klas-auth-link" data-mode="register">Create Teacher Account</button><button class="klas-auth-link" data-mode="recover">Forgot Password?</button></div>';
 if(mode==="register")p.innerHTML='<h2>Create Teacher Account</h2><p class="hint">Verify your official DepEd email, then create your private KLAS password.</p><form id="klas-auth-form"><label>DepEd Email</label><input id="ta-email" type="email" placeholder="name@deped.gov.ph" required><div id="verify-fields" hidden><label>Verification Code</label><input id="ta-code" maxlength="8" autocomplete="one-time-code">'+pass("Create Password","ta-password","new-password")+pass("Confirm Password","ta-confirm","new-password")+'</div><button class="klas-auth-primary" id="ta-register-button">Send Verification Code</button></form><div id="ta-msg"></div><div class="klas-auth-links"><button class="klas-auth-link" data-mode="login">Back to Sign In</button></div>';
 if(mode==="recover")p.innerHTML='<h2>Reset Teacher Password</h2><p class="hint">KLAS will send a one-time reset code to your verified DepEd mailbox.</p><form id="klas-auth-form"><label>DepEd Email</label><input id="ta-email" type="email" placeholder="name@deped.gov.ph" required><div id="verify-fields" hidden><label>Reset Code</label><input id="ta-code" maxlength="10" autocomplete="one-time-code">'+pass("New Password","ta-password","new-password")+pass("Confirm Password","ta-confirm","new-password")+'</div><button class="klas-auth-primary" id="ta-register-button">Send Reset Code</button></form><div id="ta-msg"></div><div class="klas-auth-links"><button class="klas-auth-link" data-mode="login">Back to Sign In</button></div>';
 bind();
}
function msg(t,error=false){const e=document.getElementById("ta-msg");if(e)e.innerHTML='<div class="klas-auth-message'+(error?" error":"")+'">'+esc(t)+'</div>'}
function bind(){
 document.querySelectorAll("[data-mode]").forEach(b=>b.onclick=()=>{mode=b.dataset.mode;render()});
 document.querySelectorAll("[data-eye]").forEach(b=>b.onclick=()=>{const i=document.getElementById(b.dataset.eye),show=i.type==="password";i.type=show?"text":"password";b.textContent=show?"◌":"◉";b.setAttribute("aria-label",show?"Hide password":"Show password");b.title=show?"Hide password":"Show password"});
 const f=document.getElementById("klas-auth-form");if(f)f.onsubmit=submit;
}
async function submit(e){e.preventDefault();const email=document.getElementById("ta-email")?.value.trim().toLowerCase(),password=document.getElementById("ta-password")?.value||"",confirm=document.getElementById("ta-confirm")?.value||"",code=document.getElementById("ta-code")?.value.trim().toUpperCase()||"",fields=document.getElementById("verify-fields"),button=document.getElementById("ta-register-button");
 try{
  if(mode==="login"){const d=await post(ENDPOINT,{action:"login",email,password});localStorage.setItem(KEY,JSON.stringify({session:d.session,user:d.user,memberships:d.memberships,savedAt:Date.now()}));openApp(d.user);return}
  if(fields?.hidden){button.disabled=true;const d=await post(mode==="register"?ENDPOINT:RECOVERY,{action:mode==="register"?"register":"request",email});fields.hidden=false;button.textContent=mode==="register"?"Verify & Create Account":"Reset Password";msg(d.message||"Check your DepEd mailbox for the verification code.");button.disabled=false;return}
  if(password!==confirm){msg("Passwords do not match.",true);return}
  if(mode==="register"){const d=await post(ENDPOINT,{action:"verify",email,code,password});localStorage.setItem(KEY,JSON.stringify({session:d.session,user:d.user,memberships:[],savedAt:Date.now()}));openApp(d.user)}
  else{const d=await post(RECOVERY,{action:"complete",email,code,newPassword:password});msg(d.message||"Password changed.");setTimeout(()=>{mode="login";render()},900)}
 }catch(x){msg(x.message||"Unable to complete the request.",true);if(button)button.disabled=false}
}
function openApp(user){document.getElementById("klas-auth-gate").hidden=true;let b=document.getElementById("klas-auth-user");if(!b){b=document.createElement("button");b.id="klas-auth-user";b.className="klas-auth-user";document.body.appendChild(b)}b.textContent=(user?.displayName||user?.email||"Teacher")+" · Sign out";b.onclick=()=>{localStorage.removeItem(KEY);location.reload()}}
function init(){const gate=document.createElement("div");gate.id="klas-auth-gate";gate.innerHTML='<div class="klas-auth-shell"><section class="klas-auth-brand"><img src="assets/klas-banner.png" alt="KLAS"><p>School, connected.<br>Secure Teacher access using your verified DepEd identity.</p></section><section class="klas-auth-panel" id="klas-auth-panel"></section></div>';document.body.appendChild(gate);let saved=null;try{saved=JSON.parse(localStorage.getItem(KEY)||"null")}catch{}if(saved?.session?.access_token&&saved?.user){openApp(saved.user)}else render()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();