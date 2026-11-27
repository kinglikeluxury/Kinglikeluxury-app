import {createHash,timingSafeEqual} from "node:crypto";

const QA_ENV_ALLOWLIST = new Set([
 "PATH","HOME","TMPDIR","LANG","LC_ALL","TZ","NODE_ENV","PORT","PWD","SHLVL",
 "KINGLIKE_VIP_QA_START","KINGLIKE_VIP_QA_PREVIEW","KINGLIKE_VIP_ENABLED",
 "KINGLIKE_VIP_QA_LOCAL_ONLY","VIP_QA_LOCAL_TEST","KINGLIKE_VIP_QA_DATABASE_URL",
 "VIP_QA_EXPECTED_DATA_DIRECTORY",
 "VIP_QA_EXPECTED_PORT",
 "KINGLIKE_VIP_QA_GATE_USER","KINGLIKE_VIP_QA_GATE_PASSWORD",
 "KINGLIKE_VIP_QA_SESSION_SECRET","KINGLIKE_VIP_QA_MIGRATE_APPROVED"
]);

const QA_PROXY_ENV_ALLOWLIST = new Set([
 "PATH","HOME","TMPDIR","LANG","LC_ALL","TZ","NODE_ENV","PWD","SHLVL",
 "KINGLIKE_VIP_QA_PROXY_START",
 "KINGLIKE_VIP_QA_GATE_USER","KINGLIKE_VIP_QA_GATE_PASSWORD"
]);

const privateProjectRoots = new Set([
 "server","client","shared","mobile-app","kinglike-twa","android",
 "node_modules","dist","attached_assets"
]);

const privateFilePattern = /\.(?:env(?:\..+)?|pem|key|jks|p12|pfx|keystore|map|ts|tsx|jsx|mjs)$/i;

/**
 * Reject paths that could be mistaken for project files or encoded traversal.
 * The QA server only serves its generated public directory; this is an
 * additional fail-closed guard before the SPA fallback.
 */
export function isForbiddenQaPath(rawPath:unknown):boolean{
 if(typeof rawPath!=="string"||!rawPath.startsWith("/"))return true;
 let path=rawPath.split("?",1)[0];
 for(let i=0;i<5;i++){
  if(/%(?:2e|2f|5c)/i.test(path))return true;
  let decoded:string;
  try{decoded=decodeURIComponent(path);}catch{return true;}
  if(decoded===path)break;
  path=decoded;
 }
 if(/%(?:2e|2f|5c)/i.test(path))return true;
 const normalized=path.replace(/\\/g,"/");
 const segments=normalized.split("/").filter(Boolean);
 if(segments.some(segment=>segment==="."||segment===".."||segment.startsWith(".")))
  return true;
 const root=segments[0]?.toLowerCase();
 if(root&&privateProjectRoots.has(root))return true;
 if(segments.some(segment=>
   privateFilePattern.test(segment)||
   /^(?:package(?:-lock)?\.json|replit\.nix|\.replit)$/i.test(segment)))
  return true;
 return false;
}

export function qaGateMatches(header:unknown,username:string,password:string):boolean{
 if(typeof header!=="string"||!header.startsWith("Basic ")||header.length>600)return false;
 const raw=header.slice(6);
 if(!/^[A-Za-z0-9+/=]+$/.test(raw))return false;
 const decoded=Buffer.from(raw,"base64").toString("utf8");
 const expected=username+":"+password;
 const a=createHash("sha256").update(decoded).digest();
 const b=createHash("sha256").update(expected).digest();
 return timingSafeEqual(a,b);
}

export function assertQaPreviewEnvironment(env:Record<string,string|undefined>):void{
  if(Object.keys(env).some(name=>!QA_ENV_ALLOWLIST.has(name)))
    throw Error("VIP QA refuses an inherited or unapproved environment variable");
  if(env.NODE_ENV!=="test"||env.VIP_QA_LOCAL_TEST!=="true"||
     env.KINGLIKE_VIP_QA_LOCAL_ONLY!=="true"||
     env.KINGLIKE_VIP_QA_PREVIEW!=="true"||
     !["true","false"].includes(env.KINGLIKE_VIP_ENABLED||""))
    throw Error("Loopback-only VIP QA flags are required");
  if(typeof env.VIP_QA_EXPECTED_DATA_DIRECTORY!=="string"||
     !/^\/tmp\/kinglike-vip-pg-[A-Za-z0-9_-]+$/.test(env.VIP_QA_EXPECTED_DATA_DIRECTORY))
    throw Error("VIP QA requires a verified temporary PostgreSQL data directory");
  if(!/^\d+$/.test(env.VIP_QA_EXPECTED_PORT||"")||
     Number(env.VIP_QA_EXPECTED_PORT)<1||Number(env.VIP_QA_EXPECTED_PORT)>65535)
    throw Error("VIP QA requires the pinned temporary PostgreSQL port");
  validateQaDatabaseUrl(env.KINGLIKE_VIP_QA_DATABASE_URL,env);
  if((env.KINGLIKE_VIP_QA_GATE_USER||"").length<4||
     (env.KINGLIKE_VIP_QA_GATE_PASSWORD||"").length<20||
     (env.KINGLIKE_VIP_QA_SESSION_SECRET||"").length<48)
    throw Error("Strong synthetic QA gateway and session credentials are required");
}

export function assertQaPreviewConfiguration():void{
  assertQaPreviewEnvironment(process.env);
}

export function assertQaLocalProxyEnvironment(env:Record<string,string|undefined>):void{
 if(Object.keys(env).some(name=>!QA_PROXY_ENV_ALLOWLIST.has(name)))
  throw Error("VIP QA proxy refuses inherited or unapproved environment variables");
 if(env.NODE_ENV!=="test"||env.KINGLIKE_VIP_QA_PROXY_START!=="true"||
   (env.KINGLIKE_VIP_QA_GATE_USER||"").length<4||
   (env.KINGLIKE_VIP_QA_GATE_PASSWORD||"").length<20)
  throw Error("Loopback VIP QA proxy requires explicit test mode and synthetic Basic Auth");
}

export function validateQaDatabaseUrl(
  value:unknown,
  env:Record<string,string|undefined>=process.env
):string{
 if(typeof value!=="string"||!value)throw Error("VIP QA Postgres URL required");
  let parsed:URL;
  try{parsed=new URL(value);}catch{throw Error("Invalid VIP QA Postgres URL");}
 if(!["postgres:","postgresql:"].includes(parsed.protocol)||
    !parsed.username||!parsed.password||!parsed.hostname||
    parsed.search||parsed.hash)throw Error("Invalid VIP QA Postgres URL");
  const username=decodeURIComponent(parsed.username);
  const localHost=["localhost","127.0.0.1"].includes(parsed.hostname);
  const localMode=env.NODE_ENV==="test"&&env.VIP_QA_LOCAL_TEST==="true"&&
    env.KINGLIKE_VIP_QA_LOCAL_ONLY==="true";
  const expectedPort=Number(env.VIP_QA_EXPECTED_PORT);
  if(!localMode||!localHost||parsed.pathname!=="/vipdb"||
    !/^vipqa_[a-z0-9_]{1,40}$/.test(username)||
    !Number.isInteger(expectedPort)||expectedPort<1||Number(parsed.port)!==expectedPort)
    throw Error("VIP QA database must be a dedicated loopback vipdb identity");
  if(parsed.port&&(!/^\d+$/.test(parsed.port)||Number(parsed.port)<1||Number(parsed.port)>65535))
    throw Error("Invalid local VIP QA database port");
 return value;
}
