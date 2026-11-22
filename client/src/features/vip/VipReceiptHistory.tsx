import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileCheck2, FileDown } from "lucide-react";
type Row={id:string;installment_id:string;file_name:string;upload_source:string;review_status:string;created_at:string;review_note:string|null;uploaded_by_name:string};
const t9:Record<string,Record<string,string>>={
  ar:{title:"إيصالات التحويل",empty:"لا توجد إيصالات مرفوعة",pending:"قيد المراجعة",approved:"تم التحقق",rejected:"مرفوض",download:"تنزيل الإيصال",error:"تعذر تحميل الإيصالات"},
  en:{title:"Transfer receipts",empty:"No receipts yet",pending:"Under review",approved:"Verified",rejected:"Rejected",download:"Download receipt",error:"Receipts unavailable"},
  he:{title:"קבלות העברה",empty:"אין קבלות",pending:"בבדיקה",approved:"אושר",rejected:"נדחה",download:"הורדת קבלה",error:"לא ניתן לטעון קבלות"},
  tr:{title:"Havale dekontları",empty:"Dekont yok",pending:"İnceleniyor",approved:"Onaylandı",rejected:"Reddedildi",download:"Dekontu indir",error:"Dekontlar yüklenemiyor"},
  az:{title:"Köçürmə qəbzləri",empty:"Qəbz yoxdur",pending:"Yoxlanılır",approved:"Təsdiqləndi",rejected:"Rədd edildi",download:"Qəbzi endir",error:"Qəbzlər yüklənmir"}
};
export default function VipReceiptHistory({unitId}:{unitId:string}){
  const {i18n}=useTranslation();const t=t9[i18n.language.split("-")[0]]||t9.en;
  const query=useQuery<{receipts:Row[]}>({
    queryKey:["vip","receipts",unitId],
    queryFn:async()=>{const r=await fetch("/api/vip/units/"+encodeURIComponent(unitId)+"/receipts",{credentials:"include",cache:"no-store"});
      if(!r.ok)throw Error("Unavailable");return r.json()},
    enabled:!!unitId,retry:false
  });
  return <section className="mt-5 border-t border-[#e5eff0] pt-4">
    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileCheck2 className="h-5 w-5 text-[#119899]"/>{t.title}</h4>
    {query.isPending?<p className="text-xs text-[#6e8896]">…</p>:
     query.isError?<p role="alert" className="text-xs text-red-700">{t.error}</p>:
     query.data.receipts.length===0?<p className="text-xs text-[#6e8896]">{t.empty}</p>:
     <div className="space-y-2">{query.data.receipts.map(r=><div key={r.id} className="rounded-xl bg-[#f6fafb] p-3">
       <div className="flex flex-wrap items-center justify-between gap-2">
         <span className="max-w-[190px] truncate text-xs font-medium">{r.file_name}</span>
         <span className={"rounded-full px-2 py-1 text-[11px] font-semibold "+(r.review_status==="approved"?"bg-emerald-100 text-emerald-800":r.review_status==="rejected"?"bg-rose-100 text-rose-800":"bg-amber-100 text-amber-800")}>{t[r.review_status]||r.review_status}</span>
       </div>
       <p className="mt-1 text-[11px] text-[#728d98]">{new Date(r.created_at).toLocaleDateString(i18n.language)} · {r.uploaded_by_name}</p>
       {r.review_note&&<p className="mt-1 text-xs text-[#677f8a]">{r.review_note}</p>}
       <a className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#005476] underline" href={"/api/vip/receipts/"+encodeURIComponent(r.id)+"/download"}><FileDown className="h-4 w-4"/>{t.download}</a>
     </div>)}</div>}
  </section>;
}
