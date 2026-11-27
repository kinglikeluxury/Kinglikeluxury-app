import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {CalendarRange,Gift,LifeBuoy} from "lucide-react";

type Unit={id:string;project_id:string;unit_number:string};
type Project={id:string;name:string};
type Milestone={stage_code:string;status:string;planned_date:string|null;actual_date:string|null;note:string|null;published:boolean};
type Benefit={id:string;title:string;details:string;category:string;valid_until:string|null;published:boolean};
type Service={id:string;service_type:string;details:string;status:string;admin_reply:string|null;customer_email:string;project_name:string;unit_number:string};
const stages=["reservation","contract","down_payment","construction","inspection","handover"] as const;
const categories=["second_purchase","fit_out","furnishing","after_sales","other"];
const transitions:Record<string,string[]>={requested:["reviewing","closed"],reviewing:["offered","closed"],offered:["in_progress","closed"],in_progress:["completed","closed"]};
const copy:Record<string,Record<string,string>>={
 ar:{journey:"إدارة رحلة الاستثمار",unit:"الوحدة",stage:"المرحلة",status:"الحالة",planned:"التاريخ المتوقع",actual:"التاريخ الفعلي",notes:"ملاحظات المرحلة",publish:"إظهار للعميل",save:"حفظ المرحلة",reservation:"الحجز",contract:"العقد",down_payment:"الدفعة الأولى",construction:"البناء",inspection:"المعاينة",handover:"التسليم",planned_status:"مخطط",in_progress:"جارٍ التنفيذ",completed:"مكتمل",benefits:"المزايا والخصومات المعتمدة",title:"عنوان الميزة",details:"الشروط الكاملة والموافقات",category:"نوع الميزة",valid:"صالحة حتى (اختياري)",create:"إضافة الميزة",visible:"منشورة",hidden:"مسودة",service:"طلبات خدمات العملاء",reply:"رد الإدارة وتفاصيل الخدمة",update:"تحديث الطلب",error:"تعذر إتمام العملية",success:"تم الحفظ",noRequests:"لا توجد طلبات",warning:"لا تنشر نسبة خصم أو موعدًا إلا بعد التأكد من اعتماده كتابيًا."},
 en:{journey:"Investment journey management",unit:"Unit",stage:"Stage",status:"Status",planned:"Planned date",actual:"Actual date",notes:"Milestone note",publish:"Publish to buyer",save:"Save milestone",reservation:"Reservation",contract:"Contract",down_payment:"Down payment",construction:"Construction",inspection:"Inspection",handover:"Handover",planned_status:"Planned",in_progress:"In progress",completed:"Completed",benefits:"Approved VIP benefits",title:"Benefit title",details:"Full benefit terms and approval details",category:"Benefit category",valid:"Valid until",create:"Add benefit",visible:"Published",hidden:"Draft",service:"Customer service requests",reply:"Management reply / service details",update:"Update request",error:"Operation failed",success:"Saved",noRequests:"No requests",warning:"Only publish benefits and dates approved in writing."},
 he:{journey:"ניהול מסלול השקעה",unit:"יחידה",stage:"שלב",status:"מצב",planned:"מתוכנן",actual:"בפועל",notes:"הערות",publish:"פרסום",save:"שמירה",reservation:"הזמנה",contract:"חוזה",down_payment:"מקדמה",construction:"בנייה",inspection:"בדיקה",handover:"מסירה",planned_status:"מתוכנן",in_progress:"בתהליך",completed:"הושלם",benefits:"הטבות מאושרות",title:"שם ההטבה",details:"תנאים",category:"סוג",valid:"תוקף",create:"הוספה",visible:"פורסם",hidden:"טיוטה",service:"בקשות שירות",reply:"תשובה",update:"עדכן",error:"שגיאה",success:"נשמר",noRequests:"אין בקשות",warning:"יש לפרסם רק נתונים מאושרים."},
 tr:{journey:"Yatırım aşamaları yönetimi",unit:"Ünite",stage:"Aşama",status:"Durum",planned:"Planlanan",actual:"Gerçekleşen",notes:"Notlar",publish:"Müşteriye göster",save:"Kaydet",reservation:"Rezervasyon",contract:"Sözleşme",down_payment:"Peşinat",construction:"İnşaat",inspection:"Kontrol",handover:"Teslim",planned_status:"Planlanan",in_progress:"Sürüyor",completed:"Tamamlandı",benefits:"Onaylı avantajlar",title:"Başlık",details:"Tüm şartlar",category:"Kategori",valid:"Geçerlilik",create:"Ekle",visible:"Yayımlandı",hidden:"Taslak",service:"Müşteri talepleri",reply:"Yönetim cevabı",update:"Güncelle",error:"Hata",success:"Kaydedildi",noRequests:"Talep yok",warning:"Sadece yazılı onaylı teklifleri yayımlayın."},
 az:{journey:"İnvestisiya mərhələlərinin idarəsi",unit:"Mənzil",stage:"Mərhələ",status:"Vəziyyət",planned:"Plan",actual:"Faktiki",notes:"Qeyd",publish:"Müştəriyə göstər",save:"Saxla",reservation:"Rezervasiya",contract:"Müqavilə",down_payment:"İlkin ödəniş",construction:"Tikinti",inspection:"Baxış",handover:"Təhvil",planned_status:"Plan",in_progress:"Davam edir",completed:"Tamamlandı",benefits:"Təsdiqlənmiş üstünlüklər",title:"Başlıq",details:"Tam şərtlər",category:"Kateqoriya",valid:"Son tarix",create:"Əlavə et",visible:"Dərc edilib",hidden:"Qaralama",service:"Müştəri sorğuları",reply:"Rəhbərliyin cavabı",update:"Yenilə",error:"Xəta",success:"Saxlandı",noRequests:"Sorğu yoxdur",warning:"Yalnız yazılı təsdiqlənmiş məlumatı dərc edin."}
};
const inputStyle="mt-2 block w-full rounded-lg border border-[#c6dfe0] bg-white p-3 text-sm";
const panelStyle="mt-8 rounded-2xl border border-[#d5e8e9] bg-white p-5 md:p-6";
async function api(path:string,method:"PUT"|"POST"|"PATCH",body:unknown){
 const r=await fetch(path,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 if(!r.ok)throw Error("Request failed");
 return r.json();
}
export default function VipExperienceAdmin(){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const qc=useQueryClient();
 const catalog=useQuery<{projects:Project[];units:Unit[]}>({
   queryKey:["vip","admin","projects"],
   queryFn:async()=>{const r=await fetch("/api/admin/vip/projects",{credentials:"include",cache:"no-store"});
     if(!r.ok)throw Error("Catalog unavailable");return r.json();},retry:false
 });
 const units=catalog.data?.units||[];
 const projects=catalog.data?.projects||[];
 const [unitChoice,setUnitChoice]=useState(""),[stage,setStage]=useState<string>("reservation");
 const [status,setStatus]=useState("planned"),[plannedDate,setPlannedDate]=useState(""),[actualDate,setActualDate]=useState("");
 const [note,setNote]=useState(""),[published,setPublished]=useState(false);
 const [title,setTitle]=useState(""),[details,setDetails]=useState(""),[category,setCategory]=useState("second_purchase"),[validUntil,setValidUntil]=useState("");
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [replyDraft,setReplyDraft]=useState<Record<string,string>>({});
 const unitId=units.some(u=>u.id===unitChoice)?unitChoice:units[0]?.id||"";
 const journey=useQuery<{milestones:Milestone[]}>({
  queryKey:["vip","admin","journey",unitId],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/units/"+encodeURIComponent(unitId)+"/journey",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!unitId,retry:false
 });
 const benefits=useQuery<{benefits:Benefit[]}>({
  queryKey:["vip","admin","benefits"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/benefits",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const services=useQuery<{requests:Service[]}>({
  queryKey:["vip","admin","services"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/services",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 function chooseStage(code:string){
  setStage(code);
  const m=journey.data?.milestones.find(x=>x.stage_code===code);
  setStatus(m?.status||"planned");setPlannedDate(m?.planned_date||"");setActualDate(m?.actual_date||"");
  setNote(m?.note||"");setPublished(m?.published||false);
 }
 async function act(run:()=>Promise<unknown>,after?:()=>void){
  if(busy)return;setBusy(true);setMessage("");
  try{await run();after?.();setMessage(t.success)}
  catch{setMessage(t.error)}finally{setBusy(false)}
 }
 function saveJourney(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!unitId)return;
  void act(async()=>{
   await api("/api/admin/vip/units/"+encodeURIComponent(unitId)+"/journey","PUT",
    {stage,status,plannedDate:plannedDate||null,actualDate:actualDate||null,note,published});
   await qc.invalidateQueries({queryKey:["vip","admin","journey",unitId]});
   await qc.invalidateQueries({queryKey:["vip","journey",unitId]});
  });
 }
 function saveBenefit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  void act(async()=>{
   await api("/api/admin/vip/benefits","POST",{title,details,category,validUntil:validUntil||null,published:false});
   await qc.invalidateQueries({queryKey:["vip","admin","benefits"]});
  },()=>{setTitle("");setDetails("");setValidUntil("");});
 }
 return <section>
  <div className={panelStyle}>
   <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold"><CalendarRange className="h-5 w-5 text-[#008b91]"/>{t.journey}</h2>
   <form className="grid gap-4 md:grid-cols-2" onSubmit={saveJourney}>
    <label className="text-sm">{t.unit}
     <select className={inputStyle} value={unitId} onChange={e=>{setUnitChoice(e.target.value);chooseStage("reservation")}}>
      {units.map(u=><option value={u.id} key={u.id}>{projects.find(p=>p.id===u.project_id)?.name} · {u.unit_number}</option>)}
     </select>
    </label>
    <label className="text-sm">{t.stage}
     <select value={stage} className={inputStyle} onChange={e=>chooseStage(e.target.value)}>
       {stages.map(s=><option key={s} value={s}>{t[s]}</option>)}
     </select>
    </label>
    <label className="text-sm">{t.status}
     <select className={inputStyle} value={status} onChange={e=>setStatus(e.target.value)}>
       <option value="planned">{t.planned_status}</option><option value="in_progress">{t.in_progress}</option><option value="completed">{t.completed}</option>
     </select>
    </label>
    <label className="text-sm">{t.planned}<input className={inputStyle} type="date" value={plannedDate} onChange={e=>setPlannedDate(e.target.value)}/></label>
    <label className="text-sm">{t.actual}<input className={inputStyle} type="date" value={actualDate} onChange={e=>setActualDate(e.target.value)} required={status==="completed"}/></label>
    <label className="text-sm">{t.notes}<textarea rows={2} className={inputStyle} maxLength={600} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={published} onChange={e=>setPublished(e.target.checked)}/>{t.publish}</label>
    <button type="submit" disabled={busy||!unitId} className="rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.save}</button>
   </form>
  </div>
  <div className={panelStyle}>
   <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Gift className="h-5 w-5 text-[#008b91]"/>{t.benefits}</h2>
   <p className="mb-4 text-xs text-[#69858e]">{t.warning}</p>
   <form onSubmit={saveBenefit} className="grid gap-3 md:grid-cols-2">
    <label className="text-sm">{t.title}<input value={title} onChange={e=>setTitle(e.target.value)} minLength={3} maxLength={120} required className={inputStyle}/></label>
    <label className="text-sm">{t.category}
     <select className={inputStyle} value={category} onChange={e=>setCategory(e.target.value)}>
      {categories.map(s=><option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
     </select>
    </label>
    <label className="text-sm">{t.valid}<input type="date" value={validUntil} onChange={e=>setValidUntil(e.target.value)} className={inputStyle}/></label>
    <label className="text-sm">{t.details}<textarea minLength={15} maxLength={1300} required rows={3} value={details} onChange={e=>setDetails(e.target.value)} className={inputStyle}/></label>
    <button type="submit" disabled={busy} className="rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.create}</button>
   </form>
   <div className="mt-5 grid gap-3 md:grid-cols-2">{benefits.data?.benefits.map(b=><div key={b.id} className="rounded-xl border border-[#dcebee] p-4 text-sm">
    <strong>{b.title}</strong><p className="mt-2 text-xs text-[#68858e]">{b.details}</p>
    <button disabled={busy} type="button" className="mt-3 rounded-lg border border-[#b6dcdc] px-3 py-2 text-xs"
     onClick={()=>void act(async()=>{
      await api("/api/admin/vip/benefits/"+encodeURIComponent(b.id),"PATCH",{published:!b.published});
      await qc.invalidateQueries({queryKey:["vip","admin","benefits"]});
      await qc.invalidateQueries({queryKey:["vip","benefits"]});
     })}>{b.published?t.visible:t.hidden} · {b.published?"Hide":"Publish"}</button>
   </div>)}</div>
  </div>
  <div className={panelStyle}>
   <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><LifeBuoy className="h-5 w-5 text-[#008b91]"/>{t.service}</h2>
   {!services.data?.requests.length?<p className="text-sm text-[#748e99]">{t.noRequests}</p>:
   <div className="space-y-3">{services.data.requests.map(r=><div key={r.id} className="rounded-xl border border-[#d8e8ea] p-4">
    <p className="text-sm font-semibold">{r.project_name} · {r.unit_number} — {r.service_type}</p>
    <p className="mt-1 text-xs text-[#66828d]">{r.customer_email} · {r.status}</p>
    <p className="mt-2 text-sm">{r.details}</p>
    {transitions[r.status]?.length?<div className="mt-3 grid gap-2 md:grid-cols-2">
      <textarea rows={2} minLength={5} maxLength={900} placeholder={t.reply} className={inputStyle}
       value={replyDraft[r.id]||""} onChange={e=>setReplyDraft(s=>({...s,[r.id]:e.target.value}))}/>
      <div className="flex flex-wrap gap-2 self-end">{transitions[r.status].map(next=>
       <button key={next} type="button" disabled={busy||(replyDraft[r.id]||"").trim().length<5}
        className="rounded-lg bg-[#005476] px-3 py-2 text-xs text-white disabled:opacity-50"
        onClick={()=>void act(async()=>{
         await api("/api/admin/vip/services/"+encodeURIComponent(r.id),"PATCH",{status:next,reply:replyDraft[r.id]});
         await qc.invalidateQueries({queryKey:["vip","admin","services"]});
        })}>{next.replace(/_/g," ")}</button>)}</div>
    </div>:r.admin_reply?<p className="mt-2 text-xs text-[#61818d]">{r.admin_reply}</p>:null}
   </div>)}</div>}
  </div>
  {message&&<p role="status" className="mt-4 text-sm text-[#005476]">{message}</p>}
 </section>;
}
