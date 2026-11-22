import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Gift,UserCheck,ShieldCheck} from "lucide-react";
type Referral={id:string;lead_name:string;lead_phone_e164:string;status:string;created_at:string;sale_reference:string|null;referrer_email:string;reward_status:string|null;reward_description:string|null};
const l:Record<string,Record<string,string>>={
 ar:{title:"مراجعة الترشيحات والمكافآت",client:"العميل المُرشِّح",lead:"العميل المحتمل",phone:"رقم التواصل",new:"جديد",contacted:"تم التواصل",qualified:"مهتم",converted:"صفقة موثقة",declined:"مغلق",proposed:"مكافأة مقترحة",approved:"مكافأة معتمدة",fulfilled:"تم تسليم المكافأة",update:"تحديث حالة الترشيح",sale:"مرجع الصفقة المؤكدة",reward:"وصف المكافأة المقترحة",propose:"اقتراح مكافأة",approve:"اعتماد المكافأة",reject:"رفض المكافأة",fulfill:"تأكيد تسليم المكافأة",error:"تعذر إتمام العملية",empty:"لا توجد ترشيحات",note:"لا تُمنح مكافأة تلقائيًا؛ يجب توثيق الصفقة أولًا ثم مراجعة المقترح واعتماده إداريًا.",saving:"جارٍ الحفظ..."},
 en:{title:"Referral and reward review",client:"Referrer",lead:"Referred contact",phone:"Phone",new:"New",contacted:"Contacted",qualified:"Qualified",converted:"Sale recorded",declined:"Closed",proposed:"Proposed reward",approved:"Approved reward",fulfilled:"Delivered reward",update:"Update referral",sale:"Verified sale reference",reward:"Proposed reward description",propose:"Propose reward",approve:"Approve reward",reject:"Decline reward",fulfill:"Mark fulfilled",error:"Action failed",empty:"No referrals",note:"Rewards require a recorded sale reference and explicit administrative approval.",saving:"Saving..."},
 he:{title:"בדיקת הפניות ותגמולים",client:"מפנה",lead:"לקוח פוטנציאלי",phone:"טלפון",new:"חדש",contacted:"נוצר קשר",qualified:"מעוניין",converted:"עסקה",declined:"נסגר",proposed:"תגמול מוצע",approved:"תגמול אושר",fulfilled:"תגמול נמסר",update:"עדכון מצב",sale:"מזהה עסקה",reward:"תיאור התגמול",propose:"הצע תגמול",approve:"אשר",reject:"דחה",fulfill:"סמן כנמסר",error:"הפעולה נכשלה",empty:"אין הפניות",note:"תגמול מותנה באישור מפורש.",saving:"שומר..."},
 tr:{title:"Tavsiye ve ödül inceleme",client:"Tavsiye eden",lead:"Potansiyel müşteri",phone:"Telefon",new:"Yeni",contacted:"İletişim kuruldu",qualified:"İlgileniyor",converted:"Satış kaydı",declined:"Kapalı",proposed:"Öneri",approved:"Onaylandı",fulfilled:"Teslim edildi",update:"Durumu güncelle",sale:"Satış referansı",reward:"Ödül açıklaması",propose:"Ödül öner",approve:"Onayla",reject:"Reddet",fulfill:"Teslim edildi",error:"İşlem başarısız",empty:"Tavsiye yok",note:"Ödül için satış kaydı ve yönetim onayı gerekir.",saving:"Kaydediliyor..."},
 az:{title:"Tövsiyə və mükafat yoxlaması",client:"Tövsiyə edən",lead:"Potensial müştəri",phone:"Telefon",new:"Yeni",contacted:"Əlaqə saxlanıldı",qualified:"Maraqlıdır",converted:"Satış qeydi",declined:"Bağlandı",proposed:"Təklif",approved:"Təsdiqləndi",fulfilled:"Təqdim edildi",update:"Statusu dəyiş",sale:"Satış istinadı",reward:"Mükafat təsviri",propose:"Mükafat təklif et",approve:"Təsdiq et",reject:"Rədd et",fulfill:"Təqdim edilib",error:"Əməliyyat alınmadı",empty:"Tövsiyə yoxdur",note:"Satış istinadı və rəhbərlik təsdiqi olmadan mükafat verilmir.",saving:"Yadda saxlanılır"}
};
export default function VipReferralsAdmin(){
 const {i18n}=useTranslation();const t=l[i18n.language.split("-")[0]]||l.en;
 const qc=useQueryClient();const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 const [saleReferences,setSaleReferences]=useState<Record<string,string>>({});
 const [descriptions,setDescriptions]=useState<Record<string,string>>({});
 const data=useQuery<{referrals:Referral[]}>({
  queryKey:["vip","admin","referrals"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/referrals",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  retry:false
 });
 async function update(path:string,method:"POST"|"PATCH",body:unknown){
  if(busy)return;setBusy(true);setMessage("");
  try{
   const r=await fetch(path,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   if(!r.ok)throw Error(t.error);
   await qc.invalidateQueries({queryKey:["vip","admin","referrals"]});
   await qc.invalidateQueries({queryKey:["vip","referrals"]});
   setMessage("✓");
  }catch{setMessage(t.error)}finally{setBusy(false)}
 }
 function status(id:string,status:string){
  return update("/api/admin/vip/referrals/"+encodeURIComponent(id),"PATCH",{status,
    ...(status==="converted"?{saleReference:saleReferences[id]}:{})});
 }
 function reward(id:string,description:string){
  return update("/api/admin/vip/referrals/"+encodeURIComponent(id)+"/reward","POST",{description});
 }
 function rewardStatus(id:string,status:string){
  return update("/api/admin/vip/referrals/"+encodeURIComponent(id)+"/reward","PATCH",{status});
 }
 return <section className="mt-9 rounded-2xl border border-[#d6e8e9] bg-white p-5 md:p-6">
  <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold"><Gift className="h-6 w-6 text-[#008c93]"/>{t.title}</h2>
  <p className="mb-5 flex items-start gap-2 text-xs leading-relaxed text-[#66838f]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.note}</p>
  {message&&<p role="status" className="mb-4 text-sm text-[#005476]">{message}</p>}
  {data.isPending?<p>…</p>:data.isError?<p role="alert" className="text-rose-800">{t.error}</p>:
   data.data.referrals.length===0?<p className="text-sm text-[#77909a]">{t.empty}</p>:
   <div className="space-y-4">{data.data.referrals.map(r=><article key={r.id} className="rounded-xl border border-[#d9e9eb] p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
     <div>
      <p className="text-xs text-[#66818a]">{t.client}: {r.referrer_email}</p>
      <p className="mt-2 font-semibold">{r.lead_name}</p>
      <p dir="ltr" className="mt-1 text-sm text-[#005476]">{r.lead_phone_e164}</p>
     </div>
     <span className="rounded-full bg-[#e7f4f3] px-3 py-1 text-xs text-[#00666c]">{t[r.status]||r.status}</span>
    </div>
    <div className="mt-4 space-y-3">
     {(r.status==="new"||r.status==="contacted"||r.status==="qualified")&&<div className="flex flex-wrap gap-2">
       {r.status==="new"&&<button type="button" disabled={busy} onClick={()=>status(r.id,"contacted")} className="rounded-lg border border-[#9ed4d1] px-3 py-2 text-xs font-semibold text-[#005476] disabled:opacity-50">{t.contacted}</button>}
       {r.status==="contacted"&&<button type="button" disabled={busy} onClick={()=>status(r.id,"qualified")} className="rounded-lg border border-[#9ed4d1] px-3 py-2 text-xs font-semibold text-[#005476] disabled:opacity-50">{t.qualified}</button>}
       <button type="button" disabled={busy} onClick={()=>status(r.id,"declined")} className="rounded-lg border border-rose-300 px-3 py-2 text-xs text-rose-800 disabled:opacity-50">{t.declined}</button>
     </div>}
     {r.status==="qualified"&&<div className="flex flex-col gap-2 sm:flex-row">
       <label className="flex-1 text-xs">{t.sale}
        <input value={saleReferences[r.id]||""} onChange={e=>setSaleReferences(x=>({...x,[r.id]:e.target.value}))}
         className="mt-1 w-full rounded-lg border border-[#c8e0e2] p-2"/>
       </label>
       <button type="button" disabled={busy||!/^[-a-zA-Z0-9_/]{6,80}$/.test(saleReferences[r.id]||"")}
         onClick={()=>status(r.id,"converted")} className="self-end rounded-lg bg-[#005476] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
         {t.converted}
       </button>
     </div>}
     {r.status==="converted"&&<p className="text-xs text-[#69858d]">{t.sale}: {r.sale_reference}</p>}
     {r.status==="converted"&&!r.reward_status&&<div className="flex flex-wrap items-end gap-2 border-t border-[#e0eff0] pt-4">
       <label className="flex-1 text-xs">{t.reward}
        <input value={descriptions[r.id]||""} onChange={e=>setDescriptions(x=>({...x,[r.id]:e.target.value}))}
         className="mt-1 w-full rounded-lg border border-[#c8e0e2] p-2" maxLength={250}/>
       </label>
       <button type="button" disabled={busy||(descriptions[r.id]||"").trim().length<8}
        onClick={()=>reward(r.id,descriptions[r.id])} className="rounded-lg bg-[#005476] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{t.propose}</button>
     </div>}
     {r.reward_status&&<div className="border-t border-[#e0eff0] pt-3">
      <p className="text-sm font-semibold text-[#005476]">{t[r.reward_status]||r.reward_status}</p>
      <p className="mt-1 text-xs text-[#67858e]">{r.reward_description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
       {r.reward_status==="proposed"&&<>
        <button disabled={busy} type="button" className="rounded-lg bg-[#005476] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
         onClick={()=>rewardStatus(r.id,"approved")}>{t.approve}</button>
        <button disabled={busy} type="button" className="rounded-lg border border-rose-300 px-3 py-2 text-xs text-rose-800 disabled:opacity-50"
         onClick={()=>rewardStatus(r.id,"declined")}>{t.reject}</button>
       </>}
       {r.reward_status==="approved"&&<button disabled={busy} type="button" className="rounded-lg border border-[#9ed4d1] px-3 py-2 text-xs font-semibold text-[#005476] disabled:opacity-50"
         onClick={()=>rewardStatus(r.id,"fulfilled")}>{t.fulfill}</button>}
      </div>
     </div>}
    </div>
   </article>)}</div>}
 </section>;
}
