import {z} from "zod";
export const crmLeadId=z.number().int().positive().safe();
export const crmVerifiedSaleInput=z.object({
 leadId:crmLeadId,
 signedSaleReference:z.string().trim().min(8).max(120),
 buyerIdentityConfirmed:z.literal(true),
 contractActuallySigned:z.literal(true),
 note:z.string().trim().min(10).max(400)
}).strict();
export const crmAssociationId=(raw:unknown):number|null=>{
 if(typeof raw!=="string"||!/^[1-9]\d*$/.test(raw))return null;
 const n=Number(raw);return Number.isSafeInteger(n)?n:null;
};
export function buyerEmailMatches(leadEmail:unknown,buyerEmail:unknown):boolean{
 if(typeof buyerEmail!=="string"||!buyerEmail.includes("@"))return false;
 if(typeof leadEmail!=="string"||!leadEmail.trim())return true;
 return leadEmail.trim().toLowerCase()===buyerEmail.trim().toLowerCase();
}
