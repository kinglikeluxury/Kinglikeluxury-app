import {useEffect,useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {ClipboardCheck,CalendarCheck,Flag,ShieldCheck} from "lucide-react";
import {useTranslation} from "react-i18next";
import {getHandoverCopy} from "./vipHandoverCopy";
import type {HandoverInfo} from "./VipHandoverClient";

type Unit={id:string;project_id:string;unit_number:string};
type Project={id:string;name:string};
const keys=["electrical","plumbing","windows","walls","fixtures","access"];
const options=["pending","passed","issue"];
const itemClass="rounded-lg border border-[#d4e5e7] bg-white px-3 py-2 text-sm";

export default function VipHandoverAdmin({units,projects}:{units:Unit[];projects:Project[]}){
 const {i18n}=useTranslation();const t=getHandoverCopy(i18n.language);
 const qc=useQueryClient();const [chosen,setChosen]=useState("");
 const unitId=units.some(u=>u.id===chosen)?chosen:units[0]?.id||"";
 const [checklist,setChecklist]=useState<Record<string,string>>({});
 const [inspectionNote,setInspectionNote]=useState("");
 const [resolution,setResolution]=useState<Record<string,string>>({});
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [okay,setOkay]=useState(false);
 const query=useQuery<HandoverInfo>({
  queryKey:["vip","admin","handover",unitId],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/units/"+encodeURIComponent(unitId)+"/handover",
    {credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!unitId,retry:false
 });
 useEffect(()=>{
  setChecklist(query.data?.handover.checklist||{});
  setInspectionNote(query.data?.handover.inspection_note||"");
 },[query.data]);
 const base="/api/admin/vip/units/"+encodeURIComponent(unitId)+"/handover";
 const state=query.data?.handover.status||"not_ready";
 const openSnags=query.data?.snags.filter(s=>s.status==="open")||[];
 const pending=query.data?.appointments.filter(a=>a.status==="requested")||[];
 const allPass=keys.every(k=>checklist[k]==="passed");
 const canReview=["appointment_scheduled","snags_open","inspection_completed"].includes(state);
 async function action(path:string,method:"POST"|"PUT"|"PATCH",body:unknown) {
  if(busy||!unitId)return;
  setBusy(true);setMessage("");setOkay(false);
  try {
   const r=await fetch(path,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   if(!r.ok){const x=await r.json().catch(()=>null);throw Error(x?.error||t.error)}
   setOkay(true);setMessage(t.saved);
   await Promise.all([
    qc.invalidateQueries({queryKey:["vip","admin","handover",unitId]}),
    qc.invalidateQueries({queryKey:["vip","handover",unitId]})
   ]);
  }catch(e){setOkay(false);setMessage(e instanceof Error?e.message:t.error)}
  finally{setBusy(false)}
 }
 function saveChecklist(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!keys.every(k=>options.includes(checklist[k])))return;
  void action(base+"/checklist","PUT",{checklist});
 }
 if(!units.length)return null;
 const fmt=(iso:string)=>new Date(iso).toLocaleString(i18n.language,{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
 return <section className="mt-8 rounded-2xl border border-[#d4e7e8] bg-white p-5 shadow-sm md:p-6">
  <h3 className="mb-5 flex items-center gap-2 text-lg font-semibold"><ClipboardCheck className="h-6 w-6 text-[#008c93]"/>{t.admin}</h3>
  <label className="mb-4 block text-sm">{t.status}
   <select className={"mt-2 block w-full "+itemClass} value={unitId} onChange={e=>{setChosen(e.target.value);setMessage("")}}>
    {units.map(u=><option key={u.id} value={u.id}>{projects.find(p=>p.id===u.project_id)?.name} · {u.unit_number}</option>)}
   </select>
  </label>
  {query.isPending?<p className="text-sm">{t.loading}</p>:query.isError?<p role="alert" className="text-sm text-rose-700">{t.error}</p>:
   <>
    <div className="rounded-xl bg-[#eff8f8] p-4">
     <p className="text-xs text-[#71909a]">{t.status}</p>
     <p className="mt-1 font-semibold text-[#005476]">{t[state]||state}</p>
     {query.data.handover.scheduled_at&&<p className="mt-2 text-xs text-[#537789]">{t.schedule}: {fmt(query.data.handover.scheduled_at)}</p>}
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
     {state==="not_ready"&&<button type="button" disabled={busy} className="rounded-lg bg-[#005476] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
       onClick={()=>void action(base+"/stage","POST",{action:"mark_ready",note:inspectionNote})}>{t.ready}</button>}
     {state==="appointment_scheduled"&&<>
      {allPass&&openSnags.length===0&&<button type="button" disabled={busy} onClick={()=>void action(base+"/stage","POST",{action:"finish_inspection",note:inspectionNote})}
        className="rounded-lg bg-[#005476] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t.finish}</button>}
      {(!allPass||openSnags.length>0)&&<button type="button" disabled={busy} onClick={()=>void action(base+"/stage","POST",{action:"record_issues",note:inspectionNote})}
        className="rounded-lg border border-amber-500 px-4 py-2 text-sm font-semibold text-[#9a6900] disabled:opacity-50">{t.issues}</button>}
     </>}
     {state==="snags_open"&&allPass&&openSnags.length===0&&
      <button type="button" disabled={busy} onClick={()=>void action(base+"/stage","POST",{action:"resolve_issues",note:inspectionNote})}
       className="rounded-lg bg-[#005476] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t.resolveIssues}</button>}
    </div>
    {pending.length>0&&<div className="mt-6">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarCheck className="h-4 w-4 text-[#168e91]"/>{t.appointments}</h4>
      {pending.map(a=><div key={a.id} className="mb-2 rounded-xl border border-[#d9e8ec] p-3 text-sm">
        <p className="font-semibold">{fmt(a.preferred_at)}</p>
        {a.note&&<p className="mt-2 text-xs text-[#65838f]">{a.note}</p>}
        <div className="mt-3 flex gap-2">
         <button type="button" disabled={busy} onClick={()=>void action(base+"/appointments/"+encodeURIComponent(a.id),"PATCH",{decision:"confirm"})}
          className="rounded-lg bg-[#005476] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{t.confirm}</button>
         <button type="button" disabled={busy} onClick={()=>void action(base+"/appointments/"+encodeURIComponent(a.id),"PATCH",{decision:"decline"})}
          className="rounded-lg border border-[#d2a8a8] px-4 py-2 text-xs text-rose-800 disabled:opacity-50">{t.decline}</button>
        </div>
       </div>)}
    </div>}
    {canReview&&<form className="mt-6" onSubmit={saveChecklist}>
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4"/>{t.inspection}</h4>
      <div className="grid grid-cols-2 gap-3">
       {keys.map(k=><label key={k} className="block text-xs">{t[k]}
         <select className={"mt-1 block w-full "+itemClass} value={checklist[k]||"pending"}
           onChange={e=>setChecklist(prev=>({...prev,[k]:e.target.value}))}>
          {options.map(s=><option key={s} value={s}>{t[s]}</option>)}
         </select>
       </label>)}
      </div>
      <label className="mt-4 block text-xs">{t.note}
       <textarea className={"mt-1 block w-full "+itemClass} rows={2} maxLength={1200}
         value={inspectionNote} onChange={e=>setInspectionNote(e.target.value)}/>
      </label>
      <button type="submit" disabled={busy} className="mt-3 rounded-lg bg-[#005476] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t.checkSave}</button>
    </form>}
    {query.data.snags.length>0&&<div className="mt-6">
     <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Flag className="h-4 w-4 text-amber-700"/>{t.snags}</h4>
     {query.data.snags.map(s=><div key={s.id} className="mb-3 rounded-xl border border-[#dce6e9] p-4">
       <p className="text-sm font-semibold">{s.description}</p>
       <p className="mt-1 text-xs text-[#66838d]">{t[s.status]}</p>
       {s.resolution_note&&<p className="mt-2 text-xs text-[#587b86]">{s.resolution_note}</p>}
       {s.status==="open"&&state==="snags_open"&&<div className="mt-3">
        <textarea className={"w-full "+itemClass} rows={2} maxLength={1200}
          placeholder={t.resolution} value={resolution[s.id]||""}
          onChange={e=>setResolution(prev=>({...prev,[s.id]:e.target.value}))}/>
        <button type="button" disabled={busy||(resolution[s.id]||"").trim().length<10}
          className="mt-2 rounded-lg border border-[#bcd6da] px-4 py-2 text-xs font-semibold text-[#005476] disabled:opacity-50"
          onClick={()=>void action(base+"/snags/"+encodeURIComponent(s.id),"PATCH",{resolutionNote:resolution[s.id]})}>{t.resolve}</button>
       </div>}
     </div>)}
    </div>}
    {message&&<p role="status" className={"mt-4 text-sm "+(okay?"text-emerald-800":"text-rose-700")}>{message}</p>}
    <p className="mt-4 text-xs leading-relaxed text-[#80949b]">{t.notice}</p>
   </>
  }
 </section>;
}
