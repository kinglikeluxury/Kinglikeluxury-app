import {useQuery} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Wallet,ShieldCheck,ReceiptText} from "lucide-react";
type Total={currency:string;installment_count:number;scheduled:string;verified_paid:string;outstanding:string};
type Adjustment={id:string;category:string;amount:string;currency:string;description:string;source:string;source_reference:string;created_at:string};
const labels:Record<string,Record<string,string>>={
 ar:{title:"الملخص المالي لعقارك",scheduled:"إجمالي الأقساط",paid:"مدفوعات معتمدة",remaining:"الرصيد المتبقي",adjustments:"رسوم وتسويات موثّقة",empty:"لا توجد بيانات مالية مسجلة بعد.",note:"هذا ملخص لسجلات Kinglike Luxury وليس كشف الحساب الرسمي الصادر عن المطور. تُعرض العملات منفصلة دون تحويل تقديري، ولا يُعتبر إدراج أي رسم إقرارًا من المشتري بصحته.",error:"لا يمكن تحميل الملخص المالي حاليًا."},
 en:{title:"Your property financial summary",scheduled:"Scheduled installments",paid:"Verified payments",remaining:"Outstanding",adjustments:"Documented fees & adjustments",empty:"No recorded financial data yet.",note:"Kinglike-recorded summary only, not the developer's official statement. Currencies are shown separately. Listing a fee is not buyer acceptance.",error:"Financial summary unavailable."},
 he:{title:"סיכום כספי לנכס",scheduled:"תשלומים מתוכננים",paid:"תשלומים מאומתים",remaining:"יתרה",adjustments:"חיובים מתועדים",empty:"אין נתונים",note:"סיכום רשומות Kinglike בלבד; לא דוח רשמי של היזם.",error:"לא ניתן לטעון"},
 tr:{title:"Mülk finans özeti",scheduled:"Planlanan taksitler",paid:"Onaylı ödemeler",remaining:"Kalan tutar",adjustments:"Belgelendirilmiş ücret ve düzeltmeler",empty:"Henüz finans kaydı yok.",note:"Kinglike kayıt özetidir, geliştiricinin resmi dökümü değildir. Para birimleri ayrı gösterilir.",error:"Finans özeti kullanılamıyor."},
 az:{title:"Mənzilin maliyyə icmalı",scheduled:"Planlaşdırılmış ödənişlər",paid:"Təsdiq edilmiş",remaining:"Qalıq",adjustments:"Sənədləşdirilmiş xərclər",empty:"Məlumat yoxdur.",note:"Bu Kinglike qeydləridir, tikinti şirkətinin rəsmi çıxarışı deyil. Valyutalar ayrıca göstərilir.",error:"Maliyyə icmalı mövcud deyil."}
};
function money(value:string,currency:string,locale:string):string{
 const n=Number(value);
 return (Number.isFinite(n)?n.toLocaleString(locale,{minimumFractionDigits:2,maximumFractionDigits:2}):value)+" "+currency;
}
export default function VipFinanceClient({unitId}:{unitId:string}){
 const {i18n}=useTranslation();const t=labels[i18n.language.split("-")[0]]||labels.en;
 const query=useQuery<{totals:Total[];adjustments:Adjustment[]}>({
  queryKey:["vip","finance",unitId],
  queryFn:async()=>{const r=await fetch("/api/vip/units/"+encodeURIComponent(unitId)+"/account",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!unitId,retry:false
 });
 return <section className="mt-5 border-t border-[#dcebee] pt-5">
  <h4 className="mb-4 flex items-center gap-2 text-base font-semibold"><Wallet className="h-5 w-5 text-[#008e92]"/>{t.title}</h4>
  {query.isPending?<div className="h-16 animate-pulse rounded-xl bg-[#f0f7f8]"/>:
    query.isError?<p role="alert" className="text-sm text-rose-700">{t.error}</p>:
    query.data.totals.length===0?<p className="text-sm text-[#76919a]">{t.empty}</p>:
    <div className="grid gap-2 sm:grid-cols-2">{query.data.totals.map(x=><div key={x.currency} className="rounded-xl border border-[#d9e8ea] bg-[#f9fcfc] p-4 text-sm">
      <p className="mb-3 text-base font-semibold">{x.currency}</p>
      <div className="space-y-2">
       <div className="flex flex-wrap justify-between gap-2"><span>{t.scheduled}</span><strong>{money(x.scheduled,x.currency,i18n.language)}</strong></div>
       <div className="flex flex-wrap justify-between gap-2"><span>{t.paid}</span><strong className="text-emerald-700">{money(x.verified_paid,x.currency,i18n.language)}</strong></div>
       <div className="flex flex-wrap justify-between gap-2 border-t border-[#dae9eb] pt-2"><span>{t.remaining}</span><strong>{money(x.outstanding,x.currency,i18n.language)}</strong></div>
      </div>
     </div>)}</div>}
  {!!query.data?.adjustments.length&&<div className="mt-4">
   <h5 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ReceiptText className="h-4 w-4"/>{t.adjustments}</h5>
   {query.data.adjustments.map(x=><div key={x.id} className="mb-2 rounded-xl border border-[#dcebec] bg-white p-3">
     <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{x.description}</strong><span>{money(x.amount,x.currency,i18n.language)}</span></div>
     <p className="mt-1 text-xs text-[#77919b]">{x.category} · {x.source_reference||x.source}</p>
   </div>)}
  </div>}
  <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-[#728b95]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.note}</p>
 </section>;
}
