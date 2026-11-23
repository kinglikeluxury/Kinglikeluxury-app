import { randomBytes } from "node:crypto";

export type VipTier = "VIP"|"Silver"|"Gold"|"Platinum";
export type ReferralStatus = "new"|"contacted"|"qualified"|"converted"|"declined";
export type RewardStatus = "proposed"|"approved"|"declined"|"fulfilled";

const tierValues:VipTier[]=["VIP","Silver","Gold","Platinum"];
const transitionMap:Record<ReferralStatus,ReferralStatus[]>={
  new:["contacted","declined"],contacted:["qualified","declined"],
  qualified:["converted","declined"],converted:[],declined:[]
};
const rewardTransitionMap:Record<RewardStatus,RewardStatus[]>={
  proposed:["approved","declined"],approved:["fulfilled"],declined:[],fulfilled:[]
};
export function isVipTier(value:unknown):value is VipTier{
  return typeof value==="string"&&tierValues.includes(value as VipTier);
}
export function canTransitionReferral(from:ReferralStatus,to:ReferralStatus):boolean{
  return Array.isArray(transitionMap[from])&&transitionMap[from].includes(to);
}
export function canTransitionReward(from:RewardStatus,to:RewardStatus):boolean{
  return Array.isArray(rewardTransitionMap[from])&&rewardTransitionMap[from].includes(to);
}
export function normalizedReferralPhone(raw:unknown):string|null{
  if(typeof raw!=="string")return null;
  const trimmed=raw.trim();
  // E.164, including a nonzero first country-code digit.
  if(!/^\+[1-9][0-9]{7,14}$/.test(trimmed))return null;
  return trimmed;
}
export function normalizedReferralName(raw:unknown):string|null{
  if(typeof raw!=="string")return null;
  const trimmed=raw.trim().replace(/\s+/g," ");
  if(trimmed.length<2||trimmed.length>100||/[\u0000-\u001f\u007f<>]/.test(trimmed))return null;
  return trimmed;
}
export function newMembershipCode():string{
  return "KLV-"+randomBytes(12).toString("hex").toUpperCase();
}
export function validMembershipCode(raw:unknown):raw is string{
  return typeof raw==="string"&&/^KLV-[A-F0-9]{24}$/.test(raw);
}
