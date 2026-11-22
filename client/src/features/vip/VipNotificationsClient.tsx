import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Bell,CalendarClock,CheckCheck} from "lucide-react";
type Notice={id:string;unit_id:string|null;title:string;body:string;created_at:string;read_at:string|null};
type Due={installment_id:string;unit_id:string;due_date:string;amount:string;remaining:string;currency:string;project_name:string;unit_number:string};
const texts:Record<string,Record<string,string>>={
 ar:{title:"إشعارات KINGLIKE VIP",due:"أقساط تستحق خلال يومين",remains:"المتبقي",read:"تحديد كمقروء",empty:"لا توجد إشعارات حاليًا.",notice:"هذه تنبيهات تظهر داخل حسابك عند فتحه؛ إشعارات الهاتف وواتساب لم تُفعّل بعد.",error:"تعذر تحميل الإشعارات"},
 en:{title:"KINGLIKE VIP notifications",due:"Installments due within two days",remains:"Outstanding",read:"Mark read",empty:"No notifications yet.",notice:"These reminders appear when you open VIP. Push, email and WhatsApp reminders are not enabled.",error:"Notifications unavailable"},
 he:{title:"התראות KINGLIKE VIP",due:"תשלומים ביומיים הקרובים",remains:"יתרה",read:"סמן כנקרא",empty:"אין התראות",notice:"התראות מוצגות בחשבון בלבד.",error:"לא ניתן לטעון התראות"},
 tr:{title:"KINGLIKE VIP bildirimler",due:"İki gün içinde vadesi dolacak taksitler",remains:"Kalan",read:"Okundu işaretle",empty:"Henüz bildirim yok.",notice:"Bildirimler yalnızca VIP açıldığında görünür. Telefon ve WhatsApp henüz etkin değil.",error:"Bildirimler yüklenemiyor"},
 az:{title:"KINGLIKE VIP bildirişlər",due:"İki gün ərzində ödənişlər",remains:"Qalıq",read:"Oxunmuş işarələ",empty:"Bildiriş yoxdur.",notice:"Xatırlatmalar yalnızca VIP daxilində görünür. WhatsApp hələ aktiv deyil.",error:"Bildirişlər yüklənmir"}
};
export default function VipNotificationsClient(){
 const {i18n}=useTranslation();const t=texts[i18n.language.split("-")[0]]||texts.en;
 const qc=useQueryClient();
 const query=useQuery<{notifications:Notice[];dueSoon:Due[]}>({
  queryKey:["vip","notifications"],
  queryFn:async()=>{const r=await fetch("/api/vip/notifications",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  retry:false
 });
 async function mark(id:string){
   const r=await fetch("/api/vip/notifications/"+encodeURIComponent(id)+"/read",{
    method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{}"
   });
   if(r.ok)await qc.invalidateQueries({queryKey:["vip","notifications"]});
 }
 return <section className="mt-10">
  <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><Bell className="h-6 w-6 text-[#008c93]"/>{t.title}</h2>
  {query.isPending?<p className="text-sm">…</p>:query.isError?<p role="alert" className="text-rose-700">{t.error}</p>:
   <div className="space-y-3">
    {query.data.dueSoon.length>0&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-900"><CalendarClock className="h-5 w-5"/>{t.due}</h3>
      {query.data.dueSoon.map(d=><p key={d.installment_id} className="mb-2 text-sm text-amber-950">
       {d.project_name} · {d.unit_number} — <strong>{d.due_date}</strong>
       <span className="block text-xs">{t.remains}: {d.remaining} {d.currency}</span>
      </p>)}
    </div>}
    {query.data.notifications.length===0&&query.data.dueSoon.length===0&&
     <p className="rounded-xl border border-[#d9e8e9] bg-white p-5 text-sm text-[#708a95]">{t.empty}</p>}
    {query.data.notifications.map(n=><article key={n.id}
      className={"rounded-xl border p-4 "+(n.read_at?"border-[#e1eaeb] bg-white":"border-[#a4d7d4] bg-[#edf9f7]")}>
       <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{n.title}</h3>
        {!n.read_at&&<button type="button" onClick={()=>void mark(n.id)}
          className="inline-flex items-center gap-1 text-xs font-medium text-[#005476]">
          <CheckCheck className="h-4 w-4"/>{t.read}</button>}
       </div>
       <p className="mt-2 whitespace-pre-line text-sm text-[#536f7b]">{n.body}</p>
       <p className="mt-2 text-xs text-[#75919b]">{new Date(n.created_at).toLocaleDateString(i18n.language)}</p>
      </article>)}
   </div>}
  <p className="mt-4 text-xs leading-relaxed text-[#6d8792]">{t.notice}</p>
 </section>;
}
