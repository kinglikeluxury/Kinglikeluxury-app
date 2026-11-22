import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Video, ShieldCheck } from "lucide-react";

type Project={id:string;name:string};
type Camera={label:string;embed_url:string;is_active:boolean;updated_at:string};
const copy:Record<string,Record<string,string>>={
 ar:{title:"كاميرا المشروع المباشرة",project:"المشروع",label:"اسم الكاميرا",url:"رابط البث الرسمي HTTPS",enabled:"إظهار رابط البث لمالكي الوحدات",save:"حفظ إعدادات الكاميرا",busy:"جاري الحفظ",success:"تم حفظ الإعدادات",error:"تعذر الحفظ. يجب أن يكون الرابط من مزود معتمد.",note:"لن يظهر رابط الكاميرا إلا لعملاء المشروع. لا نضيف روابط غير معتمدة من المطور."},
 en:{title:"Project live camera",project:"Project",label:"Camera label",url:"Official HTTPS stream link",enabled:"Show camera to owners",save:"Save camera settings",busy:"Saving",success:"Camera settings saved",error:"Could not save. Camera provider must be approved.",note:"Only owners of this project can access this link."},
 he:{title:"מצלמת הפרויקט",project:"פרויקט",label:"שם המצלמה",url:"קישור HTTPS רשמי",enabled:"הצג לבעלי יחידות",save:"שמירה",busy:"שומר",success:"נשמר",error:"לא ניתן לשמור",note:"רק בעלי נכסים מורשים יכולים לצפות."},
 tr:{title:"Proje canlı kamera",project:"Proje",label:"Kamera adı",url:"Resmi HTTPS bağlantısı",enabled:"Mülk sahiplerine göster",save:"Kaydet",busy:"Kaydediliyor",success:"Kaydedildi",error:"Kaydedilemedi",note:"Yalnızca proje sahipleri erişebilir."},
 az:{title:"Layihənin canlı kamerası",project:"Layihə",label:"Kamera adı",url:"Rəsmi HTTPS bağlantısı",enabled:"Mənzil sahiblərinə göstər",save:"Yadda saxla",busy:"Yadda saxlanılır",success:"Yadda saxlandı",error:"Yadda saxlanmadı",note:"Yalnız səlahiyyətli sahiblər baxa bilər."}
};
export default function VipCameraAdmin({projects}:{projects:Project[]}) {
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const qc=useQueryClient();const [selected,setSelected]=useState("");
 const [label,setLabel]=useState("Construction camera");const [url,setUrl]=useState("");const [active,setActive]=useState(false);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [ok,setOk]=useState(false);
 const id=projects.some(p=>p.id===selected)?selected:projects[0]?.id||"";
 const existing=useQuery<{camera:Camera|null}>({
   queryKey:["vip","admin","camera",id],
   queryFn:async()=>{const r=await fetch("/api/admin/vip/projects/"+encodeURIComponent(id)+"/camera",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
   enabled:!!id,retry:false
 });
 useEffect(()=>{
   setLabel(existing.data?.camera?.label||"Construction camera");
   setUrl(existing.data?.camera?.embed_url||"");
   setActive(existing.data?.camera?.is_active||false);
 },[id,existing.data]);
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!id||busy)return;setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/admin/vip/projects/"+encodeURIComponent(id)+"/camera",{
     method:"PUT",credentials:"include",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({label,embedUrl:url,isActive:active})
   });
   if(!r.ok)throw Error(t.error);
   setMessage(t.success);setOk(true);
   await qc.invalidateQueries({queryKey:["vip","admin","camera",id]});
  }catch{setMessage(t.error);setOk(false)}
  finally{setBusy(false)}
 }
 return <section className="mt-8 rounded-2xl border border-[#d7e8ea] bg-white p-5 md:p-6">
  <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Video className="h-6 w-6 text-[#008c93]"/>{t.title}</h3>
  <form onSubmit={save} className="grid gap-4 md:grid-cols-2">
   <label className="text-sm">{t.project}
    <select className="mt-2 block w-full rounded-xl border border-[#d3e4e7] p-3" value={id} onChange={e=>{setSelected(e.target.value);setMessage("")}}>
      {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
   </label>
   <label className="text-sm">{t.label}
    <input className="mt-2 block w-full rounded-xl border border-[#d3e4e7] p-3" value={label} onChange={e=>setLabel(e.target.value)} maxLength={80} required/>
   </label>
   <label className="text-sm md:col-span-2">{t.url}
    <input className="mt-2 block w-full rounded-xl border border-[#d3e4e7] p-3" type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://" required/>
   </label>
   <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/>{t.enabled}</label>
   <div className="flex justify-end"><button type="submit" disabled={!id||busy} className="rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?t.busy:t.save}</button></div>
  </form>
  {message&&<p role="status" className={"mt-3 text-sm "+(ok?"text-emerald-800":"text-red-700")}>{message}</p>}
  <p className="mt-4 flex items-center gap-2 text-xs text-[#78939a]"><ShieldCheck className="h-4 w-4"/>{t.note}</p>
 </section>;
}
