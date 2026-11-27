import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Clock3, Construction } from "lucide-react";

type Update = {
  id: string;
  percent_complete: number;
  stage: string;
  note: string | null;
  created_at: string;
};
const labels: Record<string,{title:string,none:string,when:string,error:string}> = {
  ar:{title:"سجل تقدم المشروع",none:"لم تنشر الإدارة تحديثات بناء بعد.",when:"نُشر بتاريخ",error:"تعذر تحميل تحديثات البناء"},
  en:{title:"Construction timeline",none:"No published construction updates yet.",when:"Published",error:"Construction updates are unavailable"},
  he:{title:"התקדמות הבנייה",none:"עדיין אין עדכונים שפורסמו.",when:"פורסם",error:"לא ניתן לטעון עדכונים"},
  tr:{title:"İnşaat ilerleme geçmişi",none:"Henüz yayımlanan güncelleme yok.",when:"Yayımlandı",error:"Güncellemeler yüklenemiyor"},
  az:{title:"Tikinti gedişatı",none:"Hələ dərc olunan yenilik yoxdur.",when:"Dərc edilib",error:"Yeniliklər yüklənmir"}
};
export default function VipProjectProgress({projectId}:{projectId:string}) {
  const {i18n}=useTranslation();
  const t=labels[i18n.language.split("-")[0]]||labels.en;
  const query=useQuery<{updates:Update[]}>({
    queryKey:["vip","project-progress",projectId],
    queryFn:async()=>{
      const result=await fetch("/api/vip/projects/"+encodeURIComponent(projectId)+"/progress",{
        credentials:"include",cache:"no-store"
      });
      if(!result.ok)throw Error("Progress unavailable");
      return result.json();
    },
    enabled:!!projectId,
    retry:false
  });
  if(query.isPending)return <div aria-busy="true" className="mt-4 h-10 animate-pulse rounded-xl bg-[#e6eff1]"/>;
  if(query.isError)return <p role="status" className="mt-4 text-xs text-amber-900">{t.error}</p>;
  const updates=query.data.updates;
  return <section className="mt-5 border-t border-[#e5eff0] pt-4">
    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
      <Construction className="h-4 w-4 text-[#159a99]"/>{t.title}
    </h4>
    {updates.length===0?<p className="text-xs text-[#6c8895]">{t.none}</p>:(
      <ol className="space-y-3">
        {updates.slice(0,5).map(u=><li key={u.id} className="relative border-s-2 border-[#3BCAC4] ps-3">
          <div className="flex items-start justify-between gap-3">
            <span className="text-sm font-medium">{u.stage}</span>
            <strong className="text-sm text-[#007f86]">{u.percent_complete}%</strong>
          </div>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-[#76909b]">
            <Clock3 className="h-3 w-3"/>{t.when}: {new Date(u.created_at).toLocaleDateString(i18n.language, {year:"numeric",month:"short",day:"numeric"})}
          </p>
          {u.note && <p className="mt-1 text-xs leading-relaxed text-[#617985]">{u.note}</p>}
        </li>)}
      </ol>
    )}
  </section>;
}
