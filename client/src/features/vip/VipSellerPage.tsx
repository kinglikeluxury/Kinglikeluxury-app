import {useState} from "react";
import {useQuery} from "@tanstack/react-query";
import {useAuth} from "@/lib/auth";
import {useTranslation} from "react-i18next";
import {Link} from "wouter";
import {BriefcaseBusiness,Building2,CalendarClock,FileDown,FileText,LockKeyhole,ReceiptText,ShieldCheck} from "lucide-react";

type Unit={unit_id:string;unit_number:string;floor_number:number|null;project_id:string;project_name:string;developer_name:string|null;owner_email:string|null};
type Installment={id:string;sequence_number:number;due_date:string;amount:string;currency:string;paid_amount:string;remaining_amount:string};
type Receipt={id:string;file_name:string;review_status:string;upload_source:string;created_at:string;sequence_number:number};
type Statement={id:string;month_start:string;status:string;created_at:string};
type Detail={unit:Unit;installments:Installment[];receipts:Receipt[];statements:Statement[];handover:{status:string;scheduled_at?:string|null}};
const copy:Record<string,Record<string,string>>={
 ar:{title:"ملفات عملائي — KINGLIKE VIP",intro:"للموظف الذي أتم البيع فقط. عرض ومتابعة دون تعديل الحساب أو اعتماد المدفوعات.",units:"الوحدات المرتبطة بي",empty:"لم تُسنَد إليك أي وحدات بعد. يجب أن تربطك الإدارة بالعميل بعد تفعيل حسابه.",owner:"بريد العميل",installments:"الأقساط والمدفوعات المؤكدة",receipts:"إيصالات التحويل",statements:"طلبات كشف الحساب",handover:"حالة الاستلام",due:"الاستحقاق",paid:"المدفوع المعتمد",balance:"المتبقي",download:"تنزيل الإيصال",loading:"جاري تحميل الملفات",unavailable:"الملف غير متاح أو انتهت صلاحيتك للوصول إليه",login:"تسجيل الدخول لملفات العملاء",loginButton:"تسجيل الدخول",none:"لا توجد بيانات مسجلة",privacy:"يحق لك الاطلاع فقط على عقارات العملاء الذين خصصتهم لك الإدارة، ويُلغى الوصول فور سحب صلاحيتك."},
 en:{title:"My clients — KINGLIKE VIP",intro:"Read-only access for the assigned selling agent. No payment approval or editing.",units:"Assigned units",empty:"No client units assigned yet. Admin must assign you after buyer activation.",owner:"Buyer email",installments:"Installments and verified payments",receipts:"Transfer receipts",statements:"Statement requests",handover:"Handover status",due:"Due",paid:"Verified paid",balance:"Remaining",download:"Download receipt",loading:"Loading",unavailable:"File unavailable or your access was revoked",login:"Sign in to access assigned clients",loginButton:"Sign in",none:"No records yet",privacy:"You can view only the units assigned to you by management. Access is revoked when the assignment ends."},
 he:{title:"הלקוחות שלי — KINGLIKE VIP",intro:"צפייה בלבד למוכר המורשה.",units:"יחידות משויכות",empty:"אין יחידות משויכות.",owner:"דוא״ל הלקוח",installments:"תשלומים",receipts:"קבלות",statements:"בקשות דוח",handover:"מצב מסירה",due:"מועד",paid:"שולם ואומת",balance:"יתרה",download:"הורדת קבלה",loading:"טוען",unavailable:"אין גישה לקובץ",login:"התחבר",loginButton:"כניסה",none:"אין נתונים",privacy:"הגישה מוגבלת ללקוחות שהוקצו לך."},
 tr:{title:"Müşterilerim — KINGLIKE VIP",intro:"Yetkili satış temsilcisine yalnızca görüntüleme izni.",units:"Atanan üniteler",empty:"Henüz atanmış ünite yok.",owner:"Müşteri e-postası",installments:"Taksitler",receipts:"Dekontlar",statements:"Hesap özeti talepleri",handover:"Teslim durumu",due:"Vade",paid:"Onaylı",balance:"Kalan",download:"Dekontu indir",loading:"Yükleniyor",unavailable:"Erişim izniniz yok",login:"Giriş yapın",loginButton:"Giriş",none:"Veri yok",privacy:"Yalnızca size atanan müşteri dosyalarını görebilirsiniz."},
 az:{title:"Müştərilərim — KINGLIKE VIP",intro:"Səlahiyyətli satış əməkdaşı üçün yalnız baxış.",units:"Təyin edilmiş mənzillər",empty:"Hələ mənzil təyin edilməyib.",owner:"Müştərinin e-poçtu",installments:"Ödənişlər",receipts:"Qəbzlər",statements:"Hesab sorğuları",handover:"Təhvil statusu",due:"Tarix",paid:"Təsdiqlənib",balance:"Qalıq",download:"Qəbzi endir",loading:"Yüklənir",unavailable:"Giriş icazəsi yoxdur",login:"Daxil olun",loginButton:"Daxil ol",none:"Məlumat yoxdur",privacy:"Yalnız sizə təyin edilmiş müştəriləri görə bilərsiniz."}
};
export default function VipSellerPage(){
 const {user,isLoading}=useAuth();
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const rtl=/^(ar|he)(-|$)/i.test(i18n.language);
 const [selected,setSelected]=useState("");
 const units=useQuery<{units:Unit[]}>({
   queryKey:["vip","seller","units"],
   queryFn:async()=>{const r=await fetch("/api/vip/seller/units",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
   enabled:!!user&&!isLoading,retry:false
 });
 const assigned=units.data?.units||[];
 const id=assigned.some(u=>u.unit_id===selected)?selected:assigned[0]?.unit_id||"";
 const detail=useQuery<Detail>({
   queryKey:["vip","seller","detail",id],
   queryFn:async()=>{const r=await fetch("/api/vip/seller/units/"+encodeURIComponent(id),{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
   enabled:!!user&&!!id,retry:false
 });
 const fmt=(s:string)=>{const n=Number(s);return Number.isFinite(n)?n.toLocaleString(i18n.language,{maximumFractionDigits:2}):s};
 return <main dir={rtl?"rtl":"ltr"} className="min-h-[78vh] bg-[#f4f8f8] text-[#005476]">
  <header className="bg-[#005476] px-5 py-10 text-white">
   <div className="mx-auto max-w-6xl"><div className="flex items-center gap-3"><BriefcaseBusiness className="h-9 w-9 text-[#3BCAC4]"/><h1 className="text-2xl font-bold">{t.title}</h1></div>
    <p className="mt-3 text-sm text-white/80">{t.intro}</p></div>
  </header>
  <div className="mx-auto max-w-6xl space-y-5 px-4 py-8">
   {!user?<Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-[#005476] px-5 py-3 text-white"><LockKeyhole className="h-5 w-5"/>{t.loginButton}</Link>:
    units.isPending?<p>{t.loading}</p>:units.isError?<p role="alert">{t.unavailable}</p>:!assigned.length?
    <div className="rounded-2xl bg-white p-7"><Building2 className="mb-3 h-7 w-7 text-[#19a6a4]"/>{t.empty}</div>:<>
     <label className="block rounded-xl bg-white p-4 text-sm font-semibold">{t.units}
      <select className="mt-2 block w-full rounded-lg border border-[#d2e5e6] p-3" value={id} onChange={e=>setSelected(e.target.value)}>
       {assigned.map(u=><option key={u.unit_id} value={u.unit_id}>{u.project_name} · {u.unit_number}</option>)}
      </select>
     </label>
     {detail.isPending?<p>{t.loading}</p>:detail.isError?<p role="alert" className="rounded-xl bg-white p-5 text-rose-800">{t.unavailable}</p>:<>
      <div className="rounded-2xl bg-white p-6">
       <h2 className="text-xl font-bold">{detail.data.unit.project_name} · {detail.data.unit.unit_number}</h2>
       <p className="mt-2 text-sm">{t.owner}: <span dir="ltr">{detail.data.unit.owner_email||"—"}</span></p>
       <p className="mt-2 text-sm">{t.handover}: <strong>{detail.data.handover.status}</strong></p>
      </div>
      <section className="rounded-2xl bg-white p-5">
       <h3 className="mb-4 flex items-center gap-2 font-semibold"><CalendarClock className="h-5 w-5"/>{t.installments}</h3>
       {!detail.data.installments.length?<p className="text-sm">{t.none}</p>:<div className="grid gap-2 md:grid-cols-2">
        {detail.data.installments.map(x=><div key={x.id} className="rounded-xl border border-[#d9e8e9] p-4 text-sm">
          <p className="mb-2 font-semibold">{t.due}: {x.due_date}</p>
          <p>{t.paid}: {fmt(x.paid_amount)} {x.currency}</p>
          <p>{t.balance}: <strong>{fmt(x.remaining_amount)} {x.currency}</strong></p>
         </div>)}
       </div>}
      </section>
      <section className="rounded-2xl bg-white p-5">
       <h3 className="mb-3 flex items-center gap-2 font-semibold"><ReceiptText className="h-5 w-5"/>{t.receipts}</h3>
       {detail.data.receipts.length===0?<p className="text-sm">{t.none}</p>:<div className="space-y-2">
        {detail.data.receipts.map(x=><div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#d8e8e9] p-3 text-sm">
          <div className="min-w-0"><p className="break-all font-medium">{x.file_name}</p><p className="text-xs text-[#66858f]">{x.review_status} · {new Date(x.created_at).toLocaleDateString(i18n.language)}</p></div>
          <a href={"/api/vip/receipts/"+encodeURIComponent(x.id)+"/download"} className="flex items-center gap-1 text-sm font-semibold text-[#005476] underline"><FileDown className="h-4 w-4"/>{t.download}</a>
         </div>)}
       </div>}
      </section>
      <section className="rounded-2xl bg-white p-5">
       <h3 className="mb-3 flex items-center gap-2 font-semibold"><FileText className="h-5 w-5"/>{t.statements}</h3>
       {detail.data.statements.length===0?<p className="text-sm">{t.none}</p>:<div className="space-y-2">
        {detail.data.statements.map(x=><p key={x.id} className="rounded-lg bg-[#f4f9fa] px-4 py-3 text-sm">{x.month_start} · {x.status}</p>)}
       </div>}
      </section>
     </>}
    </>}
   <p className="flex items-start gap-2 text-xs text-[#668590]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.privacy}</p>
  </div>
 </main>;
}
