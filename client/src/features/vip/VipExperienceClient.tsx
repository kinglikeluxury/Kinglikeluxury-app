import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {CalendarCheck,CheckCircle2,Clock3,Gift,LifeBuoy,Route,ShieldCheck} from "lucide-react";

type Milestone={stage_code:string;status:string;planned_date:string|null;actual_date:string|null;note:string|null};
type Benefit={id:string;title:string;details:string;category:string;valid_until:string|null};
type Service={id:string;service_type:string;details:string;status:string;admin_reply:string|null;created_at:string};
type Translation={journey:string;planned:string;actual:string;benefits:string;benefitNote:string;services:string;serviceType:string;requestService:string;requestText:string;send:string;serviceNote:string;none:string;emptyJourney:string;error:string;success:string;states:Record<string,string>;stages:Record<string,string>;types:Record<string,string>};
const copy:Record<string,Translation>={
 ar:{journey:"رحلة استثمارك",planned:"الموعد المتوقع",actual:"التاريخ الفعلي",benefits:"مزايا KINGLIKE VIP المعتمدة",benefitNote:"تُطبق كل ميزة وفق الشروط المكتوبة وبعد موافقة الجهة المختصة؛ لا توجد خصومات تلقائية.",services:"خدمات ما بعد الشراء",serviceType:"نوع الخدمة",requestService:"طلب خدمة جديدة",requestText:"اكتب المطلوب بالتفصيل",send:"إرسال الطلب للإدارة",serviceNote:"الطلب لا يعتبر تأكيدًا للسعر أو بدء تنفيذ الخدمة. ستراجع الإدارة طلبك.",none:"لا توجد طلبات حتى الآن.",emptyJourney:"لم تُنشر مراحل هذا العقار بعد.",error:"تعذر تحميل المعلومات أو إرسال الطلب.",success:"تم إرسال طلبك للمراجعة.",states:{planned:"مخطط",in_progress:"جارٍ التنفيذ",completed:"مكتمل",requested:"بانتظار المراجعة",reviewing:"قيد الدراسة",offered:"تم تقديم عرض",closed:"مغلق"},stages:{reservation:"حجز الشقة",contract:"العقد",down_payment:"الدفعة الأولى",construction:"مراحل البناء",inspection:"معاينة الشقة",handover:"التسليم"},types:{fit_out:"تشطيب وتجهيز",furnishing:"تأثيث",utilities:"خدمات ومرافق",rental_management:"إدارة التأجير",other:"خدمة أخرى"}},
 en:{journey:"Your investment journey",planned:"Expected date",actual:"Actual date",benefits:"Approved KINGLIKE VIP benefits",benefitNote:"All benefits are subject to the published terms and approval. No discounts are automatic.",services:"After-sales services",serviceType:"Service type",requestService:"Request a service",requestText:"Describe your request",send:"Send request",serviceNote:"A request is not a quotation or service confirmation. Management will review it.",none:"No service requests yet.",emptyJourney:"No journey milestones published yet.",error:"Unable to load or submit.",success:"Request received for review.",states:{planned:"Planned",in_progress:"In progress",completed:"Complete",requested:"Requested",reviewing:"Reviewing",offered:"Offer sent",closed:"Closed"},stages:{reservation:"Reservation",contract:"Contract",down_payment:"Down payment",construction:"Construction",inspection:"Inspection",handover:"Handover"},types:{fit_out:"Fit-out",furnishing:"Furnishing",utilities:"Utilities",rental_management:"Rental management",other:"Other service"}},
 he:{journey:"מסלול ההשקעה",planned:"תאריך צפוי",actual:"תאריך בפועל",benefits:"הטבות VIP מאושרות",benefitNote:"כל ההטבות כפופות לתנאים ולאישור.",services:"שירותי לאחר רכישה",serviceType:"סוג שירות",requestService:"בקשת שירות",requestText:"תיאור הבקשה",send:"שליחה",serviceNote:"הבקשה אינה התחייבות למחיר או לביצוע.",none:"אין בקשות",emptyJourney:"אין שלבים שפורסמו.",error:"שגיאה",success:"הבקשה התקבלה.",states:{planned:"מתוכנן",in_progress:"בתהליך",completed:"הושלם",requested:"נשלח",reviewing:"בבדיקה",offered:"הצעה",closed:"סגור"},stages:{reservation:"הזמנה",contract:"חוזה",down_payment:"מקדמה",construction:"בנייה",inspection:"בדיקה",handover:"מסירה"},types:{fit_out:"גימור",furnishing:"ריהוט",utilities:"תשתיות",rental_management:"ניהול השכרה",other:"אחר"}},
 tr:{journey:"Yatırım yolculuğu",planned:"Beklenen tarih",actual:"Gerçek tarih",benefits:"Onaylı KINGLIKE VIP avantajları",benefitNote:"Avantajlar yazılı şartlara ve onaya tabidir.",services:"Satış sonrası hizmetler",serviceType:"Hizmet türü",requestService:"Hizmet iste",requestText:"Talebinizi açıklayın",send:"Gönder",serviceNote:"Talep fiyat veya uygulama onayı değildir.",none:"Henüz talep yok",emptyJourney:"Henüz aşama yayımlanmadı.",error:"İşlem başarısız",success:"Talep kaydedildi.",states:{planned:"Planlanan",in_progress:"Sürüyor",completed:"Tamamlandı",requested:"Talep edildi",reviewing:"İnceleniyor",offered:"Teklif",closed:"Kapandı"},stages:{reservation:"Rezervasyon",contract:"Sözleşme",down_payment:"İlk ödeme",construction:"İnşaat",inspection:"Kontrol",handover:"Teslim"},types:{fit_out:"İç mekan",furnishing:"Mobilya",utilities:"Altyapı",rental_management:"Kira yönetimi",other:"Diğer"}},
 az:{journey:"İnvestisiya mərhələləri",planned:"Planlaşdırılan tarix",actual:"Faktiki tarix",benefits:"Təsdiqlənmiş VIP üstünlükləri",benefitNote:"Üstünlüklər yalnız yazılı şərtlər və təsdiqlə keçərlidir.",services:"Satışdan sonrakı xidmətlər",serviceType:"Xidmət növü",requestService:"Xidmət istə",requestText:"Sorğunu izah edin",send:"Göndər",serviceNote:"Sorğu qiymət və ya işə başlama təsdiqi deyil.",none:"Sorğu yoxdur",emptyJourney:"Hələ mərhələ dərc edilməyib.",error:"Əməliyyat alınmadı",success:"Sorğu qəbul edildi.",states:{planned:"Planlaşdırılıb",in_progress:"Davam edir",completed:"Tamamlanıb",requested:"Sorğu",reviewing:"Baxılır",offered:"Təklif",closed:"Bağlı"},stages:{reservation:"Rezervasiya",contract:"Müqavilə",down_payment:"İlkin ödəniş",construction:"Tikinti",inspection:"Baxış",handover:"Təhvil"},types:{fit_out:"Təmir",furnishing:"Mebel",utilities:"Kommunal",rental_management:"İcarə idarəsi",other:"Digər"}}
};
const types=["fit_out","furnishing","utilities","rental_management","other"];
function useCopy(){const {i18n}=useTranslation();return copy[i18n.language.split("-")[0]]||copy.en;}
export function VipJourneyClient({unitId}:{unitId:string}){
 const t=useCopy();
 const query=useQuery<{milestones:Milestone[]}>({
  queryKey:["vip","journey",unitId],
  queryFn:async()=>{const r=await fetch("/api/vip/units/"+encodeURIComponent(unitId)+"/journey",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  retry:false,enabled:!!unitId
 });
 return <section className="mt-5 border-t border-[#dcebee] pt-5">
  <h4 className="mb-4 flex items-center gap-2 text-base font-semibold"><Route className="h-5 w-5 text-[#008b8f]"/>{t.journey}</h4>
  {query.isPending?<div className="h-14 animate-pulse rounded-xl bg-[#edf5f6]"/>:query.isError?<p role="alert" className="text-xs text-rose-700">{t.error}</p>:
   !query.data.milestones.length?<p className="text-sm text-[#78919a]">{t.emptyJourney}</p>:
   <div className="space-y-2 border-s-2 border-[#91dbd7] ps-4">
    {query.data.milestones.map(x=><div key={x.stage_code} className="rounded-xl bg-[#f5fafa] px-4 py-3">
      <div className="flex flex-wrap justify-between gap-2 text-sm">
       <strong>{t.stages[x.stage_code]||x.stage_code}</strong>
       <span className="flex items-center gap-1 text-xs text-[#277b83]">
        {x.status==="completed"?<CheckCircle2 className="h-4 w-4"/>:<Clock3 className="h-4 w-4"/>}{t.states[x.status]||x.status}
       </span>
      </div>
      {x.planned_date&&<p className="mt-2 text-xs text-[#718d98]">{t.planned}: {x.planned_date}</p>}
      {x.actual_date&&<p className="mt-1 text-xs text-[#557a86]">{t.actual}: {x.actual_date}</p>}
      {x.note&&<p className="mt-2 text-xs text-[#65838e]">{x.note}</p>}
    </div>)}
   </div>}
 </section>;
}
export function VipBenefitsClient(){
 const t=useCopy();
 const result=useQuery<{benefits:Benefit[]}>({
  queryKey:["vip","benefits"],
  queryFn:async()=>{const r=await fetch("/api/vip/benefits",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 if(result.isPending||result.isError||!result.data.benefits.length)return null;
 return <section className="mt-10">
  <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><Gift className="h-6 w-6 text-[#149f9f]"/>{t.benefits}</h2>
  <div className="grid gap-3 md:grid-cols-2">{result.data.benefits.map(b=><article key={b.id} className="rounded-xl border border-[#cee6e6] bg-white p-5">
   <h3 className="text-base font-semibold">{b.title}</h3>
   <p className="mt-2 whitespace-pre-line text-sm text-[#61808d]">{b.details}</p>
   {b.valid_until&&<p className="mt-3 text-xs text-[#678994]"><CalendarCheck className="me-1 inline h-4 w-4"/>{b.valid_until}</p>}
  </article>)}</div>
  <p className="mt-3 flex gap-2 text-xs text-[#77909a]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.benefitNote}</p>
 </section>;
}
export function VipServicesClient({unitId}:{unitId:string}){
 const t=useCopy(),qc=useQueryClient();
 const [type,setType]=useState("fit_out"),[details,setDetails]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const data=useQuery<{requests:Service[]}>({
  queryKey:["vip","services",unitId],
  queryFn:async()=>{const r=await fetch("/api/vip/units/"+encodeURIComponent(unitId)+"/services",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!unitId,retry:false
 });
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;setBusy(true);setMessage("");
  try{
    const r=await fetch("/api/vip/services",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({unitId:Number(unitId),type,details})});
    if(!r.ok)throw Error(t.error);
    setMessage(t.success);setDetails("");await qc.invalidateQueries({queryKey:["vip","services",unitId]});
  }catch{setMessage(t.error)}finally{setBusy(false)}
 }
 return <section className="mt-5 border-t border-[#dcebee] pt-5">
  <h4 className="mb-3 flex items-center gap-2 font-semibold"><LifeBuoy className="h-5 w-5 text-[#008b8f]"/>{t.services}</h4>
  <form className="rounded-xl bg-[#f4fafa] p-4" onSubmit={submit}>
    <label className="block text-sm">{t.serviceType}
     <select className="mt-2 block w-full rounded-lg border border-[#cfe0e2] bg-white p-3" value={type} onChange={e=>setType(e.target.value)}>
      {types.map(x=><option key={x} value={x}>{t.types[x]}</option>)}
     </select>
    </label>
    <label className="mt-3 block text-sm">{t.requestText}
      <textarea rows={2} required minLength={10} maxLength={1200} className="mt-2 block w-full rounded-lg border border-[#cfe0e2] bg-white p-3"
       value={details} onChange={e=>setDetails(e.target.value)}/>
    </label>
    <button type="submit" disabled={busy||details.trim().length<10} className="mt-3 rounded-lg bg-[#005476] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t.send}</button>
    {message&&<p role="status" className="mt-2 text-xs">{message}</p>}
  </form>
  {data.data?.requests.length?<div className="mt-3 space-y-2">{data.data.requests.map(r=>
   <div key={r.id} className="rounded-xl border border-[#e0edef] p-3 text-sm">
    <strong>{t.types[r.service_type]||r.service_type}</strong>
    <span className="ms-2 text-xs text-[#58828b]">{t.states[r.status]||r.status}</span>
    <p className="mt-2 text-xs text-[#718992]">{r.details}</p>
    {r.admin_reply&&<p className="mt-2 border-t border-[#e3eef0] pt-2 text-xs text-[#005476]">{r.admin_reply}</p>}
   </div>)}</div>:null}
  <p className="mt-3 text-xs text-[#76919a]">{t.serviceNote}</p>
 </section>;
}
