import { isIP } from "node:net";

/** Allow only explicitly approved camera embed providers, never arbitrary hosts. */
export function validateVipCameraUrl(raw:unknown,allowedRaw:string|undefined):string|null{
  if(typeof raw!=="string"||raw.length>2048||raw.trim()!==raw)return null;
  try{
    const parsed=new URL(raw);
    if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.hash||parsed.port)return null;
    const host=parsed.hostname.toLowerCase();
    if(!host||host==="localhost"||host.endsWith(".local")||isIP(host)!==0)return null;
    // RTSP.RUN is the preferred client-facing viewer. Only the HTTPS player
    // URL is accepted here, never raw rtsp:// camera credentials or IP addresses.
    const approved=new Set([
      "rtsp.run","www.rtsp.run",
      ...(allowedRaw||"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean)
    ]);
    if(!approved.has(host))return null;
    const suspicious=decodeURIComponent(parsed.search).toLowerCase();
    if(/rtsp(s)?:\/\//.test(suspicious)||
       [...parsed.searchParams.keys()].some(k=>/^(password|passwd|pass|username|user|rtsp|rtspurl|cameraurl|credentials|secret)$/i.test(k))){
      return null;
    }
    return parsed.toString();
  }catch{return null;}
}
