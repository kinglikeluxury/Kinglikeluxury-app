import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {KeyRound,ShieldCheck} from "lucide-react";

type KeyReceipt={developer_handover_reference:string;approved_at:string;approval_note:string;
  received_keys_count:number|null;received_date:string|null;buyer_acknowledged_at:string|null;
  buyer_note:string|null;delivered_at:string|null;key_delivery_reference:string|null;delivery_note:string|null};
const copy:Record<string,Record<string,string>>={
 ar:{title:"استلام المفاتيح",intro:"يُتاح إقرار استلام المفاتيح بعد اعتماد المعاينة من الإدارة فقط. لا تؤكد الاستلام إلا بعد حصولك فعليًا على المفاتيح.",approved:"جاهز لإقرار الاستلام",count:"عدد المفاتيح التي استلمتها فعليًا",date:"تاريخ استلام المفاتيح",note:"ملاحظات (اختياري)",agree:"أؤكد أنني استلمت المفاتيح المذكورة فعليًا في التاريخ المسجّل. هذا إقرار تشغيلي داخل VIP وليس توقيعًا على محضر التسليم القانوني.",send:"تسجيل إقرار استلام المفاتيح",acknowledged:"تم تسجيل إقرار استلامك وينتظر تأكيد الإدارة",delivered:"أكدت الإدارة تسليم المفاتيح",notReady:"سيظهر إقرار المفاتيح هنا بعد اكتمال المعاينة واعتماد الإدارة.",error:"تعذر تسجيل الإقرار. تحقق من الحالة والتاريخ.",notice:"وثائق الاستلام القانونية والتوقيعات الرسمية تبقى خاضعة للمستندات المعتمدة من المطور."},
 en:{title:"Key handover",intro:"Confirm only after physically receiving the keys. The acknowledgment opens after management approves the inspection.",approved:"Ready for key acknowledgment",count:"Keys physically received",date:"Date you received the keys",note:"Note (optional)",agree:"I confirm that I physically received the stated keys on this date. This is an in-app operational acknowledgment, not a legal handover signature.",send:"Record my key receipt",acknowledged:"Acknowledgment recorded, awaiting management verification",delivered:"Management confirmed key delivery",notReady:"Key receipt opens after handover inspection and management approval.",error:"Could not record key receipt. Check the date and status.",notice:"Legal handover documents and signatures remain governed by the developer's official records."},
 he:{title:"קבלת מפתחות",intro:"אשר רק לאחר קבלה פיזית של המפתחות.",approved:"אפשר לאשר",count:"מספר מפתחות",date:"תאריך קבלה",note:"הערה",agree:"אני מאשר/ת שקיבלתי פיזית את המפתחות. אין זו חתימה משפטית.",send:"אישור קבלה",acknowledged:"נרשם, ממתין לאישור",delivered:"אושר על ידי ההנהלה",notReady:"לאחר אישור הבדיקה.",error:"לא ניתן לרשום",notice:"מסמכים רשמיים כפופים לאישור היזם."},
 tr:{title:"Anahtar teslimi",intro:"Yalnızca anahtarları fiziksel olarak teslim aldıktan sonra onaylayın.",approved:"Teslim alımına hazır",count:"Alınan anahtar sayısı",date:"Teslim alım tarihi",note:"Not",agree:"Belirtilen anahtarları fiilen aldığımı teyit ediyorum. Bu hukuki teslim imzası değildir.",send:"Teslim alımını kaydet",acknowledged:"Kaydedildi, yönetim onayı bekleniyor",delivered:"Yönetim teslimi onayladı",notReady:"Kontrol ve onaydan sonra açılacak.",error:"Kaydedilemedi",notice:"Resmi teslim evrakları geliştirici kayıtlarına tabidir."},
 az:{title:"Açarların təhvili",intro:"Yalnız açarları faktiki aldıqdan sonra təsdiqləyin.",approved:"Qəbula hazırdır",count:"Alınan açarların sayı",date:"Alınma tarixi",note:"Qeyd",agree:"Qeyd edilən açarları faktiki aldığımı təsdiqləyirəm. Bu hüquqi təhvil imzası deyil.",send:"Təhvil qəbzini qeydə al",acknowledged:"Qeydə alındı, təsdiq gözlənilir",delivered:"Rəhbərlik təsdiq etdi",notReady:"Yoxlamadan sonra açılacaq.",error:"Qeydə alınmadı",notice:"Rəsmi təhvil sənədləri şirkət qaydalarına tabedir."}
};
export default function VipKeysClient({unitId,status}:{unitId:string;status:string}){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const qc=useQueryClient();
 const [keyCount,setKeyCount]=useState(""),[date,setDate]=useState(""),[note,setNote]=useState(""),[checked,setChecked]=useState(false);
 const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState("");
 const query=useQuery<{handover:KeyReceipt|null}>({
  queryKey:["vip","keys",unitId],
  queryFn:async()=>{const r=await fetch("/api/vip/units/"+encodeURIComponent(unitId)+"/keys",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!unitId,retry:false
 });
 async function send(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!checked||busy)return;
  setBusy(true);setFeedback("");
  try{
   const r=await fetch("/api/vip/units/"+encodeURIComponent(unitId)+"/keys/acknowledge",{
    method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({receivedKeys:true,keyCount:Number(keyCount),receivedDate:date,note})
   });
   if(!r.ok)throw Error(t.error);
   await qc.invalidateQueries({queryKey:["vip","keys",unitId]});
   setFeedback(t.acknowledged);setChecked(false);
  }catch{setFeedback(t.error)}finally{setBusy(false)}
 }
 const h=query.data?.handover;
 return <section className="mt-5 border-t border-[#dce9eb] pt-5">
  <h4 className="mb-3 flex items-center gap-2 font-semibold"><KeyRound className="h-5 w-5 text-[#008c91]"/>{t.title}</h4>
  <p className="mb-3 text-xs leading-relaxed text-[#678591]">{t.intro}</p>
  {query.isError?<p role="alert" className="text-xs text-rose-700">{t.error}</p>:
   h?.delivered_at?<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
    <strong className="text-emerald-900">{t.delivered}</strong>
    <p className="mt-2">{h.received_keys_count} · {h.received_date}</p>
   </div>:h?.buyer_acknowledged_at?<div className="rounded-xl border border-[#b0dfde] bg-[#f0faf9] p-4 text-sm">
    <strong>{t.acknowledged}</strong><p className="mt-2">{h.received_keys_count} · {h.received_date}</p>
   </div>:status!=="handover_approved"||!h?<p className="text-sm text-[#718a93]">{t.notReady}</p>:
    <form onSubmit={send} className="rounded-xl border border-[#d5e8ea] p-4">
     <p className="mb-3 text-sm font-semibold">{t.approved}</p>
     <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs">{t.count}
       <input type="number" min={1} max={100} step={1} required value={keyCount} onChange={e=>setKeyCount(e.target.value)}
        className="mt-2 block w-full rounded-lg border border-[#cfdee1] p-3"/>
      </label>
      <label className="text-xs">{t.date}
       <input type="date" max={new Date().toISOString().slice(0,10)} required value={date} onChange={e=>setDate(e.target.value)}
        className="mt-2 block w-full rounded-lg border border-[#cfdee1] p-3"/>
      </label>
     </div>
     <label className="mt-3 block text-xs">{t.note}
      <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} maxLength={500}
       className="mt-2 block w-full rounded-lg border border-[#cfdee1] p-3"/>
     </label>
     <label className="mt-4 flex items-start gap-2 text-xs leading-relaxed">
      <input type="checkbox" required checked={checked} onChange={e=>setChecked(e.target.checked)} className="mt-1"/>
      <span>{t.agree}</span>
     </label>
     <button type="submit" disabled={busy||!checked||!date||Number(keyCount)<1}
      className="mt-3 rounded-lg bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.send}</button>
    </form>}
  {feedback&&<p role="status" className="mt-3 text-xs text-[#005476]">{feedback}</p>}
  <p className="mt-3 flex items-start gap-2 text-xs text-[#79909b]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.notice}</p>
 </section>;
}
