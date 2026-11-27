import {z} from "zod";
export const supportCategories=["payment","construction","handover","maintenance","membership","other"] as const;
export const supportStatuses=["open","in_progress","waiting_customer","resolved","closed"] as const;
export const supportTicketInput=z.object({
 unitId:z.number().int().positive(),
 category:z.enum(supportCategories),
 subject:z.string().trim().min(5).max(140),
 message:z.string().trim().min(10).max(2000)
}).strict();
export const supportMessageInput=z.object({
 message:z.string().trim().min(2).max(2000)
}).strict();
export const supportAssignmentInput=z.object({
 status:z.enum(supportStatuses),
 assigneeEmail:z.string().trim().email().max(254).nullable(),
 dueAt:z.string().datetime({offset:true}).nullable(),
 internalNote:z.string().trim().min(10).max(400)
}).strict();
export function validSupportTransition(from:string,to:string):boolean{
 const steps:Record<string,string[]>={
  open:["in_progress","waiting_customer","resolved","closed"],
  in_progress:["waiting_customer","resolved","closed"],
  waiting_customer:["in_progress","resolved","closed"],
  resolved:["in_progress","closed"],
  closed:[],
 };
 return steps[from]?.includes(to)===true;
}
export function validSupportId(raw:unknown):number|null{
 if(typeof raw!=="string"||!/^[1-9]\d*$/.test(raw))return null;
 const n=Number(raw);return Number.isSafeInteger(n)?n:null;
}
