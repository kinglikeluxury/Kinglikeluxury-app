import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Images } from "lucide-react";
type Photo={id:string;photo_date:string;caption:string|null;created_at:string};
const copy:Record<string,Record<string,string>>={
 ar:{title:"صور تقدم البناء",empty:"لم تنشر الإدارة صورًا جديدة لهذا المشروع بعد.",date:"تاريخ الصورة"},
 en:{title:"Construction photo updates",empty:"No published construction photos yet.",date:"Photo date"},
 he:{title:"תמונות התקדמות",empty:"עדיין אין תמונות שפורסמו.",date:"תאריך צילום"},
 tr:{title:"İnşaat fotoğrafları",empty:"Henüz yayımlanan fotoğraf yok.",date:"Fotoğraf tarihi"},
 az:{title:"Tikinti foto yenilikləri",empty:"Hələ yayımlanmış şəkil yoxdur.",date:"Şəkil tarixi"}
};
export default function VipProjectPhotos({projectId}:{projectId:string}){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const photos=useQuery<{photos:Photo[]}>({
  queryKey:["vip","project-photos",projectId],
  queryFn:async()=>{const r=await fetch("/api/vip/projects/"+encodeURIComponent(projectId)+"/photos",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!projectId,retry:false
 });
 return <section className="mt-5 border-t border-[#e4eef0] pt-4">
  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Images className="h-5 w-5 text-[#138f94]"/>{t.title}</h4>
  {photos.isPending?<div className="h-16 animate-pulse rounded-xl bg-[#e8f2f3]"/>:photos.isError?null:
   photos.data.photos.length===0?<p className="text-xs text-[#6a8995]">{t.empty}</p>:
   <div className="grid grid-cols-2 gap-3">{photos.data.photos.slice(0,12).map(p=>
    <figure key={p.id} className="overflow-hidden rounded-xl border border-[#dce9ec]">
      <img className="aspect-[4/3] w-full object-cover" loading="lazy"
        src={"/api/vip/photos/"+encodeURIComponent(p.id)+"/view"} alt={p.caption||t.title}/>
      <figcaption className="p-2 text-[11px] text-[#557887]">
        <span className="font-semibold">{t.date}: {p.photo_date}</span>
        {p.caption&&<p className="mt-1">{p.caption}</p>}
      </figcaption>
    </figure>)}</div>}
 </section>;
}
