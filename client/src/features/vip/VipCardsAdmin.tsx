import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Crown,ShieldCheck} from "lucide-react";
type VipCard={user_id:string;email:string;member_code:string;tier:string;is_active:boolean;created_at:string};
const copy:Record<string,Record<string,string>>={
 ar:{title:"إدارة بطاقات KINGLIKE VIP",client:"العميل",tier:"الفئة",status:"حالة البطاقة",active:"فعالة",revoked:"ملغاة",save:"تحديث الفئة",revoke:"إلغاء البطاقة",empty:"لم يتم إصدار بطاقات بعد.",error:"تعذر تحديث البطاقة",notice:"تغيير الفئة لا يمنح مزايا أو خصومات تلقائيًا. البطاقة الملغاة لا يعاد تفعيلها دون إصدار رمز جديد.",saving:"جارٍ الحفظ..."},
 en:{title:"KINGLIKE VIP card management",client:"Client",tier:"Tier",status:"Card status",active:"Active",revoked:"Revoked",save:"Update tier",revoke:"Revoke card",empty:"No cards issued yet.",error:"Card could not be updated",notice:"Tiers do not grant automatic benefits. Revoked cards require a new code.",saving:"Saving..."},
 he:{title:"ניהול כרטיסי VIP",client:"לקוח",tier:"דרגה",status:"מצב",active:"פעיל",revoked:"בוטל",save:"עדכון דרגה",revoke:"ביטול",empty:"אין כרטיסים.",error:"עדכון נכשל",notice:"אין הטבות אוטומטיות.",saving:"שומר..."},
 tr:{title:"VIP kart yönetimi",client:"Müşteri",tier:"Seviye",status:"Durum",active:"Aktif",revoked:"İptal",save:"Seviyeyi güncelle",revoke:"Kartı iptal et",empty:"Henüz kart yok.",error:"Kart güncellenemedi",notice:"Kart seviyeleri otomatik avantaj sağlamaz.",saving:"Kaydediliyor..."},
 az:{title:"VIP kart idarəetməsi",client:"Müştəri",tier:"Səviyyə",status:"Vəziyyət",active:"Aktiv",revoked:"Ləğv edilib",save:"Səviyyəni yenilə",revoke:"Kartı ləğv et",empty:"Kart yoxdur.",error:"Yenilənmə alınmadı",notice:"Səviyyələr avtomatik güzəşt vermir.",saving:"Yadda saxlanılır"}
};
export default function VipCardsAdmin(){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const qc=useQueryClient();
 const [busy,setBusy]=useState(false);const [changes,setChanges]=useState<Record<string,string>>({});const [message,setMessage]=useState("");
 const data=useQuery<{cards:VipCard[]}>({
  queryKey:["vip","admin","cards"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/cards",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  retry:false
 });
 async function update(c:VipCard,isActive:boolean){
  if(busy)return;
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/admin/vip/cards/"+encodeURIComponent(c.user_id),{
    method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({tier:changes[c.user_id]||c.tier,isActive})
   });
   if(!r.ok)throw Error(t.error);
   await Promise.all([
    qc.invalidateQueries({queryKey:["vip","admin","cards"]}),
    qc.invalidateQueries({queryKey:["vip","card"]})
   ]);
   setMessage("✓");
  }catch{setMessage(t.error)}
  finally{setBusy(false)}
 }
 return <section className="mt-9 rounded-2xl border border-[#d8e8e9] bg-white p-5 md:p-6">
  <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold"><Crown className="h-6 w-6 text-[#008c93]"/>{t.title}</h2>
  <p className="mb-5 flex items-start gap-2 text-xs leading-relaxed text-[#66838f]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.notice}</p>
  {message&&<p role="status" className="mb-3 text-sm text-[#005476]">{message}</p>}
  {data.isPending?<p>…</p>:data.isError?<p role="alert" className="text-rose-800">{t.error}</p>:
   data.data.cards.length===0?<p className="text-sm text-[#718a94]">{t.empty}</p>:
   <div className="grid gap-3 md:grid-cols-2">{data.data.cards.map(c=>
    <article key={c.user_id} className="rounded-xl border border-[#dbe9e9] p-4">
      <p className="break-all text-sm font-semibold">{c.email}</p>
      <p dir="ltr" className="mt-2 font-mono text-xs text-[#76919a]">{c.member_code}</p>
      <div className="mt-3 flex flex-wrap items-end gap-2">
       <label className="flex-1 text-xs">{t.tier}
        <select value={changes[c.user_id]||c.tier} disabled={!c.is_active}
         onChange={e=>setChanges(s=>({...s,[c.user_id]:e.target.value}))}
         className="mt-1 w-full rounded-lg border border-[#d4e4e5] p-2">
         {["VIP","Silver","Gold","Platinum"].map(x=><option key={x} value={x}>{x}</option>)}
        </select>
       </label>
       {c.is_active&&<button type="button" disabled={busy} onClick={()=>update(c,true)}
         className="rounded-lg bg-[#005476] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{t.save}</button>}
      </div>
      <p className="mt-3 text-xs text-[#64828c]">{t.status}: {c.is_active?t.active:t.revoked}</p>
      {c.is_active&&<button type="button" disabled={busy} onClick={()=>update(c,false)}
       className="mt-3 rounded-lg border border-rose-300 px-3 py-2 text-xs text-rose-800 disabled:opacity-50">{t.revoke}</button>}
    </article>)}</div>}
 </section>;
}
