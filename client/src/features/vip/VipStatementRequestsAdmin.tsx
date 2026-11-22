import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
type R = {id:string;project_name:string;unit_number:string;client_name:string;client_email:string|null;status:string;created_at:string};
const words:Record<string,{title:string,follow:string,new:string,following_up:string,empty:string,error:string}>={
  ar:{title:"طلبات كشوف الحساب الرسمية",follow:"بدء المتابعة مع المطور",new:"جديد",following_up:"نتابع مع المطور",empty:"لا توجد طلبات حاليًا",error:"تعذر تحميل الطلبات"},
  en:{title:"Official statement requests",follow:"Mark developer follow-up",new:"New",following_up:"Following up",empty:"No requests",error:"Requests unavailable"},
  he:{title:"בקשות לדוחות רשמיים",follow:"מעקב מול היזם",new:"חדש",following_up:"במעקב",empty:"אין בקשות",error:"הבקשות אינן זמינות"},
  tr:{title:"Resmi hesap dökümü talepleri",follow:"Geliştirici ile takip et",new:"Yeni",following_up:"Takipte",empty:"Talep yok",error:"Talepler yüklenemiyor"},
  az:{title:"Rəsmi çıxarış sorğuları",follow:"Tikinti şirkəti ilə izlə",new:"Yeni",following_up:"İzlənilir",empty:"Sorğu yoxdur",error:"Sorğular yüklənmədi"}
};
export default function VipStatementRequestsAdmin() {
  const {i18n}=useTranslation();
  const t=words[i18n.language.split("-")[0]]||words.en;
  const qc=useQueryClient();
  const query=useQuery<{requests:R[]}>({
    queryKey:["vip","admin","statement-requests"],
    queryFn:async()=>{const r=await fetch("/api/admin/vip/statement-requests",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
    retry:false
  });
  const update=useMutation({
    mutationFn:async(id:string)=>{
      const r=await fetch("/api/admin/vip/statement-requests/"+encodeURIComponent(id),{
        method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({status:"following_up"})
      });if(!r.ok)throw Error("Update failed");return r.json();
    },
    onSuccess:()=>{qc.invalidateQueries({queryKey:["vip","admin","statement-requests"]});qc.invalidateQueries({queryKey:["vip","admin","overview"]})}
  });
  return <section className="mt-9">
    <h2 className="mb-4 text-xl font-semibold">{t.title}</h2>
    {query.isError?<p role="alert" className="rounded-xl bg-amber-50 p-4">{t.error}</p>:
      query.isPending?<p>…</p>:query.data.requests.length===0?<p className="rounded-xl bg-white p-5">{t.empty}</p>:
      <div className="grid gap-3">{query.data.requests.map(request=>
        <article key={request.id} className="rounded-xl border border-[#d3e7e8] bg-white p-5">
          <div className="font-semibold">{request.client_name} · {request.project_name} / {request.unit_number}</div>
          <div className="mt-1 text-sm text-[#5e7b8a]">{request.client_email} · {String(request.created_at).slice(0,10)}</div>
          <p className="my-2 text-sm">{t[request.status as "new"|"following_up"]||request.status}</p>
          {request.status==="new"&&<button type="button" disabled={update.isPending}
            onClick={()=>update.mutate(request.id)}
            className="rounded-lg border border-[#005476] px-4 py-2 text-sm font-medium text-[#005476] disabled:opacity-50">{t.follow}</button>}
        </article>
      )}</div>}
  </section>
}
