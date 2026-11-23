import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Wallet,ShieldCheck} from "lucide-react";
type Unit={id:string;project_id:string;unit_number:string};
type Project={id:string;name:string};
type Entry={id:string;category:string;amount:string;currency:string;description:string;source:string;source_reference:string|null;published:boolean};
type Total={currency:string;scheduled:string;verified_paid:string;outstanding:string};
const options=["tax","penalty","maintenance","service_fee","credit","discount","other"] as const;
const sourceOptions=["developer_statement","signed_contract","internal_note"] as const;
const copy:Record<string,Record<string,string>>={
 ar:{title:"الحسابات المالية والتسويات",unit:"العقار",type:"نوع القيد",amount:"القيمة",currency:"العملة",description:"وصف القيد",source:"مرجع المعلومات",reference:"رقم المستند أو مرجعه",publish:"نشر القيد للعميل بعد التحقق",save:"إضافة قيد",existing:"السجل المالي",hide:"إخفاء",show:"نشر",void:"إبطال القيد",confirm:"تأكيد إبطال القيد؟ سيبقى محفوظًا في سجل التدقيق.",scheduled:"إجمالي الأقساط",paid:"مدفوعات معتمدة",balance:"الرصيد المتبقي",success:"تم الحفظ",error:"تعذر الحفظ أو المراجعة",note:"هذه سجلات توثيقية منفصلة عن الأقساط. يجب عدم تحويل المبالغ أو احتساب ضرائب وغرامات غير مثبتة تلقائيًا.",noUnits:"أضف وحدة أولًا."},
 en:{title:"Financial records and adjustments",unit:"Property",type:"Entry type",amount:"Amount",currency:"Currency",description:"Entry description",source:"Source",reference:"Document reference",publish:"Publish after verification",save:"Add record",existing:"Financial records",hide:"Hide",show:"Publish",void:"Void record",confirm:"Void this entry? It remains in the audit log.",scheduled:"Scheduled",paid:"Verified paid",balance:"Outstanding",success:"Saved",error:"Could not save",note:"These records are separate from installment balances. No unverified taxes or penalties are charged automatically.",noUnits:"Add a unit first."},
 he:{title:"רישומי כספים",unit:"נכס",type:"סוג",amount:"סכום",currency:"מטבע",description:"תיאור",source:"מקור",reference:"מסמך",publish:"פרסום",save:"הוספה",existing:"רשומות",hide:"הסתר",show:"פרסום",void:"ביטול",confirm:"לאשר ביטול?",scheduled:"מתוכנן",paid:"שולם",balance:"יתרה",success:"נשמר",error:"שגיאה",note:"לא ניתן לחייב סכומים ללא אישור.",noUnits:"יש להוסיף יחידה."},
 tr:{title:"Mali kayıtlar",unit:"Mülk",type:"Tür",amount:"Tutar",currency:"Döviz",description:"Açıklama",source:"Kaynak",reference:"Belge referansı",publish:"Onaydan sonra yayımla",save:"Kayıt ekle",existing:"Kayıtlar",hide:"Gizle",show:"Yayımla",void:"İptal et",confirm:"Bu kayıt iptal edilsin mi?",scheduled:"Planlanan",paid:"Doğrulanan",balance:"Kalan",success:"Kaydedildi",error:"İşlem başarısız",note:"Bu kayıtlar taksitlerden ayrıdır; doğrulanmamış ücret eklenmez.",noUnits:"Önce ünite ekleyin."},
 az:{title:"Maliyyə qeydləri",unit:"Mənzil",type:"Növ",amount:"Məbləğ",currency:"Valyuta",description:"Açıqlama",source:"Mənbə",reference:"Sənəd istinadı",publish:"Təsdiqdən sonra dərc et",save:"Əlavə et",existing:"Qeydlər",hide:"Gizlət",show:"Dərc et",void:"Ləğv et",confirm:"Qeyd ləğv edilsin?",scheduled:"Plan",paid:"Təsdiqlənib",balance:"Qalıq",success:"Saxlandı",error:"Xəta",note:"Təsdiqlənməmiş məbləğ avtomatik tutulmur.",noUnits:"Əvvəlcə mənzil əlavə edin."}
};
const cls="mt-1 block w-full rounded-lg border border-[#d0e2e4] bg-white p-3 text-sm";
export default function VipFinanceAdmin(){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const qc=useQueryClient();
 const catalog=useQuery<{projects:Project[];units:Unit[]}>({
  queryKey:["vip","admin","projects"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/projects",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const units=catalog.data?.units||[],projects=catalog.data?.projects||[];
 const [unitChoice,setUnitChoice]=useState(""),[category,setCategory]=useState("maintenance"),[amount,setAmount]=useState(""),[currency,setCurrency]=useState("USD"),[description,setDescription]=useState(""),[source,setSource]=useState("internal_note"),[reference,setReference]=useState(""),[publish,setPublish]=useState(false),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState("");
 const id=units.some(x=>x.id===unitChoice)?unitChoice:units[0]?.id||"";
 const detail=useQuery<{totals:Total[];adjustments:Entry[]}>({
  queryKey:["vip","admin","finance",id],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/units/"+encodeURIComponent(id)+"/account",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!id,retry:false
 });
 async function request(path:string,method:"POST"|"PATCH",body:unknown){
  if(busy)return false;
  setBusy(true);setFeedback("");
  try{
   const r=await fetch(path,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   if(!r.ok)throw Error(t.error);
   await qc.invalidateQueries({queryKey:["vip","admin","finance",id]});
   await qc.invalidateQueries({queryKey:["vip","finance",id]});
   setFeedback(t.success);return true;
  }catch{setFeedback(t.error);return false}finally{setBusy(false)}
 }
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(await request("/api/admin/vip/units/"+encodeURIComponent(id)+"/adjustments","POST",
   {category,amount,currency,description,source,sourceReference:reference,publish})){
    setAmount("");setDescription("");setReference("");setPublish(false);
  }
 }
 return <section className="mt-9 rounded-2xl border border-[#d6e8ea] bg-white p-5 md:p-6">
  <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><Wallet className="h-6 w-6 text-[#00959a]"/>{t.title}</h2>
  <p className="mb-4 flex items-start gap-2 text-xs text-[#72919c]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.note}</p>
  <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
   <label className="text-sm sm:col-span-2">{t.unit}
    <select className={cls} value={id} onChange={e=>setUnitChoice(e.target.value)} disabled={!units.length}>
     {!units.length?<option value="">{t.noUnits}</option>:units.map(u=><option key={u.id} value={u.id}>{projects.find(p=>p.id===u.project_id)?.name} · {u.unit_number}</option>)}
    </select>
   </label>
   <label className="text-sm">{t.type}<select value={category} onChange={e=>setCategory(e.target.value)} className={cls}>{options.map(x=><option key={x} value={x}>{x.replace(/_/g," ")}</option>)}</select></label>
   <label className="text-sm">{t.currency}<input required className={cls} maxLength={3} pattern="[A-Z]{3}" value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label>
   <label className="text-sm">{t.amount}<input required inputMode="decimal" className={cls} value={amount} onChange={e=>setAmount(e.target.value)} pattern="[0-9]{1,12}(\.[0-9]{1,2})?"/></label>
   <label className="text-sm">{t.source}<select className={cls} value={source} onChange={e=>{setSource(e.target.value);if(e.target.value==="internal_note")setPublish(false)}}>{sourceOptions.map(x=><option value={x} key={x}>{x.replace(/_/g," ")}</option>)}</select></label>
   <label className="text-sm sm:col-span-2">{t.description}<input required className={cls} minLength={8} maxLength={300} value={description} onChange={e=>setDescription(e.target.value)}/></label>
   <label className="text-sm sm:col-span-2">{t.reference}<input className={cls} maxLength={180} value={reference} onChange={e=>setReference(e.target.value)}/></label>
   <label className="flex items-start gap-2 text-xs sm:col-span-2"><input type="checkbox" checked={publish} disabled={source==="internal_note"||reference.length<8} onChange={e=>setPublish(e.target.checked)}/>{t.publish}</label>
   <button type="submit" disabled={!id||busy||catalog.isError} className="rounded-xl bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.save}</button>
  </form>
  {feedback&&<p role="status" className="mt-3 text-xs">{feedback}</p>}
  {!!detail.data?.totals.length&&<div className="mt-5 grid gap-3 sm:grid-cols-2">
   {detail.data.totals.map(x=><div key={x.currency} className="rounded-xl bg-[#f1f9f9] p-4 text-sm">
    <strong>{x.currency}</strong><p>{t.scheduled}: {x.scheduled}</p><p>{t.paid}: {x.verified_paid}</p><p>{t.balance}: {x.outstanding}</p>
   </div>)}
  </div>}
  <div className="mt-5 space-y-2">{detail.data?.adjustments.map(x=><article key={x.id} className="rounded-xl border border-[#d9e8ea] p-4 text-sm">
    <div className="flex flex-wrap items-start justify-between gap-2">
     <strong>{x.description}</strong><span>{x.amount} {x.currency}</span>
    </div>
    <p className="mt-1 text-xs text-[#78909b]">{x.category} · {x.source_reference||x.source} · {x.published?"Published":"Draft"}</p>
    <div className="mt-3 flex flex-wrap gap-2">
     <button type="button" disabled={busy} onClick={()=>void request("/api/admin/vip/adjustments/"+encodeURIComponent(x.id),"PATCH",{action:x.published?"hide":"publish"})}
      className="rounded-lg border border-[#bcd8d9] px-3 py-2 text-xs disabled:opacity-50">{x.published?t.hide:t.show}</button>
     <button type="button" disabled={busy} onClick={()=>{if(window.confirm(t.confirm))void request("/api/admin/vip/adjustments/"+encodeURIComponent(x.id),"PATCH",{action:"void"})}}
      className="rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-800 disabled:opacity-50">{t.void}</button>
    </div>
   </article>)}</div>
 </section>;
}
