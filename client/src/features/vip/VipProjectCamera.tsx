import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ExternalLink, Video, VideoOff } from "lucide-react";

type CameraResult={available:boolean;camera?:{label:string;url:string;updatedAt:string}};
const copy:Record<string,Record<string,string>>={
 ar:{title:"كاميرا المشروع",available:"مشاهدة الكاميرا المباشرة",none:"لا يوجد بث مباشر متاح لهذا المشروع حاليًا.",note:"مشغّل RTSP.RUN متاح للبث العام، وقد يحتاج فتحه في نافذة مستقلة إذا لم يسمح بالتضمين.",inline:"تشغيل الكاميرا داخل الصفحة",close:"إغلاق المشغّل",fallback:"فتح المشغّل مباشرة"},
 en:{title:"Project live camera",available:"Watch live camera",none:"No live camera is currently available for this project.",note:"RTSP.RUN is for public streams. If embedding is blocked, open the player separately.",inline:"Play inside VIP",close:"Close player",fallback:"Open player in new tab"},
 he:{title:"מצלמת הפרויקט",available:"צפייה במצלמה",none:"אין שידור זמין כרגע.",note:"השידור הרשמי עשוי להיפתח בחלון נפרד.",inline:"הצג בדף",close:"סגור",fallback:"פתח נגן"},
 tr:{title:"Proje canlı kamerası",available:"Canlı kamerayı izle",none:"Bu proje için canlı kamera mevcut değil.",note:"RTSP.RUN yalnızca genel erişimli yayınlar içindir.",inline:"VIP içinde oynat",close:"Oynatıcıyı kapat",fallback:"Yeni sekmede aç"},
 az:{title:"Layihənin canlı kamerası",available:"Canlı kameraya bax",none:"Hazırda canlı kamera mövcud deyil.",note:"RTSP.RUN ictimai yayımlar üçündür.",inline:"VIP-də göstər",close:"Bağla",fallback:"Yeni vərəqdə aç"}
};
export default function VipProjectCamera({projectId}:{projectId:string}){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const [playing,setPlaying]=useState(false);
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
    {(() => {
      const camera=data.data.camera;
      // The backend has already validated the URL against the approved HTTPS
      // provider allowlist. The browser only embeds the official RTSP.RUN host
      // after the owner explicitly clicks Play.
      const host=new URL(camera.url).hostname.toLowerCase();
      const isRtspRun=host==="rtsp.run"||host==="www.rtsp.run";
      return <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {isRtspRun&&<button type="button" onClick={()=>setPlaying(p=>!p)}
            className="inline-flex items-center gap-2 rounded-xl bg-[#005476] px-4 py-3 text-sm font-semibold text-white">
            <Video className="h-5 w-5"/>{playing?t.close:t.inline}
          </button>}
          <a href={camera.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
            className="inline-flex items-center gap-2 rounded-xl border border-[#b8d7db] bg-[#f6fbfb] px-4 py-3 text-sm font-semibold text-[#005476]">
            <ExternalLink className="h-4 w-4"/>{isRtspRun?t.fallback:t.available}
          </a>
        </div>
        {isRtspRun&&playing&&<div className="overflow-hidden rounded-xl border border-[#c6e0e3] bg-[#001e32]">
          <iframe title={camera.label} src={camera.url}
            referrerPolicy="no-referrer" loading="lazy" allow="autoplay; fullscreen; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-presentation"
            className="aspect-video w-full" />
        </div>}
      </div>;
    })()}
    <p className="mt-2 text-xs text-[#718c99]">{t.note}</p>
   </>}
 </section>;
}
