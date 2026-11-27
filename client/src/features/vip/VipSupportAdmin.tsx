import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {LifeBuoy,Clock3,UserRoundCheck,ShieldCheck} from "lucide-react";
type Ticket={id:string;unit_id:string;subject:string;category:string;status:string;owner_email:string;assignee_email:string|null;due_at:string|null;updated_at:string;project_name:string;unit_number:string};
type Message={id:string;sender_user_id:string;message:string;created_at:string};
const statuses=["open","in_progress","waiting_customer","resolved","closed"];
const tAll:Record<string,Record<string,string>>={
 ar:{title:"مركز دعم عملاء VIP",intro:"تابع الطلبات المفتوحة والمتأخرة، وحدد الموظف المسؤول مع موعد متابعة واضح.",none:"لا توجد طلبات دعم.",ticket:"الطلب",owner:"العميل",assigned:"الموظف المسؤول (بريده الإلكتروني، أو اتركه فارغًا)",status:"حالة الطلب",due:"موعد المتابعة",reason:"سبب التعديل (يُحفظ في سجل النشاط)",save:"حفظ المسؤول والحالة",message:"الرسائل",reply:"رد الإدارة",send:"إرسال الرد",success:"تم تحديث الطلب",sent:"تم إرسال الرد",error:"تعذر الحفظ. تحقق من صلاحية الموظف وحالة الطلب.",warning:"لا تضع أسرارًا أو بيانات دفع بنكية في الرسائل. الموظف المكلّف فقط يستطيع الاطلاع على هذا الملف."},
 en:{title:"VIP customer support desk",intro:"Review open and overdue requests; assign a responsible staff member and follow-up date.",none:"No support requests.",ticket:"Ticket",owner:"Customer",assigned:"Assigned employee email (leave blank to unassign)",status:"Status",due:"Follow-up deadline",reason:"Reason for update (audited)",save:"Save status and assignment",message:"Messages",reply:"Management reply",send:"Send reply",success:"Ticket updated",sent:"Reply sent",error:"Update failed. Check employee permissions and status.",warning:"Do not share banking secrets in support messages. Only assigned staff can see these files."},
 he:{title:"תמיכה בלקוחות VIP",intro:"מעקב אחר בקשות והקצאת עובדים.",none:"אין פניות",ticket:"פנייה",owner:"לקוח",assigned:"אימייל נציג",status:"מצב",due:"מועד טיפול",reason:"סיבת שינוי",save:"שמירה",message:"הודעות",reply:"תשובה",send:"שליחה",success:"עודכן",sent:"נשלח",error:"שגיאה",warning:"המידע פרטי."},
 tr:{title:"VIP müşteri destek masası",intro:"Talep ve sorumlu personeli yönetin.",none:"Talep yok.",ticket:"Talep",owner:"Müşteri",assigned:"Personel e-postası",status:"Durum",due:"Takip tarihi",reason:"Değişiklik gerekçesi",save:"Kaydet",message:"Mesajlar",reply:"Yönetim yanıtı",send:"Gönder",success:"Güncellendi",sent:"Gönderildi",error:"İşlem başarısız",warning:"Banka sırlarını bu alanda paylaşmayın."},
 az:{title:"VIP dəstək idarəsi",intro:"Sorğulara cavab verin və işçini təyin edin.",none:"Sorğu yoxdur.",ticket:"Sorğu",owner:"Müştəri",assigned:"İşçi e-poçtu",status:"Vəziyyət",due:"Son tarix",reason:"Dəyişiklik səbəbi",save:"Saxla",message:"Mesajlar",reply:"Rəhbərliyin cavabı",send:"Göndər",success:"Yeniləndi",sent:"Göndərildi",error:"Xəta",warning:"Bank sirlərini mesajlarda paylaşmayın."}
};
export default function VipSupportAdmin(){
 const {i18n}=useTranslation(),t=tAll[i18n.language.split("-")[0]]||tAll.en;
 const qc=useQueryClient();
 const [selected,setSelected]=useState(""),[assignee,setAssignee]=useState(""),[status,setStatus]=useState(""),[date,setDate]=useState(""),[reason,setReason]=useState(""),[reply,setReply]=useState(""),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState("");
 const tickets=useQuery<{tickets:Ticket[]}>({
  queryKey:["vip","admin","support"],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/support",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const current=tickets.data?.tickets.find(x=>x.id===selected)||tickets.data?.tickets[0];
 const id=current?.id||"";
 const detail=useQuery<{ticket:Ticket;messages:Message[]}>({
  queryKey:["vip","support","detail",id],
  queryFn:async()=>{const r=await fetch("/api/vip/support/"+encodeURIComponent(id),{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!id,retry:false
 });
 const [formId,setFormId]=useState("");
 const formStatus=formId===id?status:current?.status||"open";
 const formAssigned=formId===id?assignee:current?.assignee_email||"";
 const formDue=formId===id?date:"";
 function choose(next:string){const x=tickets.data?.tickets.find(v=>v.id===next);setSelected(next);setFormId(next);setStatus(x?.status||"open");setAssignee(x?.assignee_email||"");setDate("");setReason("");setReply("");setFeedback("")}
 async function send(method:"PATCH"|"POST"){
  if(!id||busy)return;
  setBusy(true);setFeedback("");
  try{
   const url=method==="PATCH"?"/api/admin/vip/support/"+encodeURIComponent(id):"/api/vip/support/"+encodeURIComponent(id)+"/reply";
   const payload=method==="PATCH"?{
     status:formStatus,assigneeEmail:formAssigned.trim()||null,
     dueAt:formDue?new Date(formDue).toISOString():current?.due_at||null,
     internalNote:reason
   }:{message:reply};
   const r=await fetch(url,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
   if(!r.ok)throw Error(t.error);
   await Promise.all([
    qc.invalidateQueries({queryKey:["vip","admin","support"]}),
    qc.invalidateQueries({queryKey:["vip","support","detail",id]}),
    qc.invalidateQueries({queryKey:["vip","admin","insights"]})
   ]);
   if(method==="POST")setReply("");
   else setReason("");
   setFeedback(method==="POST"?t.sent:t.success);
  }catch{setFeedback(t.error)}finally{setBusy(false)}
 }
 return <section className="mt-9 rounded-2xl border border-[#cee4e6] bg-white p-5 md:p-6">
  <h2 className="mb-2 flex items-center gap-2 text-xl font-semibold"><LifeBuoy className="h-6 w-6 text-[#008d91]"/>{t.title}</h2>
  <p className="mb-4 text-sm text-[#6a8490]">{t.intro}</p>
  {tickets.isError?<p role="alert">{t.error}</p>:!current?<p className="text-sm">{t.none}</p>:
  <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
   <div className="space-y-2">{tickets.data?.tickets.map(x=><button key={x.id} type="button" onClick={()=>choose(x.id)}
     className={"block w-full rounded-xl border px-3 py-3 text-start text-sm "+(id===x.id?"border-[#3BCAC4] bg-[#f0fcfb]":"border-[#dae9eb]")}>
     <strong className="block">{x.subject}</strong>
     <span className="text-xs text-[#73919b]">{x.owner_email} · {x.status}</span>
     {x.due_at&&new Date(x.due_at)<new Date()&&!["resolved","closed"].includes(x.status)&&
      <span className="mt-2 flex items-center gap-1 text-xs text-rose-700"><Clock3 className="h-3 w-3"/>{t.due}</span>}
    </button>)}</div>
   <div className="space-y-4">
    <h3 className="font-semibold">{t.ticket}: {current.subject}</h3>
    <p className="text-xs text-[#6a8995]">{t.owner}: {current.owner_email} · {current.project_name} · {current.unit_number}</p>
    <div className="grid gap-3 sm:grid-cols-2">
     <label className="text-xs">{t.status}
      <select className="mt-2 block w-full rounded-lg border border-[#cce0e2] p-3"
       value={formStatus} onChange={e=>{setFormId(id);setStatus(e.target.value)}}>
       {statuses.map(x=><option value={x} key={x}>{x}</option>)}</select>
     </label>
     <label className="text-xs">{t.assigned}
      <input type="email" className="mt-2 block w-full rounded-lg border border-[#cce0e2] p-3"
       value={formAssigned} onChange={e=>{setFormId(id);setAssignee(e.target.value)}}/>
     </label>
     <label className="text-xs">{t.due}
      <input type="datetime-local" className="mt-2 block w-full rounded-lg border border-[#cce0e2] p-3"
       value={formDue} onChange={e=>{setFormId(id);setDate(e.target.value)}}/>
     </label>
     <label className="text-xs">{t.reason}
      <textarea rows={2} minLength={10} maxLength={400} className="mt-2 block w-full rounded-lg border border-[#cce0e2] p-3"
       value={reason} onChange={e=>setReason(e.target.value)}/>
     </label>
    </div>
    <button type="button" onClick={()=>void send("PATCH")} disabled={busy||reason.trim().length<10}
     className="inline-flex items-center gap-2 rounded-lg bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
      <UserRoundCheck className="h-4 w-4"/>{t.save}</button>
    <h4 className="border-t border-[#deebec] pt-4 font-semibold">{t.message}</h4>
    <div className="max-h-80 space-y-2 overflow-y-auto">
     {detail.data?.messages.map(m=><div key={m.id} className="rounded-lg bg-[#f2f8f8] p-3 text-sm">
       <p className="whitespace-pre-wrap break-words">{m.message}</p>
       <p className="mt-2 text-xs text-[#748e99]">{new Date(m.created_at).toLocaleString(i18n.language)}</p>
      </div>)}
    </div>
    {!["resolved","closed"].includes(current.status)&&<div>
     <label className="block text-xs">{t.reply}
      <textarea className="mt-2 block w-full rounded-lg border border-[#cce0e2] p-3" rows={3} minLength={2} maxLength={2000}
       value={reply} onChange={e=>setReply(e.target.value)}/>
     </label>
     <button type="button" disabled={busy||reply.trim().length<2} onClick={()=>void send("POST")}
      className="mt-3 rounded-lg bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.send}</button>
    </div>}
    {feedback&&<p role="status" className="text-xs text-[#005476]">{feedback}</p>}
   </div>
  </div>}
  <p className="mt-5 flex gap-2 text-xs leading-relaxed text-[#72909b]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.warning}</p>
 </section>;
}
