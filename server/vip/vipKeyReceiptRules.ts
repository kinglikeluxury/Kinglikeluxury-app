import {z} from "zod";

export const approveHandoverInput=z.object({
  developerReference:z.string().trim().min(8).max(160),
  note:z.string().trim().min(10).max(500),
  acknowledgedNoOpenSnags:z.literal(true)
}).strict();
export const buyerKeysAcknowledgmentInput=z.object({
  receivedKeys:z.literal(true),
  keyCount:z.number().int().min(1).max(100),
  receivedDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note:z.string().trim().max(500)
}).strict().refine(v=>{
 const d=new Date(v.receivedDate+"T12:00:00Z");
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v.receivedDate;
},{path:["receivedDate"],message:"Invalid receipt date"});
export const confirmKeysInput=z.object({
  developerReference:z.string().trim().min(8).max(160),
  note:z.string().trim().min(10).max(500),
  confirmedPhysicalDelivery:z.literal(true)
}).strict();
export function canApproveHandover(status:string,openSnags:number,checklist:Record<string,string>):boolean{
 return status==="inspection_completed"&&openSnags===0&&
  ["electrical","plumbing","windows","walls","fixtures","access"].every(x=>checklist[x]==="passed");
}
