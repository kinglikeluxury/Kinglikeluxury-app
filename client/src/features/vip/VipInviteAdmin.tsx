import { useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MailCheck, UserPlus } from "lucide-react";

type Project={id:string;name:string};
type Unit={id:string;project_id:string;unit_number:string;owner_id:number|null};
type Catalog={projects:Project[];units:Unit[]};
const copy:Record<string,Record<string,string>>={
 ar:{title:"دعوة عميل إلى KINGLIKE VIP",unit:"العقار والوحدة",email:"البريد الإلكتروني للعميل",send:"إرسال دعوة تفعيل آمنة",sending:"جاري إرسال الدعوة...",sent:"تم إرسال دعوة التفعيل بنجاح. لا يُنشأ حساب أو يُفتح العقار إلا بعد قبول العميل للدعوة.",none:"أضف وحدة غير مرتبطة بعميل أولًا.",error:"تعذر إرسال الدعوة. تحقق من إعدادات البريد والصلاحيات."},
 en:{title:"Invite a VIP client",unit:"Property and unit",email:"Client email",send:"Send secure activation invitation",sending:"Sending invitation...",sent:"Invitation sent. Access is granted only after the buyer accepts it.",none:"Create an unassigned unit first.",error:"Invitation could not be sent."},
 he:{title:"הזמנת לקוח VIP",unit:"יחידה",email:"דוא״ל הלקוח",send:"שליחת הזמנה מאובטחת",sending:"שולח...",sent:"ההזמנה נשלחה.",none:"תחילה יש להוסיף יחידה פנויה.",error:"לא ניתן לשלוח הזמנה."},
 tr:{title:"VIP müşterisini davet et",unit:"Mülk ve ünite",email:"Müşteri e-postası",send:"Güvenli davet gönder",sending:"Gönderiliyor...",sent:"Davet gönderildi. Müşteri kabul ettikten sonra erişim açılır.",none:"Önce boş bir ünite ekleyin.",error:"Davet gönderilemedi."},
 az:{title:"VIP müştərisini dəvət et",unit:"Mənzil",email:"Müştərinin e-poçtu",send:"Təhlükəsiz dəvət göndər",sending:"Göndərilir...",sent:"Dəvət göndərildi. Yalnız qəbul edildikdən sonra giriş açılır.",none:"Əvvəlcə boş mənzil əlavə edin.",error:"Dəvət göndərilmədi."}
};
export default function VipInviteAdmin(){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const qc=useQueryClient();
 const catalog=useQuery<Catalog>({
   queryKey:["vip","admin","projects"],
   queryFn:async()=>{const r=await fetch("/api/admin/vip/projects",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const available=useMemo(()=>catalog.data?.units.filter(u=>!u.owner_id)||[],[catalog.data]);
 const [choice,setChoice]=useState("");
 const [email,setEmail]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [okay,setOkay]=useState(false);
 const selected=available.some(u=>u.id===choice)?choice:available[0]?.id||"";
 async function submit(e:FormEvent<HTMLFormElement>){
   e.preventDefault();if(!selected||busy)return;
   setBusy(true);setMessage("");
   try{
     const r=await fetch("/api/admin/vip/invitations",{
       method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({unitId:selected,email:email.trim().toLowerCase()})
     });
     if(!r.ok){const j=await r.json().catch(()=>null);throw Error(j?.error||t.error)}
     setOkay(true);setMessage(t.sent);setEmail("");
     await qc.invalidateQueries({queryKey:["vip","admin","overview"]});
   }catch(e){setOkay(false);setMessage(e instanceof Error?e.message:t.error)}
   finally{setBusy(false)}
 }
 return <section className="mt-8 rounded-2xl border border-[#d5e7e9] bg-white p-5 md:p-6">
   <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold"><UserPlus className="h-5 w-5 text-[#008e94]"/>{t.title}</h3>
   <form onSubmit={submit} className="grid gap-4 md:grid-cols-3">
     <label className="block text-sm"><span className="mb-2 block">{t.unit}</span>
       <select className="w-full rounded-xl border border-[#cbdfe1] bg-white p-3" value={selected}
         onChange={e=>setChoice(e.target.value)} disabled={!available.length}>
         {!available.length?<option value="">{t.none}</option>:available.map(u=><option value={u.id} key={u.id}>
           {catalog.data?.projects.find(p=>p.id===u.project_id)?.name} · {u.unit_number}
         </option>)}
       </select>
     </label>
     <label className="block text-sm"><span className="mb-2 block">{t.email}</span>
       <input className="w-full rounded-xl border border-[#cbdfe1] p-3" type="email" required
         value={email} maxLength={254} onChange={e=>setEmail(e.target.value)}/>
     </label>
     <div className="flex items-end">
       <button className="flex items-center gap-2 rounded-xl bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
         type="submit" disabled={busy||!selected||catalog.isError}>
         <MailCheck className="h-4 w-4"/>{busy?t.sending:t.send}
       </button>
     </div>
   </form>
   {message&&<p role="status" className={"mt-4 rounded-xl px-4 py-3 text-sm "+(okay?"bg-emerald-50 text-emerald-800":"bg-red-50 text-red-800")}>{message}</p>}
 </section>;
}
