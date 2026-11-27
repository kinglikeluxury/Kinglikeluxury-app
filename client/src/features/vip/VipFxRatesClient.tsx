import {useQuery} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {ArrowLeftRight,ShieldCheck} from "lucide-react";
type Rate={base_currency:string;quote_currency:string;rate:string;effective_date:string;source:string;source_reference:string};
const strings:Record<string,Record<string,string>>={
 ar:{title:"أسعار الصرف المرجعية",note:"كل سعر مرتبط بتاريخ ومصدر معتمد. هذا جدول معلومات، ولا يغيّر القيمة المتعاقد عليها أو يحوّل أرصدة الأقساط تلقائيًا."},
 en:{title:"Reference exchange rates",note:"Rates include a date and an approved source. Informational only: installment balances and contractual currencies are never converted automatically."},
 he:{title:"שערי מטבע למידע",note:"כל שער כולל תאריך ומקור. אינו משנה את המטבע בהסכם."},
 tr:{title:"Referans döviz kurları",note:"Her kurun tarihi ve onaylı kaynağı bulunur. Sözleşme para birimi veya taksit bakiyesi otomatik değişmez."},
 az:{title:"İstinad məzənnələri",note:"Hər məzənnənin tarixi və təsdiq olunmuş mənbəyi var. Müqavilə valyutası avtomatik dəyişmir."}
};
export default function VipFxRatesClient(){
 const {i18n}=useTranslation();const t=strings[i18n.language.split("-")[0]]||strings.en;
 const q=useQuery<{rates:Rate[]}>({
  queryKey:["vip","fx"],queryFn:async()=>{
   const r=await fetch("/api/vip/fx-rates",{credentials:"include",cache:"no-store"});
   if(!r.ok)throw Error("Unavailable");return r.json();
  },retry:false
 });
 if(!q.data?.rates.length)return null;
 return <section className="mt-9 rounded-2xl border border-[#cde4e5] bg-white p-5">
  <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><ArrowLeftRight className="h-5 w-5 text-[#008e91]"/>{t.title}</h2>
  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{q.data.rates.map((r,i)=><div key={r.base_currency+r.quote_currency+r.effective_date+i} className="rounded-xl bg-[#f3fafa] p-4">
   <p className="text-sm font-semibold">{r.base_currency} / {r.quote_currency}</p>
   <p className="mt-1 text-lg font-semibold">{r.rate}</p>
   <p className="mt-1 text-xs text-[#6e8d98]">{r.effective_date} · {r.source}</p>
  </div>)}</div>
  <p className="mt-4 flex gap-2 text-xs text-[#738e97]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.note}</p>
 </section>;
}
