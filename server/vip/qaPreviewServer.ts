import express,{type Request,type Response,type NextFunction} from "express";
import session from "express-session";
import helmet from "helmet";
import bcrypt from "bcrypt";
import {resolve} from "node:path";
import {readFileSync} from "node:fs";
import {pool} from "./qaPreviewDb";
import {assertQaPreviewConfiguration,qaGateMatches} from "./qaPreviewRules";
import {registerVipRoutes} from "./registerVipRoutes";

/**
 * KINGLIKE VIP dedicated Railway QA entrypoint.
 *
 * This NEVER imports server/index.ts, server/routes.ts, Kay schedulers, CRM
 * mutations, WhatsApp jobs or Replit startup. It requires an entirely separate
 * Railway Postgres and a password gateway before it can start.
 *
 * Do NOT select this entrypoint for any existing live service.
 */
type ActiveUser={id:number;username:string;email:string|null;phone_number:string|null;
 auth_method:string|null;is_admin:boolean;role:string};
const publicUser=(u:ActiveUser)=>({
 id:u.id,username:u.username,email:u.email,phoneNumber:u.phone_number,
 authMethod:u.auth_method,isAdmin:u.is_admin,role:u.role
});

function originGuard(req:Request,res:Response,next:NextFunction){
 const origin=req.get("Origin"),host=req.get("Host");
 try{
  if(!origin||!host||new URL(origin).host!==host)
   return res.status(403).json({error:"Invalid request origin"});
 }catch{return res.status(403).json({error:"Invalid request origin"});}
 next();
}

