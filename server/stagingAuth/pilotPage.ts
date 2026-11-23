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
.checkrow{display:flex;align-items:flex-start;gap:10px;line-height:1.6;font-size:.92rem}
.checkrow input{width:22px;height:22px;flex-shrink:0;accent-color:#3bcac4;margin:3px 0 0}
.signup-actions{margin-top:18px}.signup-actions button{margin-top:10px}.signup-actions button:disabled{background:#526772;color:#b8cdd5;opacity:1;cursor:not-allowed;box-shadow:none}
.notice{font-size:.88rem;color:#a2bdc8;margin-top:12px}
</style>
</head>
<body>
<main>
<header>
<div class="tag">KINGLIKE LUXURY · ISOLATED STAGING</div>
<h1>بوابة واتساب التجريبية</h1>
<p>بوابة تجريبية محمية. لن يبدأ ربط Meta إلا بعد الموافقة واجتياز فحوص الأمان؛ وأرشفة الرسائل متوقفة.</p>
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
<section id="employeeSignup" hidden>
<h2>تجهيز تسجيل رقم WhatsApp Business</h2>
<div class="status" id="employeeSignupStatus" role="status">جارٍ فحص الموافقة السارية على رقمك…</div>
<p class="notice">هذه الخطوة مخصصة للموظف المعتمد. لا تحذف واتساب Business من الهاتف ولا تُجري عملية نقل الرقم إلى Cloud API بدل Coexistence.</p>
<label class="checkrow"><input id="employeeCoexAcknowledgement" type="checkbox"><span>أؤكد أنني أستخدم رقم العمل الموافق عليه، وأفهم أن تسجيل Coexistence يتطلب موافقتي داخل Meta، وأن الرسائل الواردة خلال مرحلة العزل قد لا تُحفظ.</span></label>
<div class="signup-actions">
<button id="prepareCoexistence" disabled type="button" title="لا يُتاح حتى تصبح جميع فحوص Meta وWebhook جاهزة">تجهيز جلسة Coexistence الآمنة</button>
<button id="launchMetaCoexistence" type="button" hidden>فتح نافذة Meta وربط WhatsApp Business</button>
</div>
<p id="signupOutcome" class="notice" aria-live="polite"></p>
</section>
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
// No Meta request or SDK load occurs until an authenticated employee, a current
// preapproval, all server gates and an explicit employee action are present.
let employeeApprovedRequest=null;
let employeeReadyForSignup=false;
let metaSession=null;
let metaCode=null;
let metaAssets=null;
let metaSubmitting=false;
let metaSessionTimer=null;
function result(message){ $("signupOutcome").textContent=message; }
function resetMetaSession(){
  metaSession=null;metaCode=null;metaAssets=null;metaSubmitting=false;
  if(metaSessionTimer){clearTimeout(metaSessionTimer);metaSessionTimer=null;}
  $("launchMetaCoexistence").hidden=true;
}
function updateEmployeeAction(){
  $("prepareCoexistence").disabled=!(
    employeeReadyForSignup&&employeeApprovedRequest&&
    $("employeeCoexAcknowledgement").checked
  );
}
async function loadMetaSdk(appId){
  if(!/^[0-9]{1,40}$/.test(appId))throw Error("invalid_app_id");
  if(!window.FB){
    await new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src="https://connect.facebook.net/en_US/sdk.js";
      script.async=true;
      script.crossOrigin="anonymous";
      script.onload=resolve;script.onerror=()=>reject(Error("sdk_unavailable"));
      document.head.appendChild(script);
    });
  }
  if(!window.FB||typeof window.FB.init!=="function")throw Error("sdk_unavailable");
  window.FB.init({appId:appId,cookie:false,xfbml:false,version:"v25.0"});
}
async function tryCompleteMetaSignup(){
  if(!metaSession||!metaCode||!metaAssets||metaSubmitting)return;
  metaSubmitting=true;
  result("جارٍ التحقق من الأصول التي أعادتها Meta على الخادم الآمن…");
  try{
    const answer=await json("/api/employee/whatsapp-coexistence/oauth/finish",{
      method:"POST",headers:{
        "Content-Type":"application/json",
        "X-CSRF-Token":metaSession.csrfToken
      },body:JSON.stringify({
        state:metaSession.state,
        code:metaCode,
        assets:metaAssets
      })
    });
    if(answer.status===200&&answer.data.status==="meta_verified_no_archive"){
      result("تم التحقق من رقم WhatsApp Business الحالي عبر Meta وتسجيل حالة التحقق في Kinglike. لا يوجد أرشفة أو حفظ للمحادثات، ولم يتم اعتماد الربط للأرشفة.");
    }else if(answer.status===200&&answer.data.status==="owner_approval_pending"){
      result("تم التحقق من أصول Meta. بانتظار اعتماد المالك النهائي؛ أرشفة الرسائل متوقفة.");
    }else if(answer.status===403&&answer.data.error==="signup_state_invalid"){
      result("انتهت مهلة التفويض الآمنة. قد يكون الاتصال تم لدى Meta، لكن Kinglike لم يتحقق منه. لا تفصل الرقم ولا تعِد مسح QR؛ راجع حالة الربط مع المالك.");
    }else{
      result("لم يكتمل التحقق الآمن لدى خادم Kinglike. قد يكون الحساب متصلاً في Meta فقط؛ لا نعتبر الرقم معتمداً أو الأرشفة مفعّلة.");
    }
  }catch{
    result("فشل التواصل الآمن أثناء التحقق؛ لا نعتبر الرقم مرتبطًا.");
  }finally{resetMetaSession();}
}
function metaMessageListener(event){
  if(!metaSession||event.origin!=="https://www.facebook.com")return;
  let body=event.data;
  if(typeof body==="string"){
    try{body=JSON.parse(body);}catch{return;}
  }
  if(!body||body.type!=="WA_EMBEDDED_SIGNUP")return;
  if(body.event==="CANCEL"){
    result("تم إلغاء العملية في Meta. لم يُطلب أي ربط.");
    resetMetaSession();return;
  }
  // Only an explicitly completed Business App onboarding is eligible.
  if(body.event==="FINISH"){
    result("ظهر مسار WhatsApp Cloud API العادي، وليس Coexistence المؤكد. توقّف دون متابعة.");
    resetMetaSession();return;
  }
  if(body.event!=="FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING")return;
  const data=body.data||{};
  const assets={
    businessId:String(data.business_id||""),
    wabaId:String(data.waba_id||""),
    phoneNumberId:String(data.phone_number_id||"")
  };
  if(!Object.values(assets).every(x=>/^[0-9]{1,40}$/.test(x))){
    result("لم تُعِد Meta جميع معرّفات الرقم الموثوقة؛ لن نكمل الربط.");
    resetMetaSession();return;
  }
  metaAssets=assets;
  void tryCompleteMetaSignup();
}
window.addEventListener("message",metaMessageListener);
$("employeeCoexAcknowledgement").addEventListener("change",updateEmployeeAction);
$("prepareCoexistence").addEventListener("click",async()=>{
  const button=$("prepareCoexistence");
  if(button.disabled||!employeeApprovedRequest||!employeeReadyForSignup)return;
  button.disabled=true;resetMetaSession();
  result("يتم التحقق من موافقة الرقم وإنشاء جلسة قصيرة محمية…");
  try{
    const [readiness,requests]=await Promise.all([
      json("/api/employee/whatsapp-coexistence/readiness"),
      json("/api/employee/whatsapp-number-preapproval")
    ]);
    const approved=(requests.data.requests||[]).find(x=>
      x.id===employeeApprovedRequest.id&&
      x.version===employeeApprovedRequest.version&&x.status==="approved"&&
      new Date(x.expiresAt).getTime()>Date.now()
    );
    if(readiness.status!==200||readiness.data.onboardingQuarantineReady!==true||
       readiness.data.oauthEnabled!==true||requests.status!==200||!approved){
      throw Error("readiness_blocked");
    }
    const csrf=await json("/api/employee/whatsapp-coexistence/oauth/start/csrf",{
      method:"POST",headers:{"Content-Type":"application/json"},body:"{}"
    });
    if(csrf.status!==200||typeof csrf.data.csrfToken!=="string")throw Error("csrf_blocked");
    const prepared=await json("/api/employee/whatsapp-coexistence/oauth/start",{
      method:"POST",headers:{
        "Content-Type":"application/json",
        "X-CSRF-Token":csrf.data.csrfToken
      },
      body:JSON.stringify({
        approvalId:approved.id,version:approved.version
      })
    });
    const conf=prepared.data.metaSignupConfig;
    if(prepared.status!==200||prepared.data.mode!=="approved_number_quarantine"||
       prepared.data.status!=="prepared_not_connected"||
       !conf||!/^[0-9]{1,40}$/.test(conf.appId)||
       !/^[0-9]{1,40}$/.test(conf.configId)||
       typeof prepared.data.state!=="string"||
       typeof prepared.data.csrfToken!=="string"){
      throw Error("signup_not_ready");
    }
    const ttlSeconds=prepared.data.expiresInSeconds;
    if(!Number.isInteger(ttlSeconds)||ttlSeconds<300||ttlSeconds>1800){
      throw Error("signup_ttl_invalid");
    }
    metaSession={
      state:prepared.data.state,csrfToken:prepared.data.csrfToken,
      configId:conf.configId,appId:conf.appId
    };
    await loadMetaSdk(conf.appId);
    metaSessionTimer=setTimeout(()=>{
      if(metaSession){
        resetMetaSession();
        result("انتهت مهلة الجلسة التجريبية، ولم يتم تسجيل ربط.");
      }
    },ttlSeconds*1000);
    $("launchMetaCoexistence").hidden=false;
    result("الجلسة جاهزة. اضغط «فتح نافذة Meta» إذا كنت الموظف المصرّح وتريد بدء التسجيل.");
  }catch{
    resetMetaSession();
    result("مسار التسجيل ما زال محجوبًا من الخادم. لا تغيير في واتساب Business.");
  }finally{updateEmployeeAction();}
});
$("launchMetaCoexistence").addEventListener("click",()=>{
  // Call FB.login directly within this click handler to avoid popup blocking.
  if(!metaSession||!window.FB||typeof window.FB.login!=="function"||
     !$("employeeCoexAcknowledgement").checked)return;
  $("launchMetaCoexistence").hidden=true;
  result("تحقق داخل Meta من ظهور خيار ربط WhatsApp Business الموجود. لا تتابع مسار نقل الرقم.");
  try{
    window.FB.login((response)=>{
      if(!metaSession)return;
      const code=response&&response.authResponse&&response.authResponse.code;
      if(typeof code==="string"&&code.length>=8&&code.length<=4096){
        metaCode=code;
        void tryCompleteMetaSignup();
      }else{
        result("لم يصل رمز تفويض صالح من Meta؛ لم يكتمل التسجيل.");
        resetMetaSession();
      }
    },{
      config_id:metaSession.configId,
      response_type:"code",
      override_default_response_type:true,
      extras:{setup:{},featureType:"whatsapp_business_app_onboarding",sessionInfoVersion:"3"}
    });
  }catch{
    result("تعذر فتح Meta، ولم يتم تسجيل أي ربط.");
    resetMetaSession();
  }
});

async function refresh(){
  employeeReadyForSignup=false;employeeApprovedRequest=null;
  $("employeeSignup").hidden=true;
  $("employeeCoexAcknowledgement").checked=false;
  resetMetaSession();
  label("جارٍ فحص حالة Staging…");
  try {
    const session=await json("/api/staging/identity/session");
    if(session.status===401){showLogin();label("سجّل الدخول بحساب Staging المصرّح.");return;}
    if(session.status!==200){showLogin();label("تعذّر التحقق من جلسة Staging.");return;}
    showDashboard();
    const role=session.data.role;
    $("identity").textContent="الحساب: "+String(session.data.username||"مصرّح")+" · الدور: "+String(role||"غير معروف");
    $("checks").replaceChildren();
    addCheck("هوية المستخدم","موثّقة");
    if(role==="owner_approver"){
      const r=await json("/api/admin/whatsapp-staging/system-readiness");
      if(r.status!==200){addCheck("الفحص الأمني","غير متاح");}
      else{
        const x=r.data;
        const ok=(value)=>value===true?"READY":"BLOCKED";
        addCheck("موافقة رقم الموظف",x.approvedEmployeeNumberPresent?"موجودة":"غير موجودة");
        addCheck("التحقق من الرقم لدى Meta",x.metaNumberVerified?"مكتمل":"لم يكتمل");
        addCheck("قاعدة تسجيل الرقم",ok(x.onboardingDatabaseReady));
        addCheck("عزل هوية Staging",ok(x.identityIsolationVerified));
        addCheck("حفظ رمز Meta مشفّرًا",ok(x.vaultReady));
        addCheck("تدقيق إعداد Meta",ok(x.metaConfigVerified));
        addCheck("تدقيق توقيع Webhook",ok(x.quarantineSignatureVerified));
        addCheck("صلاحيات الاعتماد النهائي للمالك",ok(x.ownerGrantReady));
        addCheck("HTTPS",ok(x.publicHttpsReady));
        addCheck("موافقة Webhook",ok(x.metaWebhookApproved));
        addCheck("الموافقة على تفعيل التجربة",ok(x.activationApproved));
        addCheck("جاهزية تسجيل Coexistence المعزول",ok(x.quarantineReady));
        addCheck("سياسة الأرشفة",ok(x.archivePolicyReady));
        addCheck("إثبات إشعار العميل",ok(x.customerNoticeVerified));
        addCheck("أرشفة الرسائل",x.messagesArchiveEnabled?"مفعّلة":"متوقفة");
      }
    }else if(role==="crm_employee"){
      $("employeeSignup").hidden=false;
      const [pre,requests,coex]=await Promise.all([
        json("/api/employee/whatsapp-number-preapproval/readiness"),
        json("/api/employee/whatsapp-number-preapproval"),
        json("/api/employee/whatsapp-coexistence/readiness")
      ]);
      if(pre.status===200){
        addCheck("تسجيل طلب الرقم",pre.data.numberPreapprovalReady?"READY":"BLOCKED");
        addCheck("صلاحية طلب الموظف",pre.data.employeeNumberRequestReady?"READY":"BLOCKED");
      }else{addCheck("تسجيل طلب الرقم","غير متاح");}
      if(requests.status===200&&Array.isArray(requests.data.requests)){
        const approved=requests.data.requests.some(x=>x.status==="approved"&&new Date(x.expiresAt).getTime()>Date.now());
        addCheck("الموافقة السارية على الرقم",approved?"موجودة":"غير متاحة");
      }else{addCheck("الموافقة السارية على الرقم","تعذر التحقق");}
      if(coex.status===200){
        addCheck("جاهزية بدء التسجيل",coex.data.onboardingQuarantineReady?"READY":"BLOCKED");
        addCheck("فحص إعداد Meta",coex.data.metaConfigVerified||"BLOCKED");
      }else{addCheck("حالة التسجيل","غير متاحة");}
      const approvals=requests.status===200&&Array.isArray(requests.data.requests)
        ?requests.data.requests.filter(x=>x.status==="approved"&&new Date(x.expiresAt).getTime()>Date.now())
        :[];
      employeeApprovedRequest=approvals.length===1?approvals[0]:null;
      employeeReadyForSignup=!!employeeApprovedRequest&&pre.status===200&&
        pre.data.employeeNumberRequestReady===true&&coex.status===200&&
        coex.data.onboardingQuarantineReady===true&&coex.data.oauthEnabled===true;
      $("employeeSignupStatus").textContent=employeeReadyForSignup
        ?"الموافقة سارية وخادم العزل جاهز. يلزم تأكيد الموظف قبل تجهيز الجلسة."
        :approvals.length===1
          ?"موافقة الرقم سارية. لا يمكن بدء Meta إلى حين اكتمال تدقيق الإعدادات وموافقات التشغيل."
          :"لا توجد موافقة واحدة سارية مرتبطة بحساب الموظف.";
      updateEmployeeAction();
      addCheck("ربط Meta الفعلي","لم يبدأ");
    }else{addCheck("صلاحية هذا الحساب","محدودة");}
    label("فحص قراءة فقط. لم يُنفذ تسجيل أو ربط أو أرشفة.");
  }catch{label("تعذّر الوصول إلى فحوص Staging.");}
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
  resetMetaSession();employeeReadyForSignup=false;employeeApprovedRequest=null;
  $("employeeSignup").hidden=true;
  showLogin();label("تم إنهاء الجلسة.");$("password").value="";
});
refresh();
</script>
</body></html>`;

/**
 * Same-origin employee Coexistence pilot; all Meta controls are gated by
 * authenticated, preapproved, server-side quarantine readiness. No Meta SDK
 * loads until an explicit employee click after readiness; archiving is disabled.
 */
export function registerStagingPilotPage(app: Express): void {
  app.get("/staging/whatsapp-pilot", (_req, res) => {
    const nonce = randomBytes(18).toString("base64");
    res.setHeader("Content-Security-Policy",
      "default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; " +
      "script-src 'nonce-" + nonce + "' https://connect.facebook.net; " +
      "style-src 'nonce-" + nonce + "'; connect-src 'self' https://www.facebook.com; " +
      "frame-src https://www.facebook.com https://web.facebook.com");
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).type("html").send(HTML.replaceAll("__NONCE__", nonce));
  });
}
