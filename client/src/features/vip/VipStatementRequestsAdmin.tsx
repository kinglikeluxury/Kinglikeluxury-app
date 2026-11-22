import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {FileUp,FileCheck2} from "lucide-react";
type RequestRow={id:string;unit_id:string;project_name:string;unit_number:string;client_name:string;client_email:string|null;status:string;month_start:string;created_at:string};
type Words={title:string;follow:string;new:string;following_up:string;available:string;empty:string;error:string;source:string;file:string;verified:string;upload:string;sent:string;invalid:string;note:string};
const copy:Record<string,Words>={
 ar:{title:"طلبات كشوف الحساب الرسمية",follow:"بدء المتابعة مع المطور",new:"جديد",following_up:"نتابع مع المطور",available:"كشف رسمي متاح",empty:"لا توجد طلبات حاليًا",error:"تعذر تنفيذ العملية",source:"مصدر المستند: اسم المطور وتاريخ الاستلام",file:"كشف الحساب الرسمي PDF",verified:"أؤكد أن الملف وصل من المطور بالفعل وليس كشفًا تجريبيًا أو حسابًا داخليًا",upload:"إرفاق الكشف الرسمي للعميل",sent:"تم إرفاق الملف للعميل",invalid:"اختر PDF رسميًا وأكّد مصدره قبل الإرسال",note:"لا يظهر للعميل أي مستند قبل استلامه الفعلي وإقراره من الإدارة."},
 en:{title:"Official developer statement requests",follow:"Mark developer follow-up",new:"New",following_up:"Following up",available:"Official PDF available",empty:"No requests",error:"Operation failed",source:"Source: developer name and date received",file:"Official PDF statement",verified:"I confirm this PDF actually came from the developer, not an internal projection",upload:"Attach official statement",sent:"Official document attached",invalid:"Select an official PDF and confirm its source",note:"Never publish a placeholder or internal financial summary as an official document."},
 he:{title:"בקשות לדוחות רשמיים",follow:"מעקב מול היזם",new:"חדש",following_up:"במעקב",available:"דוח רשמי",empty:"אין בקשות",error:"שגיאה",source:"שם היזם ותאריך קבלה",file:"מסמך PDF רשמי",verified:"אני מאשר שהמסמך התקבל מהיזם",upload:"צרף",sent:"צורף",invalid:"דרוש PDF ואישור",note:"לא מפרסמים דוח ללא אסמכתא."},
 tr:{title:"Resmi geliştirici döküm talepleri",follow:"Geliştiriciyle takip",new:"Yeni",following_up:"Takipte",available:"Resmi PDF hazır",empty:"Talep yok",error:"İşlem başarısız",source:"Geliştirici adı ve teslim tarihi",file:"Resmi PDF",verified:"PDF'in geliştiriciden geldiğini onaylıyorum",upload:"Resmi belge ekle",sent:"Belge eklendi",invalid:"PDF ve onay gerekli",note:"Taslak veya iç hesap özeti resmi belge olarak paylaşılmaz."},
 az:{title:"Rəsmi çıxarış sorğuları",follow:"Tikinti şirkəti ilə əlaqə",new:"Yeni",following_up:"İzlənilir",available:"Rəsmi PDF hazır",empty:"Sorğu yoxdur",error:"Əməliyyat alınmadı",source:"Tikinti şirkəti və alınma tarixi",file:"Rəsmi PDF",verified:"PDF-in tikinti şirkətindən gəldiyini təsdiqləyirəm",upload:"Sənəd əlavə et",sent:"Əlavə edildi",invalid:"PDF və təsdiq tələb olunur",note:"Daxili hesablamalar rəsmi sənəd kimi paylaşılmır."}
};
export default function VipStatementRequestsAdmin(){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const qc=useQueryClient();
 const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState("");
 const [notes,setNotes]=useState<Record<string,string>>({});
 const [files,setFiles]=useState<Record<string,File|null>>({});
 const [confirmed,setConfirmed]=useState<Record<string,boolean>>({});
 const query=useQuery<{requests:RequestRow[]}>({
  queryKey:["vip","admin","statement-requests"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/statement-requests",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 async function follow(id:string){
  if(busy)return;setBusy(true);setFeedback("");
  try{
   const r=await fetch("/api/admin/vip/statement-requests/"+encodeURIComponent(id),{
    method:"PATCH",credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({status:"following_up"})
   });
   if(!r.ok)throw Error(t.error);
   await qc.invalidateQueries({queryKey:["vip","admin","statement-requests"]});
  }catch{setFeedback(t.error)}finally{setBusy(false)}
 }
 async function attach(id:string){
  const file=files[id],note=notes[id]?.trim()||"";
  if(!file||file.type!=="application/pdf"||file.size>10*1024*1024||note.length<8||!confirmed[id]){
   setFeedback(t.invalid);return;
  }
  setBusy(true);setFeedback("");
  const body=new FormData();
  body.set("statement",file);
  body.set("sourceNote",note);
  body.set("developerConfirmed","true");
  try{
   const r=await fetch("/api/admin/vip/statement-requests/"+encodeURIComponent(id)+"/document",{
    method:"POST",credentials:"include",body
   });
   if(!r.ok)throw Error(t.error);
   await Promise.all([
    qc.invalidateQueries({queryKey:["vip","admin","statement-requests"]}),
    qc.invalidateQueries({queryKey:["vip","statement-requests"]})
   ]);
   setFeedback(t.sent);
  }catch{setFeedback(t.error)}finally{setBusy(false)}
 }
 return <section className="mt-9">
  <h2 className="mb-4 text-xl font-semibold">{t.title}</h2>
  {feedback&&<p role="status" className="mb-3 text-xs text-[#005476]">{feedback}</p>}
  {query.isError?<p role="alert" className="rounded-xl bg-amber-50 p-4">{t.error}</p>:
   query.isPending?<p>…</p>:query.data.requests.length===0?<p className="rounded-xl bg-white p-5">{t.empty}</p>:
   <div className="grid gap-3">{query.data.requests.map(request=><article key={request.id} className="rounded-xl border border-[#d3e7e8] bg-white p-5">
    <div className="font-semibold">{request.client_name} · {request.project_name} / {request.unit_number}</div>
    <div className="mt-1 text-sm text-[#5e7b8a]">{request.client_email} · {String(request.month_start).slice(0,7)}</div>
    <p className="my-2 text-sm">{request.status==="available"?t.available:request.status==="following_up"?t.following_up:t[request.status as "new"]||request.status}</p>
    {request.status==="new"&&<button type="button" disabled={busy} onClick={()=>void follow(request.id)}
     className="rounded-lg border border-[#005476] px-4 py-2 text-sm font-medium text-[#005476] disabled:opacity-50">{t.follow}</button>}
    {(request.status==="new"||request.status==="following_up"||request.status==="received")&&
     <div className="mt-3 rounded-xl bg-[#f4f9f9] p-4">
      <label className="block text-xs">{t.source}
       <input value={notes[request.id]||""} onChange={e=>setNotes(s=>({...s,[request.id]:e.target.value}))}
        maxLength={200} className="mt-2 block w-full rounded-lg border border-[#cbdfe0] bg-white p-3" />
      </label>
      <label className="mt-3 block text-xs">{t.file}
       <input type="file" accept="application/pdf,.pdf" className="mt-2 block w-full text-xs"
        onChange={e=>setFiles(s=>({...s,[request.id]:e.target.files?.[0]||null}))}/>
      </label>
      <label className="mt-3 flex items-start gap-2 text-xs">
       <input type="checkbox" checked={confirmed[request.id]||false}
        onChange={e=>setConfirmed(s=>({...s,[request.id]:e.target.checked}))}/>
       <span>{t.verified}</span>
      </label>
      <button type="button" disabled={busy||!(confirmed[request.id]&&files[request.id]&&notes[request.id]?.trim().length>=8)}
       onClick={()=>void attach(request.id)}
       className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
       <FileUp className="h-4 w-4"/>{t.upload}</button>
     </div>}
    {request.status==="available"&&<p className="mt-3 flex items-center gap-2 text-xs text-emerald-800"><FileCheck2 className="h-4 w-4"/>{t.sent}</p>}
   </article>)}</div>}
  <p className="mt-3 text-xs text-[#72909b]">{t.note}</p>
 </section>;
}