export function createQaApp(){
 assertQaPreviewConfiguration();

 const app=express();
 app.disable("x-powered-by");
 app.set("trust proxy",1);
 app.use((_req,res,next)=>{
  res.setHeader("X-Robots-Tag","noindex, nofollow, noarchive");
  next();
 });
 app.get("/health",(_req,res)=>res.json({ok:true,mode:"private-vip-qa"}));
 app.get("/robots.txt",(_req,res)=>res.type("text/plain").send("User-agent: *\nDisallow: /\n"));

 // No public QA routes, APIs, or SPA files are ever served without a separate
 // browser Basic-Auth password. This is independent of VIP account sessions.
 const invalidAttempts=new Map<string,{n:number;until:number}>();
 app.use((req,res,next)=>{
  const key=req.ip||"unknown";
  const current=invalidAttempts.get(key);
  if(current&&current.until>Date.now()&&current.n>=10)
   return res.status(429).set("Retry-After","900").end();
  const authorized=qaGateMatches(req.get("Authorization"),
    process.env.KINGLIKE_VIP_QA_GATE_USER||"",
    process.env.KINGLIKE_VIP_QA_GATE_PASSWORD||"");
  if(!authorized){
   const now=Date.now();
   const count=current&&current.until>now?current.n+1:1;
   if(invalidAttempts.size>500)invalidAttempts.clear();
   invalidAttempts.set(key,{n:count,until:now+15*60*1000});
   res.setHeader("WWW-Authenticate",'Basic realm="KINGLIKE VIP Private QA"');
   res.setHeader("Cache-Control","no-store");
   return res.status(401).send("Private KINGLIKE VIP QA - login required");
  }
  invalidAttempts.delete(key);
  next();
 });

 app.use(helmet({
  crossOriginEmbedderPolicy:false,
  contentSecurityPolicy:{directives:{
   defaultSrc:["'self'"],
   scriptSrc:["'self'","'unsafe-inline'"],
   styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],
   fontSrc:["'self'","data:","https://fonts.gstatic.com"],
   imgSrc:["'self'","data:","blob:"],
   mediaSrc:["'self'","blob:"],
   connectSrc:["'self'"],
   frameSrc:["'self'","https://rtsp.run","https://rtsp.me"],
   frameAncestors:["'none'"],
   objectSrc:["'none'"]
  }}
 }));
 app.use(express.json({limit:"32kb"}));

 // QA sessions are volatile and single-instance only. No persistent visitor
 // session is shared with the real Kinglike site.
 const testMode=process.env.NODE_ENV==="test"&&process.env.VIP_QA_LOCAL_TEST==="true";
 app.use(session({
  name:"kinglike.vip.qa.sid",
  secret:process.env.KINGLIKE_VIP_QA_SESSION_SECRET!,
  resave:false,saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:!testMode,maxAge:12*60*60*1000}
 }));

 // This login only authenticates pre-existing, verified accounts in the
 // isolated QA database. Public registration is forbidden in preview.
 const loginAttempts=new Map<string,{n:number;until:number}>();
 async function activeUser(id:number):Promise<ActiveUser|null>{
  const r=await pool.query<ActiveUser>(
   "SELECT id,username,email,phone_number,auth_method,is_admin,role FROM users "+
   "WHERE id=$1 AND is_active=TRUE AND is_verified=TRUE LIMIT 1",[id]);
  return r.rows[0]||null;
 }
 app.get("/api/auth/me",async(req,res)=>{
  const id=req.session?.userId;
  if(!Number.isSafeInteger(id)||!id)return res.status(401).json({error:"Login required"});
  try{
   const u=await activeUser(id);
   return u?res.json(publicUser(u)):res.status(401).json({error:"Login required"});
  }catch{return res.status(503).json({error:"QA authentication unavailable"});}
 });
 app.post("/api/auth/login",originGuard,async(req,res)=>{
  const username=req.body?.username,password=req.body?.password;
  if(typeof username!=="string"||typeof password!=="string"||
    username.length>254||username.length<3||password.length>200)
   return res.status(400).json({error:"Invalid login"});
  const ip=req.ip||"unknown",now=Date.now(),attempt=loginAttempts.get(ip);
  if(attempt&&attempt.until>now&&attempt.n>=8)
   return res.status(429).json({error:"Too many login attempts"});
  const bad=()=>{if(loginAttempts.size>500)loginAttempts.clear();
   loginAttempts.set(ip,{n:attempt&&attempt.until>now?attempt.n+1:1,until:now+15*60*1000});
   return res.status(401).json({error:"Login failed"});};
  try{
   const r=await pool.query<ActiveUser&{password:string|null}>(
    "SELECT id,username,email,phone_number,auth_method,is_admin,role,password "+
    "FROM users WHERE (lower(username)=lower($1) OR lower(email)=lower($1)) "+
    "AND is_active=TRUE AND is_verified=TRUE LIMIT 1",[username.trim()]);
   const u=r.rows[0];
   if(!u?.password||!/^\$2[aby]\$/.test(u.password)||
     !await bcrypt.compare(password,u.password))return bad();
   loginAttempts.delete(ip);
   return req.session.regenerate(error=>{
    if(error)return res.status(503).json({error:"Session unavailable"});
    req.session.userId=u.id;
    req.session.isAdmin=u.is_admin;
    req.session.role=u.role;
    req.session.save(err=>{
      if(err)return res.status(503).json({error:"Session unavailable"});
      return res.json(publicUser(u));
    });
   });
  }catch{return res.status(503).json({error:"QA authentication unavailable"});}
 });
 app.post("/api/auth/logout",originGuard,(req,res)=>{
  req.session.destroy(err=>{
    if(err)return res.status(503).json({error:"Logout failed"});
    res.clearCookie("kinglike.vip.qa.sid");
    return res.json({loggedOut:true});
  });
 });
 app.post("/api/auth/register",(_req,res)=>res.status(403).json({error:"Registration disabled in QA"}));

 // Every VIP endpoint uses its normal production implementation, gated by the
 // QA's own signed session and active user database checks.
 registerVipRoutes(app);
 app.use("/api",(_req,res)=>res.status(404).json({error:"API not enabled in VIP QA"}));

 const staticDir=resolve(process.cwd(),"dist/public");
 app.use(express.static(staticDir,{index:false,setHeaders(res,path){
  if(path.endsWith(".html")||path.endsWith("/sw.js"))
   res.setHeader("Cache-Control","no-store");
 }}));
 app.get("/",(_req,res)=>res.redirect("/vip"));
 app.get("*",(_req,res)=>{
  res.setHeader("Cache-Control","no-store");
  try{
   return res.type("text/html").send(readFileSync(resolve(staticDir,"index.html")));
  }catch{return res.status(503).send("VIP QA web assets not built");}
 });
 return app;
}

export async function startQaPreview(){
 assertQaPreviewConfiguration();
 const ready=await pool.query(
  "SELECT to_regclass('public.users') AS users,"+
  "to_regclass('public.vip_projects') AS projects,"+
  "to_regclass('public.vip_unit_access') AS access");
 if(!ready.rows[0]?.users||!ready.rows[0]?.projects||!ready.rows[0]?.access){
  throw Error("VIP QA schema missing. Apply reviewed migrations to isolated QA database first.");
 }
 const port=Number(process.env.PORT||"3000");
 if(!Number.isInteger(port)||port<1||port>65535)throw Error("Invalid QA port");
 const app=createQaApp();
 app.listen(port,"0.0.0.0",()=>{
  process.stdout.write("KINGLIKE VIP private QA listening (non-production, isolated DB)\n");
 });
}

if(process.env.KINGLIKE_VIP_QA_START==="true"){
 startQaPreview().catch(error=>{
  process.stderr.write("VIP QA startup refused: "+(error instanceof Error?error.message:String(error))+"\n");
  process.exitCode=1;
 });
}
