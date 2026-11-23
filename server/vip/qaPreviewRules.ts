import {createHash,timingSafeEqual} from "node:crypto";

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

export function assertQaPreviewConfiguration():void{
 if(process.env.KINGLIKE_VIP_QA_PREVIEW!=="true"||
    process.env.KINGLIKE_VIP_ENABLED!=="true")
   throw Error("QA-only preview and VIP flags are required");
 if(process.env.KINGLIKE_VIP_EMAIL_ENABLED==="true"||
    process.env.KINGLIKE_VIP_EMAIL_LIVE_APPROVED==="true"||
    process.env.RESEND_API_KEY||
    process.env.NEON_DATABASE_URL||
    process.env.KAY_TEST_DATABASE_URL||
    process.env.KINGLIKE_VIP_CRM_READONLY_DATABASE_URL)
   throw Error("VIP QA refuses production, mail and CRM credentials");
 if((process.env.KINGLIKE_VIP_QA_GATE_USER||"").length<4||
    (process.env.KINGLIKE_VIP_QA_GATE_PASSWORD||"").length<20||
    (process.env.KINGLIKE_VIP_QA_SESSION_SECRET||"").length<48)
   throw Error("Strong QA gateway username, password and session secret are required");
}

export function validateQaDatabaseUrl(value:unknown):string{
 if(typeof value!=="string"||!value)throw Error("VIP QA Postgres URL required");
 const parsed=new URL(value);
 if(!["postgres:","postgresql:"].includes(parsed.protocol)||
   !parsed.username||!parsed.password||!parsed.hostname)throw Error("Invalid VIP QA Postgres URL");
 const test=process.env.NODE_ENV==="test"&&process.env.VIP_QA_LOCAL_TEST==="true";
 const local=["localhost","127.0.0.1"].includes(parsed.hostname)&&parsed.pathname==="/vipdb";
 if(!parsed.hostname.endsWith(".railway.internal")&&!(test&&local))
   throw Error("VIP QA must use a Railway private-network Postgres host");
 if(parsed.port&&parsed.port!=="5432")throw Error("VIP QA Postgres must use port 5432");
 return value;
}

