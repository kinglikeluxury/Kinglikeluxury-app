import { isIP } from "node:net";

/** Allow only explicitly approved camera embed providers, never arbitrary hosts. */
export function validateVipCameraUrl(raw:unknown,allowedRaw:string|undefined):string|null{
  if(typeof raw!=="string"||raw.length>2048||raw.trim()!==raw)return null;
  try{
    const parsed=new URL(raw);
    if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.hash||parsed.port)return null;
    const host=parsed.hostname.toLowerCase();
    if(!host||host==="localhost"||host.endsWith(".local")||isIP(host)!==0)return null;
    const approved=(allowedRaw||"").split(",").map(v=>v.trim().toLowerCase()).filter(Boolean);
    if(!approved.includes(host))return null;
    return parsed.toString();
  }catch{return null;}
}
