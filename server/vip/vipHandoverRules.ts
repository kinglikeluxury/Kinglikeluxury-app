export const HANDOVER_STATES = [
  "not_ready","ready_for_appointment","appointment_scheduled",
  "inspection_completed","snags_open","handover_approved","keys_delivered"
] as const;
export type HandoverState = typeof HANDOVER_STATES[number];

export const HANDOVER_CHECK_ITEMS = [
  "electrical","plumbing","windows","walls","fixtures","access"
] as const;
export type HandoverCheckItem = typeof HANDOVER_CHECK_ITEMS[number];
export type HandoverCheckStatus = "pending"|"passed"|"issue";
export type HandoverChecklist = Record<HandoverCheckItem,HandoverCheckStatus>;
export const DEFAULT_HANDOVER_CHECKLIST: HandoverChecklist = {
  electrical:"pending",plumbing:"pending",windows:"pending",
  walls:"pending",fixtures:"pending",access:"pending"
};

export function validHandoverChecklist(raw:unknown):raw is HandoverChecklist{
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return false;
  const keys=Object.keys(raw);
  if(keys.length!==HANDOVER_CHECK_ITEMS.length || keys.some(k=>!HANDOVER_CHECK_ITEMS.includes(k as HandoverCheckItem)))return false;
  return HANDOVER_CHECK_ITEMS.every(k=>["pending","passed","issue"].includes((raw as Record<string,string>)[k]));
}

export function canUpdateHandoverState(current:HandoverState,action:"mark_ready"|"finish_inspection",checks:HandoverChecklist,openSnags:number):boolean{
  if(action==="mark_ready")return current==="not_ready";
  return current==="appointment_scheduled" && openSnags===0 &&
    HANDOVER_CHECK_ITEMS.every(item=>checks[item]==="passed");
}

export function validAppointmentDate(raw:unknown,now=new Date()):Date|null{
  if(typeof raw!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw))return null;
  const date=new Date(raw);
  if(!Number.isFinite(date.getTime())||date.toISOString()!==raw)return null;
  const delta=date.getTime()-now.getTime();
  return delta>60*60*1000 && delta<=180*24*60*60*1000?date:null;
}
