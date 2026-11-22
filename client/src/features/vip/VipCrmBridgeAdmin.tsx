import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {GitBranch,ShieldCheck,Search,Link2,Unlink2} from "lucide-react";
type Unit={id:string;project_id:string;unit_number:string;owner_id:number|null;owner_email:string|null};
type Project={id:string;name:string};
type Lead={id:number;full_name:string|null;email:string|null;status:string|null;assigned_to:number|null};
type LinkRecord={id:string;unit_id:string;crm_lead_id:number;signed_sale_reference:string;linked_at:string;revoked_at:string|null;buyer_email:string|null;project_name:string;unit_number:string};
const phrases:Record<string,Record<string,string>>={
 ar:{title:"ربط عقار VIP بصفقة CRM موثقة",intro:"الربط للقراءة والتوثيق فقط. لا يغيّر أي بيانات في CRM أو توزيع الموظفين، ولا يعتبر حالة العميل في CRM دليلًا وحده على البيع.",unit:"العقار والعميل",id:"رقم العميل المحتمل في CRM",search:"فحص CRM قراءة فقط",reference:"مرجع العقد الموقّع",note:"ملاحظات التحقق الإداري",identity:"تأكدت من تطابق هوية المشتري مع الحساب والعقد",signed:"اطلعت على عقد بيع موقّع بالفعل",link:"توثيق ارتباط العقار بالصفقة",linked:"ارتباطات CRM المسجّلة",cancel:"إلغاء الربط",reason:"سبب إلغاء أو تصحيح الربط",success:"تم تحديث الربط دون تعديل CRM",error:"تعذر العملية. ربما لم يُجهز اتصال CRM للقراءة فقط أو لا تتطابق بيانات المشتري.",empty:"لا توجد روابط موثقة.",privacy:"الموظفون والعملاء لا يرون هذا الربط الإداري. الربط لا يضمن دفع العمولة أو تنفيذ صفقة ما لم تؤكد مستندات البيع الفعلية."},
 en:{title:"Associate VIP property with documented CRM sale",intro:"Read-only CRM lookup and separate VIP records. No CRM fields, lead assignments or communication settings are modified. Lead status alone is not sale proof.",unit:"Property / buyer",id:"CRM lead ID",search:"Read-only CRM lookup",reference:"Signed contract reference",note:"Verification notes",identity:"I verified the buyer's identity against the signed agreement",signed:"I inspected a genuinely signed sale agreement",link:"Save signed-sale association",linked:"Recorded CRM links",cancel:"Revoke link",reason:"Revocation / correction reason",success:"VIP association updated, CRM untouched",error:"Operation failed. CRM read-only connection may be unconfigured or buyer details may conflict.",empty:"No verified associations.",privacy:"Only management can view this link. It does not independently prove bank payments or commission entitlement."},
 he:{title:"שיוך CRM לנכס VIP",intro:"קריאה בלבד מ-CRM ללא שינוי בו.",unit:"נכס",id:"מספר ליד",search:"בדיקה",reference:"חוזה חתום",note:"הערות",identity:"אישרתי זהות קונה",signed:"ראיתי חוזה חתום",link:"שמירה",linked:"שיוכים",cancel:"ביטול",reason:"סיבה",success:"נשמר",error:"שגיאה",empty:"אין שיוכים",privacy:"מידע למנהלים בלבד."},
 tr:{title:"Belgeli CRM satışını VIP mülküne bağla",intro:"CRM'den yalnızca okuma. CRM müşteri/atama bilgileri değişmez.",unit:"Mülk",id:"CRM lead ID",search:"Salt okunur arama",reference:"İmzalı sözleşme referansı",note:"İnceleme notu",identity:"Alıcı kimliğini doğruladım",signed:"İmzalı sözleşmeyi kontrol ettim",link:"Bağlantıyı kaydet",linked:"CRM ilişkileri",cancel:"İlişkiyi iptal et",reason:"İptal nedeni",success:"Kaydedildi",error:"İşlem başarısız",empty:"Henüz kayıt yok",privacy:"Yalnızca yönetim erişimi; CRM verileri değişmez."},
 az:{title:"CRM satışını VIP mənzilinə bağla",intro:"CRM yalnız oxunur, mövcud CRM sahələri dəyişmir.",unit:"Mənzil",id:"CRM müştəri ID",search:"Yalnız oxuma",reference:"İmzalanmış müqavilə",note:"Yoxlama qeydi",identity:"Alıcının şəxsiyyətini yoxladım",signed:"İmzalı müqaviləni yoxladım",link:"Əlaqəni yadda saxla",linked:"CRM əlaqələri",cancel:"Ləğv et",reason:"Ləğv səbəbi",success:"Saxlandı",error:"Xəta",empty:"Əlaqə yoxdur",privacy:"Yalnız rəhbərlik üçün, CRM məlumatı dəyişmir."}
};
const fieldStyle="mt-1 block w-full rounded-lg border border-[#cfe1e4] p-3 text-sm";
export default function VipCrmBridgeAdmin(){
 const {i18n}=useTranslation();const t=phrases[i18n.language.split("-")[0]]||phrases.en;
 const qc=useQueryClient();
 const [unit,setUnit]=useState(""),[leadId,setLeadId]=useState(""),[lead,setLead]=useState<Lead|null>(null),
 [reference,setReference]=useState(""),[note,setNote]=useState(""),[identity,setIdentity]=useState(false),
 [signed,setSigned]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[revokeReason,setRevokeReason]=useState("");
 const catalog=useQuery<{units:Unit[];projects:Project[]}>({
  queryKey:["vip","admin","projects"],queryFn:async()=>{
   const r=await fetch("/api/admin/vip/projects",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json();
  },retry:false
 });
 const links=useQuery<{links:LinkRecord[]}>({
  queryKey:["vip","admin","crm-links"],queryFn:async()=>{
   const r=await fetch("/api/admin/vip/crm-links",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json();
  },retry:false
 });
 const units=catalog.data?.units.filter(u=>u.owner_id)||[];
 const unitId=unit||units[0]?.id||"";
 async function findLead(){
  if(!/^[1-9]\d*$/.test(leadId))return;
  setBusy(true);setMessage("");setLead(null);
  try{
   const r=await fetch("/api/admin/vip/crm/leads/"+encodeURIComponent(leadId),{credentials:"include",cache:"no-store"});
   if(!r.ok)throw Error("Unavailable");
   const data=await r.json() as {lead:Lead};
   setLead(data.lead);
  }catch{setMessage(t.error)}finally{setBusy(false)}
 }
 async function connect(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!lead||!unitId||busy)return;
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/admin/vip/units/"+encodeURIComponent(unitId)+"/crm-association",{
    method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({leadId:lead.id,signedSaleReference:reference,buyerIdentityConfirmed:identity,contractActuallySigned:signed,note})
   });
   if(!r.ok)throw Error("Failed");
   setMessage(t.success);setLead(null);setLeadId("");setReference("");setNote("");setIdentity(false);setSigned(false);
   await qc.invalidateQueries({queryKey:["vip","admin","crm-links"]});
  }catch{setMessage(t.error)}finally{setBusy(false)}
 }
 async function revoke(id:string){
  if(revokeReason.trim().length<10||busy)return;
  if(!window.confirm(t.cancel+"?"))return;
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/admin/vip/crm-links/"+encodeURIComponent(id),{
    method:"DELETE",credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({reason:revokeReason})
   });
   if(!r.ok)throw Error("Failed");
   setMessage(t.success);setRevokeReason("");
   await qc.invalidateQueries({queryKey:["vip","admin","crm-links"]});
  }catch{setMessage(t.error)}finally{setBusy(false)}
 }
 return <section className="mt-9 rounded-2xl border border-[#d4e8ea] bg-white p-5 md:p-6">
  <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold"><GitBranch className="h-6 w-6 text-[#008d91]"/>{t.title}</h2>
  <p className="mb-5 text-xs leading-relaxed text-[#6e8b95]">{t.intro}</p>
  <form className="grid gap-3 sm:grid-cols-2" onSubmit={connect}>
   <label className="text-sm">{t.unit}
    <select className={fieldStyle} value={unitId} onChange={e=>setUnit(e.target.value)}>
     {units.map(x=><option key={x.id} value={x.id}>{catalog.data?.projects.find(p=>p.id===x.project_id)?.name} · {x.unit_number} · {x.owner_email}</option>)}
    </select>
   </label>
   <label className="text-sm">{t.id}
    <div className="mt-1 flex gap-2">
     <input type="number" min={1} step={1} value={leadId} onChange={e=>{setLeadId(e.target.value);setLead(null)}} className="min-w-0 flex-1 rounded-lg border border-[#cfe1e4] p-3"/>
     <button type="button" onClick={()=>void findLead()} disabled={busy} className="rounded-lg border border-[#8acbc9] px-3 text-sm"><Search className="h-4 w-4"/></button>
    </div>
   </label>
   {lead&&<p className="rounded-xl bg-[#f3faf9] p-4 text-sm sm:col-span-2">
    {lead.full_name||"—"} · {lead.email||"—"} · {lead.status||"—"} · #{lead.id}
   </p>}
   <label className="text-sm">{t.reference}<input required minLength={8} maxLength={120} className={fieldStyle} value={reference} onChange={e=>setReference(e.target.value)}/></label>
   <label className="text-sm">{t.note}<textarea required minLength={10} maxLength={400} rows={2} className={fieldStyle} value={note} onChange={e=>setNote(e.target.value)}/></label>
   <label className="flex items-start gap-2 text-xs"><input type="checkbox" required checked={identity} onChange={e=>setIdentity(e.target.checked)}/>{t.identity}</label>
   <label className="flex items-start gap-2 text-xs"><input type="checkbox" required checked={signed} onChange={e=>setSigned(e.target.checked)}/>{t.signed}</label>
   <button disabled={!lead||!unitId||!identity||!signed||busy} className="inline-flex items-center gap-2 rounded-xl bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
    <Link2 className="h-4 w-4"/>{t.link}</button>
  </form>
  {message&&<p role="status" className="mt-3 text-xs text-[#005476]">{message}</p>}
  <div className="mt-6">
   <h3 className="mb-3 font-semibold">{t.linked}</h3>
   {!links.data?.links.length?<p className="text-sm text-[#7b919a]">{t.empty}</p>:
   <div className="space-y-2">{links.data.links.map(x=><div key={x.id} className="rounded-xl border border-[#d9e8e9] p-4 text-sm">
     <strong>{x.project_name} · {x.unit_number}</strong>
     <p className="mt-1 text-xs text-[#6b8793]">CRM #{x.crm_lead_id} · {x.signed_sale_reference} · {x.buyer_email}</p>
     {x.revoked_at?<p className="mt-2 text-xs text-rose-700">Revoked {new Date(x.revoked_at).toLocaleDateString(i18n.language)}</p>:
      <div className="mt-3 flex flex-wrap gap-2">
       <input value={revokeReason} onChange={e=>setRevokeReason(e.target.value)} minLength={10} maxLength={350} placeholder={t.reason}
        className="min-w-0 flex-1 rounded-lg border border-[#d4e4e5] p-2 text-xs"/>
       <button type="button" disabled={busy||revokeReason.trim().length<10} onClick={()=>void revoke(x.id)}
        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 text-xs text-rose-800 disabled:opacity-50">
        <Unlink2 className="h-4 w-4"/>{t.cancel}</button>
      </div>}
    </div>)}</div>}
  </div>
  <p className="mt-5 flex gap-2 text-xs text-[#71909b]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.privacy}</p>
 </section>;
}
