import assert from "node:assert/strict";
import {chromium} from "playwright";

const base=new URL(process.env.QA_BASE||"");
if(base.protocol!=="http:"||base.hostname!=="127.0.0.1"||!base.port||
  base.username||base.password||base.search||base.hash){
  throw new Error("Browser QA target must be the exact loopback origin");
}
const credentials={
  username:process.env.QA_GATE_USER||"",
  password:process.env.QA_GATE_PASSWORD||"",
  origin:base.origin,
  send:"always",
};
const accounts={
  buyer:"qa_buyer_a",
  seller:"qa_seller",
  admin:"qa_admin",
  password:process.env.QA_TEST_PASSWORD||"",
  otherUnit:process.env.QA_OTHER_UNIT_ID||"",
};
if(credentials.username.length<4||credentials.password.length<20||
  accounts.password.length<16||!/^[1-9]\d*$/.test(accounts.otherUnit)){
  throw new Error("Synthetic browser QA credentials and fixtures are required");
}

const blockedExternal=[];
const blockedWrites=[];
const requestRecords=[];
const consoleErrors=[];
const consoleErrorDetails=[];
const pageErrors=[];
const failedRequests=[];
const websocketAttempts=[];
const blockedWebSockets=[];
const apiStatuses=[];
const failedResponses=[];
const loginRedirects=[];

function safeLocalPath(value){
  try{
    const url=new URL(value);
    return url.origin===base.origin?url.pathname:"<non-local>";
  }catch{return "<unknown>";}
}

function installRequestGuards(context){
  context.route("**/*",async(route)=>{
    const request=route.request();
    const url=new URL(request.url());
    if(url.protocol==="data:"||url.protocol==="blob:"){
      await route.continue();
      return;
    }
    if(url.origin!==base.origin){
      blockedExternal.push({
        host:url.hostname,
        scheme:url.protocol,
        method:request.method(),
        type:request.resourceType(),
      });
      await route.abort("blockedbyclient");
      return;
    }
    if(url.pathname.startsWith("/api/push/")){
      blockedWrites.push({path:url.pathname,method:request.method(),reason:"push-disabled"});
      await route.fulfill({
        status:403,
        contentType:"application/json",
        body:'{"error":"disabled in QA"}',
      });
      return;
    }
    if(!["GET","HEAD"].includes(request.method())&&
      !["/api/auth/login","/api/auth/logout"].includes(url.pathname)){
      blockedWrites.push({
        path:url.pathname,
        method:request.method(),
        reason:"mutation-disabled",
      });
      await route.fulfill({
        status:403,
        contentType:"application/json",
        body:'{"error":"mutations disabled in QA browser test"}',
      });
      return;
    }
    requestRecords.push({
      path:url.pathname,
      method:request.method(),
      type:request.resourceType(),
    });
    await route.continue();
  });
  context.routeWebSocket("**/*",async(websocket)=>{
    const url=new URL(websocket.url());
    websocketAttempts.push({host:url.hostname,scheme:url.protocol});
    if(url.protocol==="ws:"&&url.hostname==="127.0.0.1"&&url.port===base.port){
      const server=websocket.connectToServer();
      websocket.onMessage((message)=>server.send(message));
      server.onMessage((message)=>websocket.send(message));
      return;
    }
    blockedWebSockets.push({host:url.hostname,scheme:url.protocol});
    await websocket.close({code:1008,reason:"non-loopback blocked"});
  });
}

async function login(page,username,redirect){
  const target=new URL(redirect,base);
  const loginPage=new URL("/login?redirect="+encodeURIComponent(redirect),base);
  await page.goto(loginPage.href,{waitUntil:"domcontentloaded"});
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[type="password"]').fill(accounts.password);
  const responseWait=page.waitForResponse((response)=>
    new URL(response.url()).pathname==="/api/auth/login");
  await page.locator('button[type="submit"]').click();
  const response=await responseWait;
  assert.equal(response.status(),200,`${username} UI login`);
  await page.waitForURL((url)=>url.pathname===target.pathname,{timeout:10000});
  const actual=new URL(page.url());
  assert.equal(actual.pathname,target.pathname,`${username} safe VIP redirect`);
  loginRedirects.push({account:username,requested:target.pathname,actual:actual.pathname});
}

async function logout(page){
  const trigger=page.locator(
    'button:has(div[class*="bg-gradient-to-br"][class*="rounded-full"]):visible',
  ).first();
  await trigger.click();
  const responseWait=page.waitForResponse((response)=>
    new URL(response.url()).pathname==="/api/auth/logout");
  await page.getByRole("menuitem",{name:/sign out|logout/i}).click();
  const response=await responseWait;
  assert.equal(response.status(),200,"UI logout");
  return page.evaluate(async()=>{
    const response=await fetch("/api/auth/me",{credentials:"include",cache:"no-store"});
    return response.status;
  });
}

