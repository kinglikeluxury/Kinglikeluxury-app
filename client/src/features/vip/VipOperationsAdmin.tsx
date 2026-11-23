import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {TrendingUp,History,Clock3,Users,LifeBuoy,Wallet,ShieldCheck,Inbox} from "lucide-react";
type Metrics={projects:number;units:number;clients:number;pending_receipts:number;pending_statements:number;pending_invitations:number;active_services:number;handovers_awaiting_keys:number;open_support:number;overdue_support:number;active_referrals:number;delayed_construction_stages:number};
type Currency={currency:string;overdue_installments:number;overdue_amount:string;total_outstanding:string;total_verified_paid:string};
type Event={id:string;actor_user_id:string|null;actor_email:string|null;event_type:string;unit_id:string|null;metadata:Record<string,unknown>;created_at:string};
const copy:Record<string,Record<string,string>>={
 ar:{title:"لوحة متابعة KINGLIKE VIP",clients:"عملاء VIP",units:"الوحدات",receipts:"إيصالات تنتظر التحقق",statements:"طلبات كشف رسمي",services:"خدمات مفتوحة",handover:"تسليم مفاتيح بانتظار الإكمال",support:"طلبات دعم مفتوحة",overdueSupport:"طلبات دعم متأخرة",delayed:"مراحل بناء تجاوزت موعدها",invitations:"دعوات لم تُفعّل",referrals:"إحالات قيد المتابعة",finance:"الأقساط حسب العملة",overdue:"أقساط متأخرة",overdueAmount:"مبالغ أقساط متأخرة",outstanding:"إجمالي المستحق",paid:"مدفوعات معتمدة",audit:"سجل النشاط الإداري",actor:"المستخدم",time:"التاريخ",event:"العملية",unit:"الوحدة",more:"تحميل أحداث أقدم",empty:"لا توجد أحداث",error:"تعذر تحميل التقرير",note:"الأرقام مستمدة من سجلات VIP فقط، وليست إجمالي مبيعات الشركة أو Zoho. لا تُجمع العملات المختلفة ولا تُحسب عمولات تلقائيًا."},
 en:{title:"KINGLIKE VIP Executive Overview",clients:"VIP clients",units:"Units",receipts:"Receipts awaiting review",statements:"Official statement requests",services:"Open service requests",handover:"Key handovers pending",support:"Open support tickets",overdueSupport:"Overdue support tickets",delayed:"Delayed construction milestones",invitations:"Unclaimed invitations",referrals:"Active referrals",finance:"Installments by currency",overdue:"Overdue installments",overdueAmount:"Overdue amount",outstanding:"Outstanding",paid:"Verified payments",audit:"Administrative audit trail",actor:"Actor",time:"Date",event:"Event",unit:"Unit",more:"Load older events",empty:"No events",error:"Report unavailable",note:"Figures are based on VIP records only, not all company/Zoho sales. Different currencies are never mixed; no commissions are calculated automatically."},
 he:{title:"לוח ניהול VIP",clients:"לקוחות",units:"דירות",receipts:"קבלות",statements:"דוחות",services:"שירותים",handover:"מסירה",support:"תמיכה",overdueSupport:"איחורים",delayed:"בנייה מתעכבת",invitations:"הזמנות",referrals:"הפניות",finance:"תשלומים",overdue:"באיחור",overdueAmount:"סכום איחור",outstanding:"יתרה",paid:"מאומת",audit:"יומן פעילות",actor:"משתמש",time:"זמן",event:"פעולה",unit:"יחידה",more:"עוד",empty:"אין אירועים",error:"שגיאה",note:"נתוני VIP בלבד."},
 tr:{title:"KINGLIKE VIP Yönetici Paneli",clients:"VIP müşterileri",units:"Üniteler",receipts:"İncelenecek dekontlar",statements:"Döküm talepleri",services:"Açık hizmetler",handover:"Anahtar teslimi",support:"Destek talepleri",overdueSupport:"Geciken destek",delayed:"Geciken inşaat",invitations:"Davetler",referrals:"Tavsiyeler",finance:"Döviz bazında taksitler",overdue:"Gecikmiş taksitler",overdueAmount:"Geciken tutar",outstanding:"Kalan",paid:"Onaylı ödeme",audit:"İşlem kayıtları",actor:"İşlemi yapan",time:"Tarih",event:"İşlem",unit:"Ünite",more:"Öncekileri yükle",empty:"Kayıt yok",error:"Rapor alınamadı",note:"Veriler yalnızca VIP kayıtlarına aittir, Zoho satış raporu değildir."},
 az:{title:"KINGLIKE VIP İdarə Paneli",clients:"VIP müştərilər",units:"Mənzillər",receipts:"Qəbzlər",statements:"Çıxarış sorğuları",services:"Açıq xidmətlər",handover:"Açar təhvili",support:"Dəstək sorğuları",overdueSupport:"Gecikən dəstək",delayed:"Tikinti gecikməsi",invitations:"Dəvətlər",referrals:"Tövsiyələr",finance:"Valyuta üzrə ödənişlər",overdue:"Gecikmə",overdueAmount:"Gecikən məbləğ",outstanding:"Qalıq",paid:"Təsdiqlənmiş",audit:"Fəaliyyət jurnalı",actor:"İcraçı",time:"Tarix",event:"Hadisə",unit:"Mənzil",more:"Əvvəlki qeydlər",empty:"Qeyd yoxdur",error:"Hesabat mövcud deyil",note:"Yalnız VIP məlumatlarıdır, Zoho satış hesabatı deyil."}
};
export default function VipOperationsAdmin(){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const [older,setOlder]=useState<Event[]>([]),[before,setBefore]=useState<string|null>(null);
 const [auditBusy,setAuditBusy]=useState(false),[auditFail,setAuditFail]=useState(false);
 const report=useQuery<{metrics:Metrics;currencies:Currency[];asOf:string}>({
  queryKey:["vip","admin","insights"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/insights",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const audit=useQuery<{events:Event[];nextCursor:string|null}>({
  queryKey:["vip","admin","audit"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/audit",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const metrics=[
  ["clients",Users,"clients"],["units",Inbox,"units"],["receipts",Wallet,"pending_receipts"],
  ["statements",Wallet,"pending_statements"],["services",LifeBuoy,"active_services"],["handover",Clock3,"handovers_awaiting_keys"],
  ["support",LifeBuoy,"open_support"],["overdueSupport",Clock3,"overdue_support"],
  ["delayed",Clock3,"delayed_construction_stages"],["invitations",Inbox,"pending_invitations"],["referrals",Users,"active_referrals"]
 ] as const;
 const eventList=[...(audit.data?.events||[]),...older];
 const cursor=before||audit.data?.nextCursor;
 async function loadMore(){
  if(!cursor||auditBusy)return;
  setAuditBusy(true);setAuditFail(false);
  try{
   const r=await fetch("/api/admin/vip/audit?before="+encodeURIComponent(cursor),{credentials:"include",cache:"no-store"});
   if(!r.ok)throw Error("Unavailable");
   const next=await r.json() as {events:Event[];nextCursor:string|null};
   setOlder(x=>[...x,...next.events]);setBefore(next.nextCursor||"END");
  }catch{setAuditFail(true)}finally{setAuditBusy(false)}
 }
 return <section className="mt-9 space-y-6">
  <div className="rounded-2xl border border-[#d5e8ea] bg-white p-5 md:p-6">
   <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><TrendingUp className="h-6 w-6 text-[#008d91]"/>{t.title}</h2>
   {report.isError?<p role="alert" className="text-sm text-rose-700">{t.error}</p>:
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{metrics.map(([key,Icon,field])=>
     <div key={key} className="rounded-xl border border-[#d7e8e9] bg-[#f7fbfb] p-4">
      <Icon className="h-5 w-5 text-[#008d91]"/>
      <p className="mt-2 text-xs text-[#6a8792]">{t[key]}</p>
      <p className="mt-1 text-2xl font-bold">{report.data?.metrics[field]??"—"}</p>
     </div>)}</div>}
   {!!report.data?.currencies.length&&<div className="mt-6">
    <h3 className="mb-3 font-semibold">{t.finance}</h3>
    <div className="grid gap-3 md:grid-cols-3">{report.data.currencies.map(c=><div key={c.currency} className="rounded-xl border border-[#dcebee] p-4 text-sm">
      <strong className="text-base">{c.currency}</strong>
      <p className="mt-2">{t.overdue}: {c.overdue_installments}</p>
      <p>{t.overdueAmount}: {c.overdue_amount}</p>
      <p>{t.outstanding}: {c.total_outstanding}</p>
      <p>{t.paid}: {c.total_verified_paid}</p>
     </div>)}</div>
   </div>}
   <p className="mt-4 flex gap-2 text-xs text-[#718c96]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.note}</p>
  </div>
  <div className="rounded-2xl border border-[#d5e8ea] bg-white p-5 md:p-6">
   <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><History className="h-5 w-5 text-[#008d91]"/>{t.audit}</h2>
   {audit.isError?<p role="alert">{t.error}</p>:eventList.length===0?<p className="text-sm">{t.empty}</p>:
    <div className="max-h-96 space-y-2 overflow-y-auto">{eventList.map(e=><div key={e.id} className="rounded-xl border border-[#e0ebec] px-4 py-3">
     <div className="flex flex-wrap justify-between gap-2 text-sm">
      <strong>{e.event_type}</strong>
      <span className="text-xs text-[#738d98]">{new Date(e.created_at).toLocaleString(i18n.language)}</span>
     </div>
     <p className="mt-1 text-xs text-[#718c96]">{t.actor}: {e.actor_email||e.actor_user_id||"system"}{e.unit_id?" · "+t.unit+": "+e.unit_id:""}</p>
     <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-words text-xs text-[#64808b]">{JSON.stringify(e.metadata)}</pre>
    </div>)}</div>}
   {cursor&&cursor!=="END"&&<button type="button" disabled={auditBusy} onClick={()=>void loadMore()}
    className="mt-4 rounded-lg border border-[#9bcfd0] px-4 py-2 text-sm font-semibold text-[#005476] disabled:opacity-50">{t.more}</button>}
   {auditFail&&<p role="alert" className="mt-2 text-xs text-rose-700">{t.error}</p>}
  </div>
 </section>;
}
