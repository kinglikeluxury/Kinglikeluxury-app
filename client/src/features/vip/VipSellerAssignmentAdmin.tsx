import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {BriefcaseBusiness,UserRoundCheck,ShieldCheck} from "lucide-react";

type Project={id:string;name:string};
type Unit={id:string;project_id:string;unit_number:string;owner_id:number|null;owner_email:string|null};
type Assignment={unit_id:string;seller_user_id:string;seller_email:string;project_name:string;unit_number:string};
const strings:Record<string,Record<string,string>>={
 ar:{title:"تعيين الموظف المسؤول عن ملف العميل",project:"الوحدة والعميل",seller:"البريد الإلكتروني للموظف الذي أتم البيع",reason:"سبب التعيين أو نقله (إلزامي)",current:"الموظف المعيّن حاليًا",grant:"حفظ الصلاحية",revoke:"سحب صلاحية الموظف",none:"اربط وحدة بعميل أولًا.",success:"تم تحديث الصلاحيات مع تسجيل العملية.",error:"تعذر التحديث؛ تأكد من أن حساب الموظف فعّال ومتحقق منه.",confirm:"هل أنت متأكد من نقل صلاحية العميل إلى الموظف الجديد؟",remove:"هل أنت متأكد من سحب وصول الموظف لهذا الملف؟",notice:"كل وحدة لها موظف مبيعات واحد. يمكنه الاطلاع على ملفها فقط، ولا يحق له تعديل الأقساط أو اعتماد الإيصالات. سحب الصلاحية يسري عند الطلب التالي."},
 en:{title:"Assign the selling agent to client file",project:"Client unit",seller:"Verified staff email",reason:"Reason for assignment or transfer (required)",current:"Assigned agent",grant:"Save access",revoke:"Revoke staff access",none:"Assign a unit to a buyer first.",success:"Permission saved and audited.",error:"Could not update; staff account must be active and verified.",confirm:"Transfer client access to the new selling agent?",remove:"Revoke this agent's access to the client?",notice:"One selling agent per unit. Read-only access, no financial approvals. Revocation takes effect on subsequent requests."},
 he:{title:"שיוך נציג מכירות",project:"יחידה",seller:"דוא״ל הנציג",reason:"סיבת השיוך או השינוי",current:"נציג משויך",grant:"שמירה",revoke:"ביטול גישה",none:"שייך לקוח ליחידה תחילה.",success:"עודכן",error:"העדכון נכשל",confirm:"להעביר הרשאה?",remove:"לבטל הרשאה?",notice:"נציג אחד ליחידה, הרשאת צפייה בלבד."},
 tr:{title:"Satış personelini müşteriye ata",project:"Müşteri ünitesi",seller:"Personel e-postası",reason:"Atama/değişim nedeni",current:"Atanan personel",grant:"Erişimi kaydet",revoke:"Yetkiyi kaldır",none:"Önce müşteriyi atayın.",success:"Yetki kaydedildi.",error:"Yetki güncellenemedi.",confirm:"Yetkiyi aktar?",remove:"Yetkiyi kaldır?",notice:"Ünite başına bir personel; sadece görüntüleme izni."},
 az:{title:"Satış əməkdaşını təyin et",project:"Mənzil",seller:"İşçi e-poçtu",reason:"Təyinat səbəbi",current:"Təyin edilmiş əməkdaş",grant:"Saxla",revoke:"Ləğv et",none:"Əvvəlcə müştərini təyin edin.",success:"Saxlandı",error:"Yenilənmə alınmadı",confirm:"İcazə köçürülsün?",remove:"İcazə ləğv edilsin?",notice:"Hər mənzil üçün bir əməkdaş; yalnız oxuma icazəsi."}
};
export default function VipSellerAssignmentAdmin(){
 const {i18n}=useTranslation();const t=strings[i18n.language.split("-")[0]]||strings.en;
 const qc=useQueryClient();
 const catalog=useQuery<{projects:Project[];units:Unit[]}>({
  queryKey:["vip","admin","projects"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/projects",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const assigned=useQuery<{assignments:Assignment[]}>({
  queryKey:["vip","admin","seller-assignments"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/seller-assignments",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const available=catalog.data?.units.filter(u=>u.owner_id)||[];
 const [choice,setChoice]=useState("");const [email,setEmail]=useState("");const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [success,setSuccess]=useState(false);
 const unitId=available.some(u=>u.id===choice)?choice:available[0]?.id||"";
 const selected=available.find(u=>u.id===unitId);
 const current=assigned.data?.assignments.find(x=>x.unit_id===unitId);
 const valid=reason.trim().length>=10&&reason.trim().length<=240;
 async function run(method:"PUT"|"DELETE"){
  if(!unitId||!valid||busy)return;
  if(current&&method==="PUT"&&!window.confirm(t.confirm))return;
  if(current&&method==="DELETE"&&!window.confirm(t.remove))return;
  setBusy(true);setMessage("");setSuccess(false);
  try{
   const r=await fetch("/api/admin/vip/units/"+encodeURIComponent(unitId)+"/seller",{
    method,credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify(method==="PUT"?{email,reason}:{reason})
   });
   if(!r.ok){const msg=await r.json().catch(()=>({error:t.error}));throw Error(msg.error||t.error)}
   await qc.invalidateQueries({queryKey:["vip","admin","seller-assignments"]});
   setReason("");setEmail("");setSuccess(true);setMessage(t.success);
  }catch(e){setMessage(e instanceof Error?e.message:t.error);setSuccess(false)}
  finally{setBusy(false)}
 }
 function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();void run("PUT")}
 return <section className="mt-9 rounded-2xl border border-[#d7e9e9] bg-white p-5 md:p-6">
  <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><BriefcaseBusiness className="h-6 w-6 text-[#008d91]"/>{t.title}</h2>
  <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
   <label className="text-sm">{t.project}
    <select className="mt-2 block w-full rounded-xl border border-[#cfe3e4] p-3" value={unitId} onChange={e=>{setChoice(e.target.value);setMessage("")}} disabled={!available.length}>
     {!available.length?<option>{t.none}</option>:available.map(u=><option key={u.id} value={u.id}>
      {catalog.data?.projects.find(p=>p.id===u.project_id)?.name} · {u.unit_number} ({u.owner_email||"—"})
     </option>)}
    </select>
   </label>
   <label className="text-sm">{t.seller}
    <input type="email" autoComplete="off" required maxLength={254} value={email} onChange={e=>setEmail(e.target.value)}
      className="mt-2 block w-full rounded-xl border border-[#cfe3e4] p-3" />
   </label>
   <div className="md:col-span-2">
    <p className="text-sm">{t.current}: <strong dir="ltr">{current?.seller_email||"—"}</strong></p>
    <label className="mt-3 block text-sm">{t.reason}
     <textarea value={reason} onChange={e=>setReason(e.target.value)} required minLength={10} maxLength={240} rows={2}
       className="mt-2 block w-full rounded-xl border border-[#cfe3e4] p-3"/>
    </label>
   </div>
   <div className="flex flex-wrap gap-3 md:col-span-2">
    <button type="submit" disabled={!unitId||!valid||busy||catalog.isError||assigned.isError}
      className="inline-flex items-center gap-2 rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
      <UserRoundCheck className="h-4 w-4"/>{t.grant}</button>
    {current&&<button type="button" onClick={()=>void run("DELETE")} disabled={!unitId||!valid||busy}
      className="rounded-xl border border-rose-300 px-5 py-3 text-sm font-semibold text-rose-800 disabled:opacity-50">{t.revoke}</button>}
   </div>
  </form>
  {message&&<p role="status" className={"mt-4 text-sm "+(success?"text-emerald-800":"text-rose-700")}>{message}</p>}
  <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-[#6c8a94]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.notice}</p>
 </section>;
}
