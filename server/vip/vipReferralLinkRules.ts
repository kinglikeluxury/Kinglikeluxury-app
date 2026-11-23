import {randomBytes} from "node:crypto";

export function newReferralCode():string{
 return "KLR-"+randomBytes(16).toString("hex").toUpperCase();
}
export function validReferralCode(raw:unknown):raw is string{
 return typeof raw==="string"&&/^KLR-[A-F0-9]{32}$/.test(raw);
}
