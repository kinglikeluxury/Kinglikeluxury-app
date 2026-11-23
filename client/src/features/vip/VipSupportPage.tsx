import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {Link} from "wouter";
import {useAuth} from "@/lib/auth";
import {useTranslation} from "react-i18next";
import {LifeBuoy,ArrowLeft,MessageSquare,CalendarClock,ShieldCheck,Send} from "lucide-react";
type Unit={unit_id:string;unit_number:string;project_name:string};
type Ticket={id:string;unit_id:string;owner_user_id:string;subject:string;category:string;status:string;due_at:string|null;updated_at:string;created_at:string;project_name:string;unit_number:string};
type TicketMessage={id:string;sender_user_id:string;message:string;created_at:string};
type Words=Record<string,string>;
const copies:Record<string,Words>={
 ar:{title:"مركز دعم KINGLIKE VIP",intro:"تابع أسئلتك وطلباتك المتعلقة بوحداتك، أو الملفات التي كُلّفت بمتابعتها.",new:"طلب دعم جديد",unit:"العقار",category:"نوع الطلب",subject:"موضوع الطلب",description:"اشرح المطلوب",open:"إرسال الطلب",my:"طلبات الدعم",empty:"لا توجد طلبات حالياً.",conversation:"المحادثة",reply:"أضف رسالة",send:"إرسال",due:"موعد المتابعة",status:"الحالة",back:"العودة إلى حساب VIP",notLogged:"يجب تسجيل الدخول للاطلاع على الدعم",error:"تعذر تحميل الدعم أو حفظ الطلب.",success:"تم تسجيل الطلب وسيقوم فريقنا بمراجعته.",sent:"تم إرسال الرسالة.",closed:"هذه المحادثة مغلقة.",ownerNote:"ملفات العملاء والرسائل خاصة، ولا يطلع عليها إلا الموظف المخوّل أو الإدارة."},
 en:{title:"KINGLIKE VIP Support Center",intro:"Track questions for your units or files you are assigned to support.",new:"Open support ticket",unit:"Property",category:"Category",subject:"Subject",description:"Describe your request",open:"Submit request",my:"Support tickets",empty:"No requests yet.",conversation:"Messages",reply:"New message",send:"Send",due:"Follow-up due",status:"Status",back:"Back to VIP",notLogged:"Sign in to access support",error:"Could not load or save the request.",success:"Request created. Our team will review it.",sent:"Message sent.",closed:"This conversation is closed.",ownerNote:"Client files and messages are private to authorized staff and management."},
 he:{title:"מרכז תמיכה KINGLIKE VIP",intro:"מעקב אחר בקשות ושאלות.",new:"בקשה חדשה",unit:"נכס",category:"סוג",subject:"נושא",description:"תיאור",open:"שליחה",my:"בקשות",empty:"אין בקשות",conversation:"הודעות",reply:"הודעה",send:"שליחה",due:"מועד טיפול",status:"מצב",back:"חזרה",notLogged:"נדרשת כניסה",error:"שגיאה",success:"נשלח לטיפול",sent:"נשלח",closed:"הבקשה סגורה",ownerNote:"המידע פרטי."},
 tr:{title:"KINGLIKE VIP Destek",intro:"Mülklerinizle ilgili talepleri takip edin.",new:"Destek talebi aç",unit:"Mülk",category:"Kategori",subject:"Konu",description:"Açıklama",open:"Gönder",my:"Destek talepleri",empty:"Talep yok",conversation:"Mesajlar",reply:"Mesaj ekle",send:"Gönder",due:"Takip tarihi",status:"Durum",back:"VIP hesabı",notLogged:"Giriş yapın",error:"İşlem başarısız",success:"Talebiniz kaydedildi.",sent:"Mesaj gönderildi.",closed:"Görüşme kapalı.",ownerNote:"Müşteri dosyaları yalnızca yetkili personel içindir."},
 az:{title:"KINGLIKE VIP Dəstək",intro:"Mənzillərinizlə bağlı sorğuları izləyin.",new:"Yeni dəstək sorğusu",unit:"Mənzil",category:"Növ",subject:"Mövzu",description:"Açıqlama",open:"Göndər",my:"Sorğularım",empty:"Sorğu yoxdur",conversation:"Mesajlar",reply:"Mesaj əlavə et",send:"Göndər",due:"İzləmə tarixi",status:"Vəziyyət",back:"VIP hesabı",notLogged:"Giriş tələb olunur",error:"Xəta baş verdi",success:"Sorğunuz qeydə alındı.",sent:"Mesaj göndərildi.",closed:"Bu sorğu bağlanıb.",ownerNote:"Müştəri məlumatları yalnız səlahiyyətli heyət üçündür."}
};
const categories=["payment","construction","handover","maintenance","membership","other"];
const fields="mt-1 block w-full rounded-xl border border-[#cae1e4] bg-white p-3 text-sm text-[#005476]";
export default function VipSupportPage(){
 const {user,isLoading}=useAuth();
 const {i18n}=useTranslation();
 const t=copies[i18n.language.split("-")[0]]||copies.en;
 const rtl=/^(ar|he)(-|$)/i.test(i18n.language);
 const qc=useQueryClient();
 const [selected,setSelected]=useState(""),[unit,setUnit]=useState(""),[category,setCategory]=useState("payment"),[subject,setSubject]=useState(""),[body,setBody]=useState(""),[reply,setReply]=useState(""),[busy,setBusy]=useState(false),[msg,setMsg]=useState("");
 const units=useQuery<{units:Unit[]}>({
  queryKey:["vip","me"],
  queryFn:async()=>{const r=await fetch("/api/vip/me",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!user&&!isLoading,retry:false
 });
 const tickets=useQuery<{tickets:Ticket[]}>({
  queryKey:["vip","support","list"],
  queryFn:async()=>{const r=await fetch("/api/vip/support",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!user&&!isLoading,retry:false
 });
 const chosen=tickets.data?.tickets.some(x=>x.id===selected)?selected:tickets.data?.tickets[0]?.id||"";
 const detail=useQuery<{ticket:Ticket;messages:TicketMessage[]}>({
  queryKey:["vip","support","detail",chosen],
  queryFn:async()=>{const r=await fetch("/api/vip/support/"+encodeURIComponent(chosen),{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!chosen,retry:false
 });
 async function action(path:string,data:unknown){
  if(busy)return false;setBusy(true);setMsg("");
  try{
   const r=await fetch(path,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
   if(!r.ok)throw Error(t.error);
   await Promise.all([
    qc.invalidateQueries({queryKey:["vip","support","list"]}),
    qc.invalidateQueries({queryKey:["vip","support","detail"]})
   ]);
   return true;
  }catch{setMsg(t.error);return false}
  finally{setBusy(false)}
 }
 async function create(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  const unitId=Number(unit||units.data?.units[0]?.unit_id);
  if(await action("/api/vip/support",{unitId,category,subject,message:body})){
   setSubject("");setBody("");setMsg(t.success);
  }
 }
 async function respond(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!chosen)return;
  if(await action("/api/vip/support/"+encodeURIComponent(chosen)+"/reply",{message:reply})){
   setReply("");setMsg(t.sent);
  }
 }
 const unitValue=unit||units.data?.units[0]?.unit_id||"";
 return <main dir={rtl?"rtl":"ltr"} className="min-h-[80vh] bg-[#f2f8f9] text-[#005476]">
  <header className="bg-[#005476] px-5 py-8 text-white"><div className="mx-auto max-w-5xl">
   <h1 className="flex items-center gap-3 text-2xl font-semibold"><LifeBuoy className="h-8 w-8 text-[#3BCAC4]"/>{t.title}</h1>
   <p className="mt-2 text-sm text-white/80">{t.intro}</p>
  </div></header>
  <div className="mx-auto max-w-5xl space-y-6 px-4 py-7">
   <Link href="/vip" className="inline-flex items-center gap-2 text-sm font-semibold"><ArrowLeft className="h-4 w-4"/>{t.back}</Link>
   {isLoading?<p>…</p>:!user?<p>{t.notLogged}</p>:<>
    {!!units.data?.units.length&&<section className="rounded-2xl border border-[#d8e8eb] bg-white p-5">
     <h2 className="mb-4 text-lg font-semibold">{t.new}</h2>
     <form className="grid gap-4 md:grid-cols-2" onSubmit={create}>
      <label className="text-sm">{t.unit}
       <select className={fields} value={unitValue} onChange={e=>setUnit(e.target.value)}>
        {units.data.units.map(x=><option key={x.unit_id} value={x.unit_id}>{x.project_name} · {x.unit_number}</option>)}
       </select>
      </label>
      <label className="text-sm">{t.category}<select className={fields} value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(x=><option key={x}>{x}</option>)}</select></label>
      <label className="text-sm md:col-span-2">{t.subject}<input required minLength={5} maxLength={140} className={fields} value={subject} onChange={e=>setSubject(e.target.value)}/></label>
      <label className="text-sm md:col-span-2">{t.description}
       <textarea required minLength={10} maxLength={2000} rows={3} className={fields} value={body} onChange={e=>setBody(e.target.value)}/>
      </label>
      <button disabled={busy} className="rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.open}</button>
     </form>
    </section>}
    <section className="grid gap-4 lg:grid-cols-[300px_1fr]">
     <div className="rounded-2xl bg-white p-4">
      <h2 className="mb-4 font-semibold">{t.my}</h2>
      {tickets.isError?<p role="alert" className="text-xs text-rose-800">{t.error}</p>:!tickets.data?.tickets.length?<p className="text-sm text-[#748e98]">{t.empty}</p>:
       <div className="space-y-2">{tickets.data.tickets.map(x=><button key={x.id} type="button" onClick={()=>setSelected(x.id)}
        className={"block w-full rounded-xl border p-3 text-start text-sm "+(chosen===x.id?"border-[#25bdb5] bg-[#f1fbfa]":"border-[#dcecee]")}>
        <strong className="block">{x.subject}</strong>
        <span className="text-xs text-[#66838c]">{x.project_name} · {x.unit_number} · {x.status}</span>
       </button>)}</div>}
     </div>
     <div className="min-h-56 rounded-2xl bg-white p-5">
      <h2 className="mb-4 flex items-center gap-2 font-semibold"><MessageSquare className="h-5 w-5"/>{t.conversation}</h2>
      {detail.isError?<p role="alert">{t.error}</p>:detail.data?<div>
       <h3 className="text-lg font-semibold">{detail.data.ticket.subject}</h3>
       <p className="mt-1 text-xs text-[#64818c]">{t.status}: {detail.data.ticket.status}
        {detail.data.ticket.due_at&&<> · <CalendarClock className="inline h-3 w-3"/>{t.due}: {new Date(detail.data.ticket.due_at).toLocaleString(i18n.language)}</>}</p>
       <div className="mt-5 space-y-3">{detail.data.messages.map(m=><div key={m.id}
        className={"rounded-xl p-3 text-sm "+(String(user.id)===m.sender_user_id?"bg-[#e9f9f7]":"bg-[#f0f5f6]")}>
        <p className="whitespace-pre-wrap break-words">{m.message}</p>
        <p className="mt-2 text-xs text-[#78929b]">{new Date(m.created_at).toLocaleString(i18n.language)}</p>
       </div>)}</div>
       {["closed","resolved"].includes(detail.data.ticket.status)?<p className="mt-4 text-sm text-[#788e98]">{t.closed}</p>:
        <form className="mt-5 flex flex-col gap-2" onSubmit={respond}>
         <label className="text-sm">{t.reply}<textarea required minLength={2} maxLength={2000} rows={3} className={fields} value={reply} onChange={e=>setReply(e.target.value)}/></label>
         <button disabled={busy||reply.trim().length<2} className="inline-flex w-fit items-center gap-2 rounded-xl bg-[#005476] px-5 py-3 text-sm text-white disabled:opacity-50"><Send className="h-4 w-4"/>{t.send}</button>
        </form>}
      </div>:<p className="text-sm text-[#7b929a]">{t.empty}</p>}
     </div>
    </section>
   </>}
   {msg&&<p role="status" className="text-sm text-[#005476]">{msg}</p>}
   <p className="flex gap-2 text-xs text-[#6f8993]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.ownerNote}</p>
  </div>
 </main>;
}
