import React, {useState} from "react";
import {Archive, CheckCircle2, Clock3, FileAudio2, Film, MessageCircle, ShieldCheck} from "lucide-react";

/**
 * Explicitly synthetic, client-only preview. Never reads a database, Meta or a
 * live employee endpoint; never writes, uploads, sends or stores any messages.
 * Kept separate from the genuine consent/audit-protected archive reader.
 */
type Fixture = {
  id:string;kind:"message"|"audio"|"video"|"edit"|"revoke";
  direction:"inbound"|"outbound";
  content:string;time:string;originalId?:string;
};
const examples:ReadonlyArray<{id:string;label:string;events:readonly Fixture[]}>= [
  {id:"synthetic-a",label:"عميل تجريبي أ",events:[
    {id:"s1",kind:"message",direction:"inbound",content:"مرحباً، أريد تفاصيل شقة في باكو.",time:"10:03"},
    {id:"s2",kind:"message",direction:"outbound",content:"أهلاً بك. هذه محادثة وهمية للعرض فقط.",time:"10:04"},
    {id:"s3",kind:"audio",direction:"inbound",content:"مقطع صوتي تجريبي — دون ملف صوتي",time:"10:05"},
    {id:"s4",kind:"message",direction:"inbound",content:"أريد موعد جولة غداً.",time:"10:08"},
    {id:"s5",kind:"revoke",direction:"inbound",content:"حدث حذف وارد من Meta (مثال اصطناعي)",originalId:"s4",time:"10:09"},
  ]},
  {id:"synthetic-b",label:"عميل تجريبي ب",events:[
    {id:"b1",kind:"message",direction:"inbound",content:"ما خطة التقسيط المتاحة؟",time:"11:14"},
    {id:"b2",kind:"video",direction:"outbound",content:"فيديو تجريبي — دون ملف أو رابط حقيقي",time:"11:16"},
    {id:"b3",kind:"edit",direction:"inbound",content:"حدث تعديل تجريبي؛ السجل الأصلي لا يُستبدل.",originalId:"b1",time:"11:17"},
  ]},
];

export default function WhatsappSyntheticConversationReview(){
  const [selected,setSelected]=useState("synthetic-a");
  const conversation=examples.find(c=>c.id===selected)??examples[0];
  const deletedIds=new Set(conversation.events.filter(e=>e.kind==="revoke").map(e=>e.originalId));
  return <section dir="rtl" aria-label="معاينة محادثات اصطناعية" className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold text-[#005476]"><MessageCircle className="h-5 w-5"/> معاينة واجهة المحادثات وأحداث الحذف</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">بيانات اصطناعية محلية للمعاينة فقط. لا توجد أرقام أو محادثات حقيقية، ولا يتصل هذا القسم بـMeta أو قاعدة البيانات.</p>
      </div>
      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">عرض تجريبي — ليس أرشيفاً حقيقياً</span>
    </div>
    <div className="mt-5 grid gap-3 lg:grid-cols-[230px_minmax(0,1fr)]">
      <nav aria-label="محادثات وهمية" className="rounded-xl border border-slate-200 bg-slate-50 p-2">
        {examples.map(c=><button type="button" key={c.id} onClick={()=>setSelected(c.id)} aria-pressed={selected===c.id}
          className={"mb-1 flex w-full items-center justify-between rounded-lg px-3 py-3 text-right text-sm "+(selected===c.id?"bg-[#e3f8f6] font-bold text-[#005476]":"text-slate-700 hover:bg-white")}>
          {c.label}<span className="text-xs text-slate-500">{c.events.length}</span>
        </button>)}
      </nav>
      <div className="min-h-[300px] rounded-xl bg-[#f3eee7] p-4">
        <p className="mb-4 flex items-center gap-2 border-b border-stone-300 pb-2 text-xs text-stone-600"><ShieldCheck className="h-4 w-4"/> {conversation.label} · جميع الأحداث اصطناعية</p>
        <div className="space-y-3">
          {conversation.events.map(event=>{
            const isMetaEvent=event.kind==="revoke"||event.kind==="edit";
            const isDeleted=event.kind==="message"&&deletedIds.has(event.id);
            return <div key={event.id} className={"flex "+(event.direction==="outbound"?"justify-start":"justify-end")}>
              <div className={"max-w-[90%] rounded-xl border px-3 py-2 text-sm shadow-sm sm:max-w-[75%] "+(isMetaEvent?"border-amber-300 bg-amber-50 text-amber-950":event.direction==="outbound"?"border-teal-200 bg-[#dcf7ef]":"border-slate-200 bg-white")}>
                {event.kind==="audio"&&<FileAudio2 className="mb-1 h-4 w-4 text-[#005476]"/>}
                {event.kind==="video"&&<Film className="mb-1 h-4 w-4 text-[#005476]"/>}
                {event.kind==="revoke"&&<span className="mb-1 flex items-center gap-1 text-xs font-bold"><Archive className="h-4 w-4"/> إشعار حذف تجريبي</span>}
                {event.kind==="edit"&&<span className="mb-1 block text-xs font-bold">إشعار تعديل تجريبي</span>}
                <p className="whitespace-pre-wrap">{event.content}</p>
                {isDeleted&&<p className="mt-2 rounded bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950">حُذفت وفق حدث Meta تجريبي — النسخة الأصلية ظاهرة للاختبار</p>}
                <p className="mt-2 flex justify-end gap-1 text-[10px] text-stone-500"><Clock3 className="h-3 w-3"/>{event.time}</p>
              </div>
            </div>;
          })}
        </div>
      </div>
    </div>
    <p className="mt-4 flex items-start gap-2 text-xs leading-6 text-slate-600"><CheckCircle2 className="mt-1 h-4 w-4 shrink-0"/>
      يظهر إشعار الحذف فقط عند وجود حدث حذف موثّق من مزود الخدمة. حذف «لديّ فقط» في هاتف الموظف قد لا يرسل أي إشعار ولا يمكن ضمان اكتشافه. الملفات الصوتية والمرئية أعلاه مجرد عناصر للعرض.
    </p>
  </section>;
}
