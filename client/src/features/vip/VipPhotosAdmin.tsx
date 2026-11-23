import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ImagePlus } from "lucide-react";
type Project={id:string;name:string};
type Photo={id:string;photo_date:string;caption:string|null;is_published:boolean};
const copy:Record<string,Record<string,string>>={
 ar:{title:"تحديث صور المشاريع",project:"المشروع",date:"تاريخ الصورة",caption:"وصف الصورة (اختياري)",file:"اختر صورة JPG أو PNG",upload:"رفع كمسودة",publish:"نشر للمالكين",unpublish:"إلغاء النشر",published:"منشورة",draft:"مسودة",saved:"تم حفظ الصورة كمسودة. انشرها بعد المراجعة.",error:"تعذر حفظ الصورة",empty:"لم ترفع أي صورة لهذا المشروع",note:"الصور خاصة بإدارة Kinglike؛ لن تظهر للعملاء حتى يتم نشرها."},
 en:{title:"Project photo updates",project:"Project",date:"Photo date",caption:"Caption (optional)",file:"Choose JPG or PNG",upload:"Upload as draft",publish:"Publish to owners",unpublish:"Unpublish",published:"Published",draft:"Draft",saved:"Saved as draft. Publish after review.",error:"Could not save photo",empty:"No project photos yet",note:"Only Kinglike management may upload; drafts are invisible to buyers."},
 he:{title:"עדכוני תמונות הפרויקט",project:"פרויקט",date:"תאריך התמונה",caption:"תיאור",file:"בחר תמונה",upload:"העלאת טיוטה",publish:"פרסום",unpublish:"ביטול פרסום",published:"פורסם",draft:"טיוטה",saved:"התמונה נשמרה כטיוטה.",error:"לא ניתן לשמור",empty:"אין תמונות",note:"רק ההנהלה יכולה להעלות תמונות."},
 tr:{title:"Proje fotoğraf güncellemeleri",project:"Proje",date:"Fotoğraf tarihi",caption:"Açıklama",file:"JPG veya PNG seç",upload:"Taslak yükle",publish:"Yayımla",unpublish:"Yayından kaldır",published:"Yayımlandı",draft:"Taslak",saved:"Taslak kaydedildi.",error:"Fotoğraf kaydedilemedi",empty:"Fotoğraf yok",note:"Yalnızca yönetim fotoğraf yükleyebilir."},
 az:{title:"Layihə foto yenilikləri",project:"Layihə",date:"Şəkil tarixi",caption:"Açıqlama",file:"JPG və ya PNG seç",upload:"Qaralama yüklə",publish:"Dərc et",unpublish:"Yayımdan çıxar",published:"Dərc edilib",draft:"Qaralama",saved:"Qaralama saxlandı.",error:"Şəkil saxlanmadı",empty:"Şəkil yoxdur",note:"Yalnız idarəetmə şəkil yükləyə bilər."}
};
export default function VipPhotosAdmin({projects}:{projects:Project[]}){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const qc=useQueryClient();const [choice,setChoice]=useState("");
 const projectId=projects.some(p=>p.id===choice)?choice:projects[0]?.id||"";
 const [date,setDate]=useState(()=>new Date().toISOString().slice(0,10));
 const [caption,setCaption]=useState("");const [file,setFile]=useState<File|null>(null);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");
 const query=useQuery<{photos:Photo[]}>({
  queryKey:["vip","admin","project-photos",projectId],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/projects/"+encodeURIComponent(projectId)+"/photos",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!projectId,retry:false
 });
 async function upload(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!file||!projectId||busy||file.size>8*1024*1024)return;
  setBusy(true);setMessage("");
  try{
   const body=new FormData();body.append("photo",file);body.append("photoDate",date);body.append("caption",caption);
   const r=await fetch("/api/admin/vip/projects/"+encodeURIComponent(projectId)+"/photos",{method:"POST",body,credentials:"include"});
   if(!r.ok)throw Error(t.error);setMessage(t.saved);setCaption("");setFile(null);
   await qc.invalidateQueries({queryKey:["vip","admin","project-photos",projectId]});
  }catch{setMessage(t.error)}finally{setBusy(false)}
 }
 async function toggle(photo:Photo){
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/admin/vip/projects/"+encodeURIComponent(projectId)+"/photos/"+encodeURIComponent(photo.id),{
    method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({isPublished:!photo.is_published})
   });
   if(!r.ok)throw Error(t.error);
   await Promise.all([
    qc.invalidateQueries({queryKey:["vip","admin","project-photos",projectId]}),
    qc.invalidateQueries({queryKey:["vip","project-photos",projectId]})
   ]);
  }catch{setMessage(t.error)}finally{setBusy(false)}
 }
 return <section className="mt-8 rounded-2xl border border-[#d7e9ea] bg-white p-5 md:p-6">
   <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold"><ImagePlus className="h-6 w-6 text-[#008b91]"/>{t.title}</h3>
   <form onSubmit={upload} className="grid gap-3 md:grid-cols-2">
     <label className="text-sm">{t.project}
       <select value={projectId} onChange={e=>setChoice(e.target.value)} className="mt-1 block w-full rounded-xl border border-[#cce2e4] p-3">
        {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
       </select>
     </label>
     <label className="text-sm">{t.date}
       <input type="date" value={date} onChange={e=>setDate(e.target.value)} required className="mt-1 block w-full rounded-xl border border-[#cce2e4] p-3"/>
     </label>
     <label className="text-sm">{t.caption}
       <input value={caption} maxLength={250} onChange={e=>setCaption(e.target.value)} className="mt-1 block w-full rounded-xl border border-[#cce2e4] p-3"/>
     </label>
     <label className="text-sm">{t.file}
       <input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" required
         onChange={e=>setFile(e.target.files?.[0]||null)} className="mt-1 block w-full p-3 text-xs"/>
     </label>
     <div><button disabled={!file||busy||!projectId||file.size>8*1024*1024} type="submit"
       className="rounded-xl bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.upload}</button></div>
   </form>
   {message&&<p role="status" className="mt-3 text-sm text-[#005476]">{message}</p>}
   <p className="mt-3 text-xs text-[#6b8793]">{t.note}</p>
   <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {query.data?.photos.map(p=><div key={p.id} className="overflow-hidden rounded-xl border border-[#dce9ed]">
      <img src={"/api/vip/photos/"+encodeURIComponent(p.id)+"/view"} loading="lazy" alt={p.caption||t.title} className="aspect-[4/3] w-full object-cover"/>
      <div className="space-y-2 p-3 text-sm"><p>{p.photo_date} · {p.caption}</p>
       <p className="text-xs">{p.is_published?t.published:t.draft}</p>
       <button type="button" disabled={busy} onClick={()=>toggle(p)} className="rounded-lg border border-[#b7dadd] px-3 py-2 text-xs font-semibold text-[#005476] disabled:opacity-50">
         {p.is_published?t.unpublish:t.publish}
       </button>
      </div>
    </div>)}
   </div>
   {query.isSuccess&&query.data.photos.length===0&&<p className="mt-4 text-sm text-[#708d98]">{t.empty}</p>}
 </section>;
}
