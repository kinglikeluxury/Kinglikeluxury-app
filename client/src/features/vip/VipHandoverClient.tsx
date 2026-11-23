import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {ClipboardCheck,CalendarDays,Flag,CheckCircle2} from "lucide-react";
import {getHandoverCopy} from "./vipHandoverCopy";
import VipKeysClient from "./VipKeysClient";

export type HandoverAppointment={id:string;preferred_at:string;status:"requested"|"confirmed"|"declined";requested_at:string;confirmed_at:string|null;note:string|null};
export type HandoverSnag={id:string;description:string;status:"open"|"resolved";created_at:string;resolved_at:string|null;resolution_note:string|null};
export type HandoverInfo={handover:{unit_id:string;status:string;scheduled_at:string|null;checklist:Record<string,string>;inspection_note:string|null;updated_at:string|null};
 appointments:HandoverAppointment[];snags:HandoverSnag[]};
const keys=["electrical","plumbing","windows","walls","fixtures","access"];

export default function VipHandoverClient({unitId}:{unitId:string}){
 const {i18n}=useTranslation();const t=getHandoverCopy(i18n.language);
 const qc=useQueryClient();
 const [preferred,setPreferred]=useState("");
 const [note,setNote]=useState("");
 const [snag,setSnag]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");const [success,setSuccess]=useState(false);
 const query=useQuery<HandoverInfo>({
  queryKey:["vip","handover",unitId],
  queryFn:async()=>{
   const r=await fetch("/api/vip/units/"+encodeURIComponent(unitId)+"/handover",{credentials:"include",cache:"no-store"});
   if(!r.ok)throw Error("Handover unavailable");
   return r.json();
  },enabled:!!unitId,retry:false
 });
 async function send(path:string,body:unknown){
  setBusy(true);setMessage("");setSuccess(false);
  try{
   const r=await fetch(path,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body)});
   if(!r.ok)throw Error(t.error);
   setSuccess(true);setMessage(t.sent);
   await qc.invalidateQueries({queryKey:["vip","handover",unitId]});
   return true;
  }catch{setSuccess(false);setMessage(t.error);return false}
  finally{setBusy(false)}
 }
 async function request(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!preferred)return;
  const utc=new Date(preferred);
  if(Number.isNaN(utc.getTime()))return;
  if(await send("/api/vip/units/"+encodeURIComponent(unitId)+"/handover/appointments",
      {preferredAt:utc.toISOString(),note})) {setPreferred("");setNote("");}
 }
 async function report(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(await send("/api/vip/units/"+encodeURIComponent(unitId)+"/handover/snags",{description:snag}))setSnag("");
 }
 if(query.isPending)return <section className="mt-5 rounded-xl bg-[#f4f9f9] p-4 text-sm">{t.loading}</section>;
 if(query.isError)return <section className="mt-5 text-xs text-[#8d5d3e]">{t.error}</section>;
 const h=query.data.handover;
 const pendingAppointment=query.data.appointments.some(a=>a.status==="requested");
 const openSnags=query.data.snags.filter(s=>s.status==="open").length;
 const allowedReport=["appointment_scheduled","inspection_completed","snags_open"].includes(h.status);
 const fmt=(raw:string)=>new Date(raw).toLocaleString(i18n.language,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
 return <section className="mt-6 border-t border-[#dbe9ec] pt-5">
  <h4 className="mb-4 flex items-center gap-2 text-base font-semibold"><ClipboardCheck className="h-5 w-5 text-[#12999a]"/>{t.title}</h4>
  <div className="rounded-xl bg-[#eaf7f7] px-4 py-3">
   <p className="text-xs text-[#678795]">{t.status}</p>
   <p className="mt-1 font-semibold text-[#005476]">{t[h.status]||h.status}</p>
   {h.scheduled_at&&<p className="mt-2 text-sm"><CalendarDays className="me-1 inline h-4 w-4"/>{t.schedule}: <strong>{fmt(h.scheduled_at)}</strong></p>}
  </div>
  <h5 className="mb-3 mt-5 font-semibold text-sm">{t.inspection}</h5>
  <div className="grid grid-cols-2 gap-2">
   {keys.map(k=><div key={k} className="rounded-lg border border-[#d8e9eb] bg-[#f9fcfc] p-3">
     <p className="text-xs font-medium">{t[k]}</p>
     <p className={"mt-1 text-xs "+(h.checklist?.[k]==="passed"?"text-emerald-700":h.checklist?.[k]==="issue"?"text-rose-700":"text-[#7c9299]")}>{t[h.checklist[k] || "pending"]||t.pending}</p>
   </div>)}
  </div>
  {h.inspection_note&&<p className="mt-3 text-xs text-[#627b89]">{h.inspection_note}</p>}
  {h.status==="ready_for_appointment"&&!pendingAppointment&&<form onSubmit={request} className="mt-5 rounded-xl border border-[#d1e4e7] p-4">
    <h5 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4"/>{t.request}</h5>
    <label className="block text-xs">{t.preferred}
      <input type="datetime-local" className="mt-2 block w-full rounded-lg border border-[#d1e3e4] p-3 text-sm"
        value={preferred} onChange={e=>setPreferred(e.target.value)} required/>
    </label>
    <label className="mt-3 block text-xs">{t.note}
      <textarea rows={2} maxLength={800} className="mt-2 block w-full rounded-lg border border-[#d1e3e4] p-3 text-sm"
        value={note} onChange={e=>setNote(e.target.value)} />
    </label>
    <button type="submit" disabled={busy||!preferred} className="mt-3 rounded-lg bg-[#005476] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t.send}</button>
  </form>}
  {query.data.appointments.length>0&&<div className="mt-5">
    <h5 className="mb-2 text-sm font-semibold">{t.appointments}</h5>
    {query.data.appointments.map(a=><p key={a.id} className="mb-2 rounded-lg bg-[#f6fafa] px-3 py-2 text-xs">
      <span className="font-semibold">{t[a.status]}:</span> {fmt(a.preferred_at)}
      {a.note&&<span className="block text-[#64838d]">{a.note}</span>}
    </p>)}
  </div>}
  {allowedReport&&<form onSubmit={report} className="mt-5 rounded-xl border border-[#d7e8e9] p-4">
    <h5 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Flag className="h-4 w-4 text-[#bb7f34]"/>{t.report}</h5>
    <textarea value={snag} onChange={e=>setSnag(e.target.value)}
      className="w-full rounded-lg border border-[#d1e3e4] p-3 text-sm" rows={3}
      required minLength={10} maxLength={1200} placeholder={t.description}/>
    <button type="submit" disabled={busy||snag.trim().length<10} className="mt-2 rounded-lg bg-[#005476] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t.submit}</button>
  </form>}
  {(query.data.snags.length>0||openSnags>0)&&<div className="mt-5">
    <h5 className="mb-2 text-sm font-semibold">{t.snags}</h5>
    {query.data.snags.map(s=><div key={s.id} className="mb-2 rounded-lg bg-[#f7fafb] p-3 text-xs">
      <span className="mb-1 flex items-center gap-1 font-semibold"><CheckCircle2 className="h-4 w-4"/>{t[s.status]}</span>
      <p>{s.description}</p>{s.resolution_note&&<p className="mt-2 text-[#607d8a]">{s.resolution_note}</p>}
    </div>)}
  </div>}
  {message&&<p role="status" className={"mt-3 text-xs "+(success?"text-emerald-800":"text-rose-700")}>{message}</p>}
  <VipKeysClient unitId={unitId} status={h.status}/>
  <p className="mt-4 text-xs leading-relaxed text-[#81949d]">{t.notice}</p>
 </section>;
}
