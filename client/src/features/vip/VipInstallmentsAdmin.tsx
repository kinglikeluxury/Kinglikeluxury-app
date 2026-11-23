import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarDays, Plus } from "lucide-react";

type Unit = {id:string;project_id:string;unit_number:string};
type Project = {id:string;name:string};
type Installment = {id:string;sequence_number:number;due_date:string;amount:string;paid_amount:string;remaining_amount:string;currency:string};
const words:Record<string,Record<string,string>>={
  ar:{title:"إدارة جداول الأقساط",unit:"الوحدة",number:"رقم القسط",due:"تاريخ الاستحقاق",amount:"المبلغ",currency:"العملة",save:"إضافة قسط",saved:"تم إضافة القسط",saving:"جارٍ الحفظ...",empty:"لا توجد أقساط مدخلة",error:"تعذر حفظ القسط",verified:"لا يتم اعتبار القسط مدفوعًا إلا بعد مراجعة الإدارة المالية."},
  en:{title:"Installment management",unit:"Unit",number:"Installment #",due:"Due date",amount:"Amount",currency:"Currency",save:"Add installment",saved:"Installment added",saving:"Saving...",empty:"No installments yet",error:"Could not save installment",verified:"An installment is marked paid only after finance verification."},
  he:{title:"ניהול תשלומים",unit:"יחידה",number:"מספר תשלום",due:"תאריך יעד",amount:"סכום",currency:"מטבע",save:"הוספת תשלום",saved:"התשלום נוסף",saving:"שומר...",empty:"אין תשלומים",error:"לא ניתן לשמור",verified:"התשלום ייחשב כשולם רק לאחר אישור פיננסי."},
  tr:{title:"Taksit yönetimi",unit:"Ünite",number:"Taksit no",due:"Son ödeme tarihi",amount:"Tutar",currency:"Para birimi",save:"Taksit ekle",saved:"Taksit eklendi",saving:"Kaydediliyor...",empty:"Taksit yok",error:"Taksit kaydedilemedi",verified:"Ödemeler yalnızca finans doğrulamasından sonra ödenmiş sayılır."},
  az:{title:"Ödənişlərin idarə edilməsi",unit:"Mənzil",number:"Ödəniş nömrəsi",due:"Son tarix",amount:"Məbləğ",currency:"Valyuta",save:"Ödəniş əlavə et",saved:"Əlavə olundu",saving:"Yadda saxlanılır...",empty:"Ödəniş yoxdur",error:"Əlavə edilə bilmədi",verified:"Ödəniş yalnız maliyyə təsdiqindən sonra ödənilmiş sayılır."}
};
const field="w-full rounded-xl border border-[#c8dcdf] bg-white px-3 py-3 text-[#164b60] focus:border-[#22bcb6] outline-none";
export default function VipInstallmentsAdmin({units,projects}:{units:Unit[];projects:Project[]}) {
  const {i18n}=useTranslation();
  const t=words[i18n.language.split("-")[0]]||words.en;
  const qc=useQueryClient();
  const [selected,setSelected]=useState("");
  const [sequence,setSequence]=useState("1");
  const [dueDate,setDueDate]=useState("");
  const [amount,setAmount]=useState("");
  const [currency,setCurrency]=useState("USD");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const unitId=selected && units.some(u=>u.id===selected)?selected:units[0]?.id||"";
  const existing=useQuery<{installments:Installment[]}>({
    queryKey:["vip","admin","installments",unitId],
    queryFn:async()=>{
      const r=await fetch("/api/admin/vip/units/"+encodeURIComponent(unitId)+"/installments",{credentials:"include",cache:"no-store"});
      if(!r.ok)throw Error("Unavailable");
      return r.json();
    },enabled:!!unitId,retry:false
  });
  async function save(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(!unitId||busy)return;
    setBusy(true);setMessage("");
    try {
      const r=await fetch("/api/admin/vip/units/"+encodeURIComponent(unitId)+"/installments",{
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({sequenceNumber:Number(sequence),dueDate,amount,currency})
      });
      if(!r.ok) {
        const j=await r.json().catch(()=>null);
        throw Error(j?.error||t.error);
      }
      setMessage(t.saved);
      setAmount("");setDueDate("");setSequence(String(Number(sequence)+1));
      await Promise.all([
        qc.invalidateQueries({queryKey:["vip","admin","installments",unitId]}),
        qc.invalidateQueries({queryKey:["vip","installments",unitId]})
      ]);
    }catch(e){setMessage(e instanceof Error?e.message:t.error)}
    finally {setBusy(false);}
  }
  return <section className="mt-8 rounded-2xl border border-[#d7e8ea] bg-white p-5 shadow-sm md:p-6">
    <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold"><CalendarDays className="h-6 w-6 text-[#008c93]"/>{t.title}</h3>
    <form onSubmit={save} className="grid gap-3 md:grid-cols-5">
      <label className="md:col-span-2"><span className="mb-2 block text-sm">{t.unit}</span>
        <select className={field} value={unitId} onChange={e=>{setSelected(e.target.value);setMessage("");}} disabled={units.length===0}>
          {units.map(u=><option key={u.id} value={u.id}>{projects.find(p=>p.id===u.project_id)?.name} · {u.unit_number}</option>)}
        </select>
      </label>
      <label><span className="mb-2 block text-sm">{t.number}</span>
        <input className={field} type="number" min={1} max={999} step={1} value={sequence} onChange={e=>setSequence(e.target.value)} required/>
      </label>
      <label><span className="mb-2 block text-sm">{t.due}</span>
        <input className={field} type="date" value={dueDate} onChange={e=>setDueDate(e.target.value)} required/>
      </label>
      <label><span className="mb-2 block text-sm">{t.amount}</span>
        <input className={field} type="text" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="1250.00" required/>
      </label>
      <label className="md:col-span-2"><span className="mb-2 block text-sm">{t.currency}</span>
        <select className={field} value={currency} onChange={e=>setCurrency(e.target.value)}>
          {["USD","EUR","GEL","AZN","TRY","AED","SAR","ILS","GBP"].map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <div className="flex items-end md:col-span-3"><button type="submit" disabled={busy||!unitId} className="flex items-center gap-2 rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4"/>{busy?t.saving:t.save}</button></div>
    </form>
    {message&&<p role="status" className="mt-3 text-sm text-[#005476]">{message}</p>}
    <div className="mt-5 space-y-2">
      {existing.isSuccess && existing.data.installments.length===0&&<p className="text-sm text-[#658391]">{t.empty}</p>}
      {existing.data?.installments.map(item=><div key={item.id} className="flex flex-wrap justify-between gap-3 rounded-xl bg-[#f4f9fa] p-3 text-sm">
        <span>#{item.sequence_number} · <strong className="text-[#005476]">{item.due_date}</strong></span>
        <span className="font-semibold">{item.amount} {item.currency}</span>
      </div>)}
    </div>
    <p className="mt-4 text-xs text-[#688997]">{t.verified}</p>
  </section>;
}
