import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ExternalLink, Video, VideoOff } from "lucide-react";

type CameraResult={available:boolean;camera?:{label:string;url:string;updatedAt:string}};
const copy:Record<string,Record<string,string>>={
 ar:{title:"كاميرا المشروع",available:"مشاهدة الكاميرا المباشرة",none:"لا يوجد بث مباشر متاح لهذا المشروع حاليًا.",note:"يُفتح رابط البث الرسمي الخاص بالمطور في صفحة آمنة جديدة."},
 en:{title:"Project live camera",available:"Watch live camera",none:"No live camera is currently available for this project.",note:"The developer's approved stream opens in a new tab."},
 he:{title:"מצלמת הפרויקט",available:"צפייה במצלמה",none:"אין שידור זמין כרגע.",note:"השידור הרשמי נפתח בכרטיסייה חדשה."},
 tr:{title:"Proje canlı kamerası",available:"Canlı kamerayı izle",none:"Bu proje için canlı kamera mevcut değil.",note:"Onaylı resmi yayın yeni sekmede açılır."},
 az:{title:"Layihənin canlı kamerası",available:"Canlı kameraya bax",none:"Hazırda canlı kamera mövcud deyil.",note:"Rəsmi yayım yeni vərəqdə açılır."}
};
export default function VipProjectCamera({projectId}:{projectId:string}){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const data=useQuery<CameraResult>({
   queryKey:["vip","camera",projectId],
   queryFn:async()=>{const r=await fetch("/api/vip/projects/"+encodeURIComponent(projectId)+"/camera",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
   enabled:!!projectId,retry:false
 });
 if(data.isPending||data.isError)return null;
 return <section className="mt-5 border-t border-[#e2eef0] pt-4">
  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Video className="h-4 w-4 text-[#008c93]"/>{t.title}</h4>
  {!data.data.available||!data.data.camera?<p className="flex items-center gap-2 text-xs text-[#718c99]"><VideoOff className="h-4 w-4"/>{t.none}</p>:
   <>
    <a href={data.data.camera.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
       className="inline-flex items-center gap-2 rounded-xl border border-[#b8d7db] bg-[#f6fbfb] px-4 py-3 text-sm font-semibold text-[#005476]">
      <Video className="h-5 w-5"/>{t.available} · {data.data.camera.label}<ExternalLink className="h-4 w-4"/>
    </a>
    <p className="mt-2 text-xs text-[#718c99]">{t.note}</p>
   </>}
 </section>;
}
