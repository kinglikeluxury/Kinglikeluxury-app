import {useState,type FormEvent} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {BellRing,ShieldCheck} from "lucide-react";
type Unit={id:string;project_id:string;unit_number:string;owner_id:number|null};
type Project={id:string;name:string};
const texts:Record<string,Record<string,string>>={
 ar:{title:"إرسال إشعار خاص بالوحدة",unit:"العقار والوحدة",subject:"عنوان الإشعار",body:"نص الرسالة",send:"إرسال داخل تطبيق VIP",success:"تم إرسال الإشعار إلى حساب العميل.",error:"تعذر إرسال الإشعار. تحقق من وجود عميل مرتبط بالوحدة.",note:"لن يُرسل هذا الإشعار عبر واتساب أو البريد الإلكتروني. لا تشارك معلومات مالية حساسة في رسالة عامة.",empty:"اربط وحدة بعميل أولًا."},
 en:{title:"Send private unit notification",unit:"Property / unit",subject:"Notification title",body:"Message",send:"Send within VIP",success:"Notification delivered in the owner's VIP account.",error:"Notification failed. Assign an owner first.",note:"This is an in-app message only; no email, SMS or WhatsApp is sent.",empty:"Assign an owner to a unit first."},
 he:{title:"שליחת התראה פרטית",unit:"יחידה",subject:"כותרת",body:"הודעה",send:"שלח ב-VIP",success:"נשלח",error:"שליחה נכשלה",note:"התראה בתוך האפליקציה בלבד.",empty:"יש לשייך יחידה."},
 tr:{title:"Özel ünite bildirimi",unit:"Mülk / ünite",subject:"Başlık",body:"Mesaj",send:"VIP içinde gönder",success:"Bildirim gönderildi.",error:"Bildirim gönderilemedi.",note:"Yalnızca uygulama içi bildirimdir, WhatsApp veya e-posta gönderilmez.",empty:"Önce müşteriye ünite atayın."},
 az:{title:"Şəxsi mənzil bildirişi",unit:"Mənzil",subject:"Başlıq",body:"Mesaj",send:"VIP daxilində göndər",success:"Bildiriş göndərildi.",error:"Bildiriş göndərilmədi.",note:"Yalnız VIP daxilində bildirişdir. WhatsApp və e-poçt göndərilmir.",empty:"Əvvəlcə mənzili müştəriyə təyin edin."}
};
export default function VipNotificationsAdmin({units,projects}:{units:Unit[];projects:Project[]}){
 const {i18n}=useTranslation();const t=texts[i18n.language.split("-")[0]]||texts.en;
 const qc=useQueryClient();const eligible=units.filter(u=>u.owner_id);
 const [selected,setSelected]=useState("");const [title,setTitle]=useState("");const [body,setBody]=useState("");
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [okay,setOkay]=useState(false);
 const unitId=eligible.some(u=>u.id===selected)?selected:eligible[0]?.id||"";
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!unitId||busy)return;
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/admin/vip/units/"+encodeURIComponent(unitId)+"/notifications",{
    method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({title,body})
   });
   if(!r.ok)throw Error(t.error);
   setMessage(t.success);setOkay(true);setTitle("");setBody("");
   await qc.invalidateQueries({queryKey:["vip","notifications"]});
  }catch{setOkay(false);setMessage(t.error)}finally{setBusy(false)}
 }
 return <section className="mt-9 rounded-2xl border border-[#d7e8ea] bg-white p-5 md:p-6">
  <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold"><BellRing className="h-6 w-6 text-[#008c93]"/>{t.title}</h2>
  <p className="mb-5 flex items-start gap-2 text-xs text-[#68858f]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.note}</p>
  {message&&<p role="status" className={"mb-3 text-sm "+(okay?"text-emerald-700":"text-rose-800")}>{message}</p>}
  <form className="grid gap-3 md:grid-cols-2" onSubmit={submit}>
   <label className="text-sm">{t.unit}
    <select value={unitId} onChange={e=>setSelected(e.target.value)} disabled={!eligible.length}
      className="mt-2 block w-full rounded-xl border border-[#c9dfe1] p-3">
      {eligible.length===0?<option>{t.empty}</option>:eligible.map(u=><option value={u.id} key={u.id}>
       {projects.find(p=>p.id===u.project_id)?.name} · {u.unit_number}
      </option>)}
    </select>
   </label>
   <label className="text-sm">{t.subject}
    <input value={title} onChange={e=>setTitle(e.target.value)} minLength={3} maxLength={90} required
      className="mt-2 block w-full rounded-xl border border-[#c9dfe1] p-3"/>
   </label>
   <label className="text-sm md:col-span-2">{t.body}
    <textarea value={body} onChange={e=>setBody(e.target.value)} required minLength={5} maxLength={700} rows={3}
      className="mt-2 block w-full rounded-xl border border-[#c9dfe1] p-3"/>
   </label>
   <button disabled={busy||!unitId} type="submit" className="rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.send}</button>
  </form>
 </section>;
}
