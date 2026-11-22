import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarClock, ReceiptText } from "lucide-react";

type Installment = {
  id:string; sequence_number:number; due_date:string; amount:string;
  currency:string; paid_amount:string; remaining_amount:string;
};
type Schedule = { installments:Installment[] };
const tr: Record<string,Record<string,string>> = {
  ar:{title:"جدول الأقساط",due:"تاريخ الاستحقاق",amount:"قيمة القسط",paid:"مدفوع ومؤكد",remaining:"المتبقي",empty:"لم تُضِف الإدارة جدول الأقساط لهذه الوحدة بعد.",error:"تعذر تحميل الأقساط",paidLabel:"مدفوع",partial:"مدفوع جزئيًا",overdue:"متأخر",unpaid:"بانتظار الدفع",notVerified:"تظهر المدفوعات هنا بعد اعتماد الإدارة المالية لوصول المبلغ."},
  en:{title:"Installment schedule",due:"Due date",amount:"Installment",paid:"Verified paid",remaining:"Remaining",empty:"The installment schedule has not been prepared yet.",error:"Could not load installments",paidLabel:"Paid",partial:"Partially paid",overdue:"Overdue",unpaid:"Awaiting payment",notVerified:"Payments appear only after finance confirms their receipt."},
  he:{title:"לוח תשלומים",due:"תאריך תשלום",amount:"סכום לתשלום",paid:"שולם ואומת",remaining:"יתרה",empty:"לוח התשלומים עדיין לא הוכן.",error:"לא ניתן לטעון תשלומים",paidLabel:"שולם",partial:"שולם חלקית",overdue:"באיחור",unpaid:"ממתין לתשלום",notVerified:"תשלומים יוצגו לאחר אישור מחלקת הכספים."},
  tr:{title:"Taksit planı",due:"Son ödeme tarihi",amount:"Taksit tutarı",paid:"Doğrulanan ödeme",remaining:"Kalan",empty:"Taksit planı henüz hazırlanmadı.",error:"Taksitler yüklenemiyor",paidLabel:"Ödendi",partial:"Kısmen ödendi",overdue:"Gecikmiş",unpaid:"Ödeme bekliyor",notVerified:"Ödemeler yalnızca finans onayından sonra görünür."},
  az:{title:"Ödəniş cədvəli",due:"Ödəniş tarixi",amount:"Ödəniş məbləği",paid:"Təsdiq edilmiş",remaining:"Qalıq",empty:"Ödəniş cədvəli hələ hazırlanmayıb.",error:"Ödənişlər yüklənmədi",paidLabel:"Ödənilib",partial:"Qismən ödənilib",overdue:"Gecikib",unpaid:"Ödəniş gözlənilir",notVerified:"Ödənişlər yalnız maliyyə şöbəsi təsdiqlədikdən sonra görünür."}
};
function money(raw:string,currency:string,locale:string) {
  const value=Number(raw);
  if(!Number.isFinite(value))return raw+" "+currency;
  try {return new Intl.NumberFormat(locale,{style:"currency",currency,maximumFractionDigits:2}).format(value);}
  catch{return value.toLocaleString(locale)+" "+currency;}
}
export default function VipInstallmentsList({unitId}:{unitId:string}) {
  const {i18n}=useTranslation();
  const t=tr[i18n.language.split("-")[0]]||tr.en;
  const query=useQuery<Schedule>({
    queryKey:["vip","installments",unitId],
    queryFn:async()=>{
      const r=await fetch("/api/vip/units/"+encodeURIComponent(unitId)+"/installments",{credentials:"include",cache:"no-store"});
      if(!r.ok)throw Error("Installments unavailable");
      return r.json();
    },
    enabled:!!unitId,retry:false
  });
  return <section className="mt-5 border-t border-[#e5eff0] pt-4">
    <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold"><ReceiptText className="h-5 w-5 text-[#12989a]"/>{t.title}</h4>
    {query.isPending?<div className="h-12 animate-pulse rounded-xl bg-[#e7eff1]"/>:
    query.isError?<p role="alert" className="text-sm text-amber-900">{t.error}</p>:
    query.data.installments.length===0?<p className="text-xs text-[#6c8895]">{t.empty}</p>:
    <div className="space-y-3">
      {query.data.installments.map(item=>{
        const paid=Number(item.paid_amount);
        const remaining=Number(item.remaining_amount);
        const dueDate=new Date(item.due_date+"T12:00:00Z");
        const today=new Date();
        const todayParts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Tbilisi",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(today);
        const lookup=(type:string)=>todayParts.find(p=>p.type===type)?.value || "";
        const todayIso=lookup("year")+"-"+lookup("month")+"-"+lookup("day");
        const overdue=remaining>0 && item.due_date<todayIso;
        const complete=remaining<=0;
        const status=complete?t.paidLabel:overdue?t.overdue:paid>0?t.partial:t.unpaid;
        return <article key={item.id} className="rounded-xl border border-[#d8e8eb] bg-[#fafdfe] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-[#4e7285]">
                <CalendarClock className="h-4 w-4 text-[#008b92]"/>{t.due} · #{item.sequence_number}
              </div>
              <time dateTime={item.due_date} className="block text-xl font-bold tracking-tight text-[#004e70] md:text-2xl">
                {dueDate.toLocaleDateString(i18n.language,{day:"2-digit",month:"long",year:"numeric",timeZone:"UTC"})}
              </time>
            </div>
            <span className={"rounded-full px-3 py-1 text-xs font-semibold "+(complete?"bg-emerald-100 text-emerald-800":overdue?"bg-rose-100 text-rose-800":"bg-amber-100 text-amber-900")}>{status}</span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-[#698794]">{t.amount}</p><strong>{money(item.amount,item.currency,i18n.language)}</strong></div>
            <div><p className="text-xs text-[#698794]">{t.remaining}</p><strong>{money(item.remaining_amount,item.currency,i18n.language)}</strong></div>
          </div>
        </article>;
      })}
      <p className="text-xs leading-relaxed text-[#78929b]">{t.notVerified}</p>
    </div>}
  </section>;
}
