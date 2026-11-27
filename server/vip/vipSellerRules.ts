export const VIP_SELLER_ROLES = [
  "sub_agent","crm_employee","sales_agent","employee","agent"
] as const;

export function validSellerAccount(user:{
  is_active:unknown;is_verified:unknown;is_admin:unknown;role:unknown;email:unknown
}):boolean{
  return user.is_active===true && user.is_verified===true &&
    user.is_admin!==true && typeof user.role==="string" &&
    VIP_SELLER_ROLES.some(role=>role===user.role) &&
    typeof user.email==="string" && /^[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+$/.test(user.email);
}
export function validSellerReason(raw:unknown):raw is string{
  return typeof raw==="string" &&
    raw.trim().length>=10 && raw.trim().length<=240 &&
    !/[\u0000-\u001f\u007f]/.test(raw);
}
export function validSellerEmail(raw:unknown):string|null{
  if(typeof raw!=="string"||raw.length>254)return null;
  const e=raw.trim().toLowerCase();
  return /^[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+$/.test(e)?e:null;
}
