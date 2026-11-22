import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useState} from "react";
import {useTranslation} from "react-i18next";
import {Bell,CalendarClock,CheckCheck} from "lucide-react";
type Notice={id:string;unit_id:string|null;title:string;body:string;event_type:string;payload?:{projectName?:string;unitNumber?:string;dueDate?:string};created_at:string;read_at:string|null};
type Due={installment_id:string;unit_id:string;due_date:string;amount:string;remaining:string;currency:string;project_name:string;unit_number:string};
const texts:Record<string,Record<string,string>>={
 ar:{title:"إشعارات KINGLIKE VIP",due:"أقساط تستحق خلال يومين",remains:"المتبقي",read:"تحديد كمقروء",empty:"لا توجد إشعارات حاليًا.",notice:"هذه تنبيهات تظهر داخل حسابك عند فتحه؛ إشعارات الهاتف وواتساب لم تُفعّل بعد.",error:"تعذر تحميل الإشعارات",pref:"تذكيري بالأقساط داخل VIP قبل الاستحقاق بيومين",dueReminderTitle:"موعد القسط بعد يومين",dueReminderBody:"القسط يستحق قريبًا. راجع حسابك للاطلاع على المبلغ المتبقي.",prefError:"تعذر حفظ تفضيلات الإشعارات"},
 en:{title:"KINGLIKE VIP notifications",due:"Installments due within two days",remains:"Outstanding",read:"Mark read",empty:"No notifications yet.",notice:"These reminders appear when you open VIP. Push, email and WhatsApp reminders are not enabled.",error:"Notifications unavailable",pref:"Send me in-app reminders two days before installments",dueReminderTitle:"Installment due in two days",dueReminderBody:"An installment is coming due. Check your account for the current outstanding amount.",prefError:"Could not save notification preference"},
 he:{title:"התראות KINGLIKE VIP",due:"תשלומים ביומיים הקרובים",remains:"יתרה",read:"סמן כנקרא",empty:"אין התראות",notice:"התראות מוצגות בחשבון בלבד.",error:"לא ניתן לטעון התראות",pref:"תזכורת על תשלום יומיים לפני המועד",dueReminderTitle:"תשלום בעוד יומיים",dueReminderBody:"בדוק את יתרת התשלום בחשבונך.",prefError:"לא ניתן לשמור את ההגדרה"},
 tr:{title:"KINGLIKE VIP bildirimler",due:"İki gün içinde vadesi dolacak taksitler",remains:"Kalan",read:"Okundu işaretle",empty:"Henüz bildirim yok.",notice:"Bildirimler yalnızca VIP açıldığında görünür. Telefon ve WhatsApp henüz etkin değil.",error:"Bildirimler yüklenemiyor",pref:"Taksitlerden iki gün önce uygulama içi hatırlat",dueReminderTitle:"Taksit iki gün sonra",dueReminderBody:"Güncel bakiyenizi hesapta kontrol edin.",prefError:"Bildirim tercihi kaydedilemedi"},
 az:{title:"KINGLIKE VIP bildirişlər",due:"İki gün ərzində ödənişlər",remains:"Qalıq",read:"Oxunmuş işarələ",empty:"Bildiriş yoxdur.",notice:"Xatırlatmalar yalnızca VIP daxilində görünür. WhatsApp hələ aktiv deyil.",error:"Bildirişlər yüklənmir",pref:"Ödənişdən iki gün əvvəl VIP daxilində xatırlat",dueReminderTitle:"İki gün sonra ödəniş",dueReminderBody:"Cari qalığı hesabınızda yoxlayın.",prefError:"Bildiriş tənzimləməsi saxlanılmadı"}
};
export default function VipNotificationsClient(){
 const {i18n}=useTranslation();const t=texts[i18n.language.split("-")[0]]||texts.en;
 const qc=useQueryClient();const [prefsBusy,setPrefsBusy]=useState(false);const [prefsError,setPrefsError]=useState("");
 const preferences=useQuery<{inAppDueReminders:boolean}>({
  queryKey:["vip","notification-preferences"],
  queryFn:async()=>{const r=await fetch("/api/vip/notification-preferences",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  retry:false
 });
 async function savePreference(value:boolean){
   setPrefsBusy(true);setPrefsError("");
   try{
    const r=await fetch("/api/vip/notification-preferences",{
      method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({inAppDueReminders:value})
    });
    if(!r.ok)throw Error("Unavailable");
    await qc.invalidateQueries({queryKey:["vip","notification-preferences"]});
   }catch{setPrefsError(t.prefError)}finally{setPrefsBusy(false)}
 }
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
  {preferences.isSuccess&&<label className="mb-4 flex items-center gap-3 rounded-xl border border-[#dce9ea] bg-white px-4 py-3 text-sm">
    <input type="checkbox" checked={preferences.data.inAppDueReminders} disabled={prefsBusy}
      onChange={e=>void savePreference(e.target.checked)}/><span>{t.pref}</span>
  </label>}
  {prefsError&&<p role="alert" className="mb-3 text-xs text-rose-700">{prefsError}</p>}
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
        <h3 className="text-sm font-semibold">{n.event_type==="due_reminder"?t.dueReminderTitle:n.title}</h3>
        {!n.read_at&&<button type="button" onClick={()=>void mark(n.id)}
          className="inline-flex items-center gap-1 text-xs font-medium text-[#005476]">
          <CheckCheck className="h-4 w-4"/>{t.read}</button>}
       </div>
       <p className="mt-2 whitespace-pre-line text-sm text-[#536f7b]">{n.event_type==="due_reminder"
        ? ((n.payload?.projectName||"")+" · "+(n.payload?.unitNumber||"")+" · "+(n.payload?.dueDate||"")+". "+t.dueReminderBody)
        : n.body}</p>
       <p className="mt-2 text-xs text-[#75919b]">{new Date(n.created_at).toLocaleDateString(i18n.language)}</p>
      </article>)}
   </div>}
  <p className="mt-4 text-xs leading-relaxed text-[#6d8792]">{t.notice}</p>
 </section>;
}
