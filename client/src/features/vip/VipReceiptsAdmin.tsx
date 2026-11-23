import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileDown, Receipt, ShieldCheck } from "lucide-react";
import VipReceiptUpload from "./VipReceiptUpload";
type Unit={id:string;project_id:string;unit_number:string};
type Project={id:string;name:string};
type Installment={id:string;sequence_number:number;due_date:string;amount:string;currency:string};
type ReceiptRow={id:string;file_name:string;upload_source:string;review_status:string;uploaded_by:number;uploaded_by_name:string;created_at:string;installment_id:string;unit_id:string;due_date:string;installment_amount:string;currency:string;project_name:string;unit_number:string};
const labels:Record<string,Record<string,string>>={
  ar:{title:"مركز الإيصالات والمراجعة المالية",upload:"رفع إيصال نيابة عن العميل",unit:"العقار والوحدة",installment:"القسط",pending:"بانتظار المراجعة",approved:"مؤكد",rejected:"مرفوض",view:"تنزيل الإيصال",amount:"المبلغ المؤكد",approve:"اعتماد المبلغ",reject:"رفض الإيصال",reason:"سبب الرفض",grant:"منح صلاحية المراجعة المالية",email:"بريد موظف موثّق",applyGrant:"منح الصلاحية",revokeGrant:"سحب الصلاحية",finance:"صلاحية الاعتماد المالي",authorized:"مصرح",restricted:"غير مصرح",error:"تعذر تنفيذ العملية",empty:"لا توجد إيصالات بعد",sending:"جارٍ الحفظ...",source:"المصدر",note:"الإيصال لا يصبح مدفوعًا تلقائيًا. الاعتماد مسموح فقط لمن خُوّل ماليًا، ولا يمكنه اعتماد إيصال رفعه بنفسه."},
  en:{title:"Receipts & finance verification",upload:"Upload for client",unit:"Property / unit",installment:"Installment",pending:"Pending",approved:"Verified",rejected:"Rejected",view:"Download",amount:"Verified amount",approve:"Approve amount",reject:"Reject receipt",reason:"Rejection reason",grant:"Grant finance permission",email:"Verified staff email",applyGrant:"Grant access",revokeGrant:"Revoke access",finance:"Finance approval access",authorized:"Authorized",restricted:"Not authorized",error:"Operation failed",empty:"No receipts yet",sending:"Saving...",source:"Source",note:"Uploads never automatically confirm payment. Only finance approvers may verify someone else's receipt."},
  he:{title:"אישור קבלות כספי",upload:"העלאת קבלה ללקוח",unit:"יחידה",installment:"תשלום",pending:"ממתין",approved:"אושר",rejected:"נדחה",view:"הורדה",amount:"סכום שאושר",approve:"אישור",reject:"דחייה",reason:"סיבת הדחייה",grant:"מתן הרשאה פיננסית",email:"דוא״ל עובד מאומת",applyGrant:"אישור גישה",revokeGrant:"ביטול הרשאה",finance:"הרשאת כספים",authorized:"מורשה",restricted:"לא מורשה",error:"הפעולה נכשלה",empty:"אין קבלות",sending:"שומר...",source:"מקור",note:"העלאה אינה מאשרת תשלום. נדרשת הרשאה פיננסית נפרדת."},
  tr:{title:"Dekontlar ve finans onayı",upload:"Müşteri adına dekont yükle",unit:"Ünite",installment:"Taksit",pending:"Bekliyor",approved:"Onaylandı",rejected:"Reddedildi",view:"İndir",amount:"Onaylanan tutar",approve:"Tutarı onayla",reject:"Reddet",reason:"Ret nedeni",grant:"Finans yetkisi ver",email:"Doğrulanmış çalışan e-postası",applyGrant:"Yetki ver",revokeGrant:"Yetkiyi kaldır",finance:"Finans onay yetkisi",authorized:"Yetkili",restricted:"Yetkisiz",error:"İşlem başarısız",empty:"Dekont yok",sending:"Kaydediliyor...",source:"Kaynak",note:"Yükleme ödeme onayı değildir. Finans onayı ayrı yetki gerektirir."},
  az:{title:"Qəbz və maliyyə yoxlaması",upload:"Müştərinin adından qəbz yüklə",unit:"Mənzil",installment:"Ödəniş",pending:"Gözlənilir",approved:"Təsdiqləndi",rejected:"Rədd edildi",view:"Endir",amount:"Təsdiq olunan məbləğ",approve:"Təsdiq et",reject:"Rədd et",reason:"Rədd səbəbi",grant:"Maliyyə icazəsi ver",email:"Təsdiqlənmiş əməkdaş e-poçtu",applyGrant:"İcazə ver",revokeGrant:"İcazəni ləğv et",finance:"Maliyyə icazəsi",authorized:"İcazəlidir",restricted:"İcazəsizdir",error:"Əməliyyat uğursuz oldu",empty:"Qəbz yoxdur",sending:"Yadda saxlanılır...",source:"Mənbə",note:"Qəbzin yüklənməsi ödənişin təsdiqi deyil."}
};
const input="w-full rounded-xl border border-[#cce0e3] bg-white px-3 py-2 text-sm";
export default function VipReceiptsAdmin({units,projects}:{units:Unit[];projects:Project[]}) {
 const {i18n}=useTranslation(); const t=labels[i18n.language.split("-")[0]]||labels.en;
 const qc=useQueryClient(); const [unit,setUnit]=useState("");const [installment,setInstallment]=useState("");const [amounts,setAmounts]=useState<Record<string,string>>({});const [notes,setNotes]=useState<Record<string,string>>({});const [email,setEmail]=useState("");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 const selected=unit&&units.some(u=>u.id===unit)?unit:units[0]?.id||"";
 const schedule=useQuery<{installments:Installment[]}>({
   queryKey:["vip","admin","installments",selected],
   queryFn:async()=>{const r=await fetch("/api/admin/vip/units/"+encodeURIComponent(selected)+"/installments",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json();},
   enabled:!!selected,retry:false
 });
 const current=installment&&schedule.data?.installments.some(i=>i.id===installment)?installment:schedule.data?.installments[0]?.id||"";
 const receiptQuery=useQuery<{receipts:ReceiptRow[]}>({
   queryKey:["vip","admin","receipts"],
   queryFn:async()=>{const r=await fetch("/api/admin/vip/receipts",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json();},retry:false
 });
 const canApprove=useQuery<{canApprove:boolean}>({
   queryKey:["vip","admin","finance","me"],
   queryFn:async()=>{const r=await fetch("/api/admin/vip/finance/me",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json();},retry:false
 });
 async function post(path:string,body:unknown,method:"POST"|"DELETE"="POST") {
   setBusy(true);setMessage("");
   try {
     const response=await fetch(path,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
     if(!response.ok){const x=await response.json().catch(()=>null);throw Error(x?.error||t.error)}
     setMessage("✓");
     await Promise.all([
       qc.invalidateQueries({queryKey:["vip","admin","receipts"]}),
       qc.invalidateQueries({queryKey:["vip","admin","finance","me"]}),
       qc.invalidateQueries({queryKey:["vip","installments"]}),
       qc.invalidateQueries({queryKey:["vip","receipts"]}),
       qc.invalidateQueries({queryKey:["vip","admin","overview"]})
     ]);
   } catch(e){setMessage(e instanceof Error?e.message:t.error)}
   finally{setBusy(false)}
 }
 async function grant(e:FormEvent<HTMLFormElement>) {
   e.preventDefault(); await post("/api/admin/vip/finance-permissions",{email});setEmail("");
 }
 async function revoke(){
   if(!email||busy)return;
   await post("/api/admin/vip/finance-permissions",{email},"DELETE");setEmail("");
 }
 return <section className="mt-9 rounded-2xl border border-[#d7e6e9] bg-white p-5 md:p-6">
   <h2 className="flex items-center gap-2 text-xl font-semibold"><Receipt className="h-6 w-6 text-[#008c93]"/>{t.title}</h2>
   <p className="mt-2 text-xs text-[#6d8995]">{t.note}</p>
   <div className="mt-4 flex items-center gap-2 text-sm"><ShieldCheck className="h-5 w-5 text-[#008c93]"/>{t.finance}: <strong>{canApprove.data?.canApprove?t.authorized:t.restricted}</strong></div>
   {message&&<p role="status" className="mt-3 text-sm text-[#005476]">{message}</p>}
   <div className="mt-6 grid gap-5 md:grid-cols-2">
     <div className="rounded-xl border border-[#e0ecee] p-4">
       <h3 className="mb-4 font-semibold">{t.upload}</h3>
       <label className="mb-2 block text-xs">{t.unit}</label>
       <select className={input} value={selected} onChange={e=>{setUnit(e.target.value);setInstallment("")}} disabled={!units.length}>
         {units.map(u=><option key={u.id} value={u.id}>{projects.find(p=>p.id===u.project_id)?.name} · {u.unit_number}</option>)}
       </select>
       <label className="mb-2 mt-3 block text-xs">{t.installment}</label>
       <select className={input} value={current} onChange={e=>setInstallment(e.target.value)} disabled={!schedule.data?.installments.length}>
         {schedule.data?.installments.map(i=><option value={i.id} key={i.id}>#{i.sequence_number} · {i.due_date} · {i.amount} {i.currency}</option>)}
       </select>
       {current&&<VipReceiptUpload key={current} installmentId={current} asAdmin/>}
     </div>
     <form onSubmit={grant} className="rounded-xl border border-[#e0ecee] p-4">
       <h3 className="mb-4 font-semibold">{t.grant}</h3>
       <label className="mb-2 block text-xs">{t.email}</label>
       <input className={input} type="email" required value={email} onChange={e=>setEmail(e.target.value)} maxLength={254}/>
       <div className="mt-4 flex flex-wrap gap-2">
         <button className="rounded-xl bg-[#005476] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50" type="submit" disabled={busy}>{busy?t.sending:t.applyGrant}</button>
         <button className="rounded-xl border border-rose-300 px-4 py-2 text-xs font-semibold text-rose-800 disabled:opacity-50" type="button" disabled={busy||!email.trim()} onClick={revoke}>{t.revokeGrant}</button>
       </div>
     </form>
   </div>
   <div className="mt-6 space-y-3">
     {receiptQuery.isPending?<p>…</p>:receiptQuery.isError?<p role="alert" className="text-red-700">{t.error}</p>:
       receiptQuery.data.receipts.length===0?<p className="text-sm text-[#6d8995]">{t.empty}</p>:
       receiptQuery.data.receipts.map(r=><div key={r.id} className="rounded-xl border border-[#e0ecee] p-4">
         <div className="flex flex-wrap items-start justify-between gap-3">
           <div><strong className="text-sm">{r.project_name} · {r.unit_number}</strong>
             <p className="mt-1 text-xs text-[#688594]">{r.file_name} · {r.uploaded_by_name} · {t.source}: {r.upload_source}</p>
             <p className="mt-1 text-xs text-[#688594]">{r.due_date} · {r.installment_amount} {r.currency}</p></div>
           <span className={"rounded-full px-2 py-1 text-xs "+(r.review_status==="approved"?"bg-emerald-100 text-emerald-800":r.review_status==="rejected"?"bg-rose-100 text-rose-800":"bg-amber-100 text-amber-800")}>{t[r.review_status]||r.review_status}</span>
         </div>
         <a href={"/api/vip/receipts/"+encodeURIComponent(r.id)+"/download"} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#005476] underline"><FileDown className="h-4 w-4"/>{t.view}</a>
         {r.review_status==="pending"&&canApprove.data?.canApprove&&<div className="mt-4 flex flex-wrap items-end gap-3 border-t border-[#e0ecee] pt-3">
           <label className="text-xs">{t.amount}<input className={input+" mt-1 max-w-40"} inputMode="decimal" placeholder="1250.00" value={amounts[r.id]||""} onChange={e=>setAmounts(a=>({...a,[r.id]:e.target.value}))}/></label>
           <button className="rounded-lg bg-[#00637b] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" type="button" disabled={busy} onClick={()=>post("/api/admin/vip/receipts/"+r.id+"/review",{decision:"approve",verifiedAmount:amounts[r.id],note:""})}>{t.approve}</button>
           <label className="text-xs">{t.reason}<input className={input+" mt-1"} value={notes[r.id]||""} onChange={e=>setNotes(n=>({...n,[r.id]:e.target.value}))}/></label>
           <button className="rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-800 disabled:opacity-50" type="button" disabled={busy||(notes[r.id]||"").trim().length<5} onClick={()=>post("/api/admin/vip/receipts/"+r.id+"/review",{decision:"reject",note:notes[r.id]})}>{t.reject}</button>
         </div>}
       </div>)}
   </div>
 </section>;
}
