import {z} from "zod";
export const financialTypes=["tax","penalty","maintenance","service_fee","credit","discount","other"] as const;
export const financialSources=["developer_statement","signed_contract","internal_note"] as const;
export const financeAdjustmentInput=z.object({
 category:z.enum(financialTypes),
 amount:z.string().regex(/^[0-9]{1,12}(?:\.[0-9]{1,2})?$/).refine(s=>Number(s)>0),
 currency:z.string().regex(/^[A-Z]{3}$/),
 description:z.string().trim().min(8).max(300),
 source:z.enum(financialSources),
 sourceReference:z.string().trim().max(180),
 publish:z.boolean()
}).strict().refine(v=>!v.publish||(v.source!=="internal_note"&&v.sourceReference.length>=8),{
 message:"Only sourced adjustments may be published"
});
export function validDeveloperStatementUpload(data:Buffer):boolean{
 if(!Buffer.isBuffer(data)||data.length<10||data.length>10*1024*1024)return false;
 if(!data.subarray(0,5).equals(Buffer.from("%PDF-")))return false;
 return data.subarray(Math.max(0,data.length-2048)).toString("latin1").includes("%%EOF");
}