const browser=await chromium.launch({
  headless:true,
  executablePath:process.env.CHROMIUM_PATH,
  args:[
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-extensions",
    "--no-first-run",
    "--disable-dns-prefetch",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  ],
});
let result;
try{
  const guest=await browser.newContext({serviceWorkers:"block"});
  installRequestGuards(guest);
  const guestPage=await guest.newPage();
  const guestResponse=await guestPage.goto(new URL("/vip",base).href,{
    waitUntil:"domcontentloaded",
    timeout:10000,
  });
  assert.equal(guestResponse?.status(),401,"guest without Basic Auth");
  await guest.close();

  const context=await browser.newContext({
    httpCredentials:credentials,
    serviceWorkers:"block",
    ignoreHTTPSErrors:false,
  });
  installRequestGuards(context);
  await context.addInitScript(()=>{
    const violations=[];
    Object.defineProperty(window,"__qaCspViolations",{value:violations});
    window.addEventListener("securitypolicyviolation",(event)=>{
      const blocked=event.blockedURI==="inline"?"inline":
        event.blockedURI.startsWith("http")?"network":
        event.blockedURI.startsWith("data")?"data":event.blockedURI||"none";
      violations.push({directive:event.violatedDirective,blocked});
    });
  });
  context.on("response",(response)=>{
    const url=new URL(response.url());
    if(url.origin===base.origin){
      if(url.pathname.startsWith("/api/")){
        apiStatuses.push({path:url.pathname,status:response.status()});
      }
      if(response.status()>=400){
        failedResponses.push({
          path:url.pathname.replace(/\d+/g,":id"),
          status:response.status(),
          type:response.request().resourceType(),
        });
      }
    }
  });
  await context.grantPermissions([],{origin:base.origin});
  const page=await context.newPage();
  page.setDefaultTimeout(7000);
  page.setDefaultNavigationTimeout(10000);
  page.on("console",(message)=>{
    if(message.type()==="error"){
      const text=message.text().toLowerCase();
      const category=text.includes("failed to load resource")?"resource-load":
        text.includes("content security policy")?"csp":
        /\b401\b/.test(text)?"http-401":
        /\b404\b/.test(text)?"http-404":
        text.includes("net::err")?"network":
        text.includes("failed to fetch")?"fetch":"other";
      consoleErrors.push(category);
      consoleErrorDetails.push({
        category,
        source:safeLocalPath(message.location().url||""),
        line:message.location().lineNumber||0,
        message:message.text().split("\n")[0].slice(0,180)
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"<email>")
          .replace(/\bqa_[a-z0-9_]+\b/gi,"<qa-user>")
          .replace(/https?:\/\/[^\s"'<>]+/gi,"<url>")
          .replace(/\b(password|token|cookie|authorization)\s*[:=]\s*\S+/gi,"$1=<redacted>"),
      });
    }
  });
  page.on("requestfailed",(request)=>{
    const url=new URL(request.url());
    failedRequests.push({
      path:url.origin===base.origin?url.pathname:"<non-local>",
      type:request.resourceType(),
      failureClass:(request.failure()?.errorText||"").toLowerCase().includes("blocked")
        ?"blocked"
        :(request.failure()?.errorText||"").toLowerCase().includes("aborted")
          ?"aborted"
          :"request-failed",
    });
  });
  page.on("pageerror",()=>pageErrors.push("page-error"));

  const initial=await page.goto(new URL("/vip",base).href,{waitUntil:"domcontentloaded"});
  assert.equal(initial?.status(),200,"Basic-authenticated VIP page");
  const csp=initial?.headers()["content-security-policy"]||"";
  assert.match(csp,/frame-src[^;]*'none'/);
  assert.match(csp,/connect-src[^;]*'self'/);
  assert.match(csp,/font-src[^;]*'self'/);
  assert.equal(await page.evaluate(async()=>
    (await navigator.serviceWorker.getRegistrations()).length),0);

  await page.getByText(/sign in to see your private file/i).waitFor();
  await login(page,accounts.buyer,"/vip");
  await page.getByText("Synthetic QA Project",{exact:true}).first().waitFor();
  assert.equal(await page.getByText("qa_buyer_b@fixture.test",{exact:true}).count(),0);
  const buyerVisible=await page.getByText("Synthetic QA Project",{exact:true}).count();

  await page.goto(new URL("/admin/vip",base).href,{waitUntil:"domcontentloaded"});
  await page.getByText(/reserved for Kinglike Luxury administrators/i).waitFor();
  const buyerAdminCalls=requestRecords.filter((request)=>
    request.path==="/api/admin/vip/overview").length;
  assert.equal(buyerAdminCalls,0,"buyer route does not request admin overview");

  const buyerLogout=await logout(page);
  assert.equal(buyerLogout,401);
  await login(page,accounts.seller,"/vip/sales");
  await page.getByRole("heading",{name:/My clients/i}).waitFor();
  await page.getByRole("heading",{name:/Synthetic QA Project.*QA-A/}).waitFor();
  assert.equal(await page.getByText("qa_buyer_b@fixture.test",{exact:true}).count(),0);
  await page.goto(new URL("/vip",base).href,{waitUntil:"domcontentloaded"});
  await page.getByText(/No property is linked to your account yet/i).waitFor();
  assert.equal(await page.getByText("Synthetic QA Project",{exact:true}).count(),0,
    "buyer VIP cache/data cleared on identity switch");
  await page.goto(new URL("/admin/vip",base).href,{waitUntil:"domcontentloaded"});
  await page.getByText(/reserved for Kinglike Luxury administrators/i).waitFor();
  const sellerAdminCalls=requestRecords.filter((request)=>
    request.path==="/api/admin/vip/overview").length;

  const sellerLogout=await logout(page);
  assert.equal(sellerLogout,401);
  await login(page,accounts.admin,"/admin/vip");
  await page.getByRole("heading",{name:/KINGLIKE VIP administration/i}).waitFor();
  await page.waitForFunction(()=>document.body.innerText.includes("KINGLIKE VIP administration"));
  const adminProjectRows=await page.getByText("Synthetic QA Project",{exact:true}).count();
  const adminOverviewStatus=apiStatuses.findLast((item)=>
    item.path==="/api/admin/vip/overview")?.status??null;
  assert.equal(adminOverviewStatus,200,"admin overview API");
  const adminLogout=await logout(page);
  assert.equal(adminLogout,401,"admin logout invalidates its session");

  const loadedFonts=await page.evaluate(async()=>{
    await document.fonts.ready;
    await document.fonts.load("16px Tajawal","سلام");
    return [...document.fonts].filter((font)=>font.status==="loaded").map((font)=>font.family);
  });
  const iframeCount=page.frames().length-1;
  assert.equal(iframeCount,0,"CSP denies embedded frames");
  const cspViolations=await page.evaluate(()=>window.__qaCspViolations||[]);
  const expectedFailedResponses=failedResponses.filter((item)=>
    (item.path==="/api/auth/me"&&item.status===401)||
    (item.path==="/api/notifications"&&item.status===401)||
    (item.path==="/sw.js"&&item.status===404));
  const unexpectedFailedResponses=failedResponses.filter((item)=>
    !((item.path==="/api/auth/me"&&item.status===401)||
      (item.path==="/api/notifications"&&item.status===401)||
      (item.path==="/sw.js"&&item.status===404)));

  const qaSafetyPassed=pageErrors.length===0&&cspViolations.length===0&&
    blockedExternal.length===0&&blockedWebSockets.length===0;
  result={
    guestVip:guestResponse.status(),
    buyerProjectVisible:buyerVisible,
    buyerAdminOverviewCalls:buyerAdminCalls,
     sellerAdminOverviewCalls:sellerAdminCalls,
    adminOverviewStatus,
    buyerLogout,
    sellerLogout,
     adminLogout,
    sellerAssignedProject:true,
    sellerDoesNotSeeOtherBuyer:true,
    identitySwitchClearsBuyerVipData:true,
    adminOverviewVisible:true,
    adminProjectRows,
    serviceWorkerRegistrations:0,
    iframeCount,
    loadedFontFamilies:[...new Set(loadedFonts)].slice(0,8),
    externalHttpAttemptsBlocked:blockedExternal.length,
    blockedExternalHosts:[...new Set(blockedExternal.map((item)=>item.host))],
    websocketAttempts:websocketAttempts.length,
    blockedExternalWebSockets:blockedWebSockets.length,
    blockedExternalWebSocketHosts:[...new Set(blockedWebSockets.map((item)=>item.host))],
    nonAuthWritesBlocked:blockedWrites.filter((item)=>item.reason==="mutation-disabled").length,
    pushRequestsBlocked:blockedWrites.filter((item)=>item.reason==="push-disabled").length,
    cspApplied:true,
    cspViolations,
     loginRedirects,
    pageErrors:pageErrors.length,
    consoleErrors:consoleErrors.length,
    consoleErrorCategories:Object.fromEntries(
      [...new Set(consoleErrors)].map((category)=>[
        category,consoleErrors.filter((item)=>item===category).length,
      ]),
    ),
     consoleErrorDetails,
    apiErrors:apiStatuses.filter((item)=>item.status>=400)
      .map((item)=>({path:item.path.replace(/\d+/g,":id"),status:item.status})),
     expectedFailedResponses,
     unexpectedFailedResponses,
    failedResponses,
     failedRequests,
     status:qaSafetyPassed?"passed":"review",
  };
  console.log(JSON.stringify(result));
  if(!qaSafetyPassed)process.exitCode=1;
  await context.close();
}finally{
  await browser.close();
}
