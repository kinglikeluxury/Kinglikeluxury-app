import {z} from "zod";

export const stages=["reservation","contract","down_payment","construction","inspection","handover"] as const;
export const statusValues=["planned","in_progress","completed"] as const;
export const serviceTypes=["fit_out","furnishing","utilities","rental_management","other"] as const;
export const serviceStates=["requested","reviewing","offered","in_progress","completed","closed"] as const;

const dateString=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>{
  const d=new Date(v+"T12:00:00Z");
  return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===v;
});

export const journeyInput=z.object({
  stage:z.enum(stages),
  status:z.enum(statusValues),
  plannedDate:dateString.nullable(),
  actualDate:dateString.nullable(),
  note:z.string().trim().max(600),
  published:z.boolean()
}).strict().refine(x=>x.status!=="completed"||x.actualDate!==null,{
  message:"Completed milestones require an actual date",path:["actualDate"]
});

export const benefitInput=z.object({
  title:z.string().trim().min(3).max(120),
  details:z.string().trim().min(15).max(1300),
  category:z.enum(["second_purchase","fit_out","furnishing","after_sales","other"]),
  validUntil:dateString.nullable(),
  published:z.boolean()
}).strict();

export const serviceRequestInput=z.object({
  unitId:z.number().int().positive(),
  type:z.enum(serviceTypes),
  details:z.string().trim().min(10).max(1200)
}).strict();

export function nextServiceStatus(from:string,to:string):boolean{
  const valid:Record<string,string[]>={
    requested:["reviewing","closed"],
    reviewing:["offered","closed"],
    offered:["in_progress","closed"],
    in_progress:["completed","closed"],
    completed:[],
    closed:[]
  };
  return valid[from]?.includes(to)===true;
}
export function positiveVipId(raw:unknown):number|null{
  if(typeof raw!=="string"||!/^[1-9]\d*$/.test(raw))return null;
  const v=Number(raw);
  return Number.isSafeInteger(v)?v:null;
}
