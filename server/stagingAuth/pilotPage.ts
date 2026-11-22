import { randomBytes } from "node:crypto";
import type { Express } from "express";

const HTML = String.raw`<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Kinglike WhatsApp | Staging</title>
<style nonce="__NONCE__">
:root{color-scheme:dark;font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:#081720;color:#effbfc}
*{box-sizing:border-box}body{margin:0;min-height:100vh;padding:28px 14px;display:grid;place-items:center}
main{width:min(100%,520px);background:#0e2835;border:1px solid #285267;border-radius:18px;padding:25px;box-shadow:0 14px 45px #0005}
header{border-bottom:1px solid #265065;padding-bottom:18px;margin-bottom:18px}
h1{font-size:1.35rem;margin:0 0 7px;color:#63dfd7}h2{font-size:1.1rem;margin:20px 0 10px}p{line-height:1.65;color:#c5dce5;margin:10px 0}.tag{font-size:.76rem;letter-spacing:.06em;color:#d7ebf3}
label{display:block;margin-top:16px;font-size:.92rem}input{width:100%;margin-top:8px;border:1px solid #427083;border-radius:10px;padding:13px;background:#071b26;color:#fff;font:inherit}
button{margin-top:18px;background:#3bcac4;color:#062832;border:0;border-radius:10px;padding:13px 18px;font:inherit;font-weight:700;cursor:pointer;width:100%}
button:disabled{opacity:.6;cursor:wait}.secondary{color:#dbeef2;background:#204658;border:1px solid #43768a}.status{padding:12px;border-radius:10px;background:#173743;border:1px solid #3d697a;margin:12px 0;font-size:.92rem}
.good{border-color:#3bcac4}.warning{border-color:#d69d59}
small{color:#a3c4d2}.hidden,[hidden]{display:none!important}
a{color:#72e8e2}.items{padding:0;margin:15px 0;list-style:none}.items li{border-bottom:1px solid #274e5b;padding:11px 0;display:flex;justify-content:space-between;gap:12px}
.value{direction:ltr;white-space:nowrap}
</style>
</head>
<body>
<main>
<header>
<div class="tag">KINGLIKE LUXURY · ISOLATED STAGING</div>
<h1>بوابة واتساب التجريبية</h1>
<p>هذه بوابة اختبار محمية، ولا تُجري أي ربط مع Meta أو تحفظ رسائل عملاء.</p>
</header>
<div id="feedback" class="status" role="status" aria-live="polite">جارٍ فحص الجلسة…</div>
<section id="loginPanel" hidden>
<h2>تسجيل الدخول</h2>
<form id="loginForm">
<label for="username">البريد الإلكتروني المصرّح له</label>
<input id="username" name="username" type="email" autocomplete="username" required maxlength="200">
<label for="password">كلمة المرور</label>
<input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024">
<button id="loginButton" type="submit">دخول آمن</button>
</form>
<p><small>استخدم حساب Staging الموثّق للموظف أو المالك. لا تُدخل كلمة المرور في المحادثة.</small></p>
</section>
<section id="dashboard" hidden>
<h2>حالة التجربة</h2>
<p id="identity"></p>
<ul id="checks" class="items"></ul>
<div class="status warning">لن يبدأ ربط WhatsApp Business هنا قبل اجتياز متطلبات Meta وموافقة المالك وشروط حفظ الرسائل.</div>
<button id="refreshButton" class="secondary" type="button">تحديث الحالة</button>
<button id="logoutButton" class="secondary" type="button">تسجيل الخروج</button>
</section>
</main>
<script nonce="__NONCE__">
"use strict";
const $ = (id) => document.getElementById(id);
const label = (message) => { $("feedback").textContent = message; };
async function json(url, init) {
  const res = await fetch(url, {credentials:"same-origin",cache:"no-store",...init});
  let data = {};
  try { data = await res.json(); } catch {}
  return {status:res.status,data};
}
function showLogin(){ $("loginPanel").hidden=false; $("dashboard").hidden=true; }
function showDashboard(){ $("loginPanel").hidden=true; $("dashboard").hidden=false; }
function addCheck(name,value){
  const item=document.createElement("li"),n=document.createElement("span"),v=document.createElement("strong");
  n.textContent=name;v.textContent=value;v.className="value";
  item.append(n,v);$("checks").append(item);
}
async function refresh(){
  label("جارٍ التحقق من صلاحية الجلسة…");
  try {
    const session=await json("/api/staging/identity/session");
    if(session.status===401){showLogin();label("سجّل الدخول بحساب Staging المصرّح.");return;}
    if(session.status!==200){showLogin();label("تعذّر التحقق من جلسة Staging. حاول لاحقًا.");return;}
    showDashboard();
    const role=session.data.role;
    $("identity").textContent="الحساب: "+String(session.data.username||"مصرح")+" · الدور: "+String(role||"غير معروف");
    const path=role==="crm_employee" ?
      "/api/employee/whatsapp-number-preapproval/readiness" :
      role==="owner_approver" ? "/api/admin/whatsapp-number-preapproval/readiness" : null;
    $("checks").replaceChildren();
    addCheck("الهوية","موثّقة");
    if(path){
      const r=await json(path);
      if(r.status===200){
        addCheck("فحص طلب الرقم",r.data.numberPreapprovalReady?"READY":"BLOCKED");
        addCheck("صلاحية الحساب",role==="crm_employee"?
          (r.data.employeeNumberRequestReady?"READY":"BLOCKED"):
          (r.data.ownerNumberReviewReady?"READY":"BLOCKED"));
      }else{addCheck("خدمة أرقام واتساب","غير متاحة أو غير مصرح");}
    }else{addCheck("صلاحيات التجربة","محدودة");}
    addCheck("ربط Meta الفعلي","غير مفعّل");
    label("تم التحقق من الجلسة دون ربط Meta أو تعديل بيانات.");
  }catch{showLogin();label("تعذر الاتصال بالخادم التجريبي.");}
}
$("loginForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const button=$("loginButton");button.disabled=true;
  try{
    const result=await json("/api/staging/identity/login",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username:$("username").value.trim(),password:$("password").value})
    });
    $("password").value="";
    if(result.status===200){await refresh();}
    else{label("لم ينجح تسجيل الدخول. تأكد من حساب Staging أو حاول لاحقًا.");}
  }catch{label("تعذّر الوصول إلى خدمة تسجيل الدخول.");}
  finally{button.disabled=false;}
});
$("refreshButton").addEventListener("click",refresh);
$("logoutButton").addEventListener("click",async()=>{
  try{await json("/api/staging/identity/logout",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});}catch{}
  showLogin();label("تم إنهاء الجلسة.");$("password").value="";
});
refresh();
</script>
</body></html>`;

/**
 * Read-only, same-origin pilot interface. No Meta SDK, OAuth trigger, client
 * tokens, customer data, or archive controls are delivered by this page.
 */
export function registerStagingPilotPage(app: Express): void {
  app.get("/staging/whatsapp-pilot", (_req, res) => {
    const nonce = randomBytes(18).toString("base64");
    res.setHeader("Content-Security-Policy",
      "default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; " +
      "script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; connect-src 'self'");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).type("html").send(HTML.replaceAll("__NONCE__", nonce));
  });
}
