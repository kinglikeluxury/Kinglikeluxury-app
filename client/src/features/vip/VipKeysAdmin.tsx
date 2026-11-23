import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {KeyRound,ShieldCheck} from "lucide-react";
type Keys={developer_handover_reference:string;approved_at:string;approval_note:string;received_keys_count:number|null;
  received_date:string|null;buyer_acknowledged_at:string|null;delivered_at:string|null;key_delivery_reference:string|null};
const strings:Record<string,Record<string,string>>={
 ar:{title:"اعتماد الاستلام وتسليم المفاتيح",approval:"اعتماد جاهزية التسليم بعد المعاينة",reference:"مرجع اعتماد المطور (رقم المستند أو المحضر)",note:"بيان الإدارة وملخص الفحص",confirmChecks:"أؤكد اكتمال المعاينة وخلو ملف الوحدة من الملاحظات غير المعالجة",approve:"اعتماد جاهزية التسليم",pendingBuyer:"في انتظار إقرار العميل باستلام المفاتيح فعليًا",buyerConfirmed:"أكد العميل استلام المفاتيح",count:"عدد المفاتيح",date:"تاريخ الاستلام",delivery:"تأكيد تسليم المفاتيح من الإدارة",deliveryReference:"مرجع محضر التسليم الفعلي",deliveryCheck:"أؤكد أن التسليم تم فعليًا وتمت مراجعة إقرار العميل والمستندات",finish:"تسجيل التسليم النهائي في VIP",delivered:"تم تسجيل تسليم المفاتيح",notReady:"هذه الوحدة ليست جاهزة للاعتماد حتى استكمال فحصها.",error:"تعذر تسجيل العملية",saved:"تم تحديث سجل التسليم",warning:"توثيق VIP تشغيلي ولا يحل محل محضر التسليم الموقع أو إجراءات نقل الملكية القانونية."},
 en:{title:"Handover approval & key delivery",approval:"Approve after completed inspection",reference:"Developer approval document reference",note:"Management record and inspection notes",confirmChecks:"I confirm inspection is complete and no unresolved issues remain",approve:"Approve handover readiness",pendingBuyer:"Waiting for buyer to acknowledge actual key receipt",buyerConfirmed:"Buyer acknowledged physical key receipt",count:"Keys received",date:"Receipt date",delivery:"Management key delivery confirmation",deliveryReference:"Actual delivery record reference",deliveryCheck:"I confirm physical delivery was checked against the buyer's acknowledgment and developer documents",finish:"Confirm key delivery in VIP",delivered:"Key delivery recorded",notReady:"Complete the inspection before approval.",error:"Could not save handover record",saved:"Handover record updated",warning:"VIP is an operational record and does not replace legal handover documents or ownership transfer."},
 he:{title:"אישור מסירה ומפתחות",approval:"אישור לאחר בדיקה",reference:"מזהה מסמך",note:"הערות",confirmChecks:"אני מאשר שאין ליקויים פתוחים",approve:"אישור",pendingBuyer:"ממתין לאישור הלקוח",buyerConfirmed:"אושר בידי הלקוח",count:"מספר מפתחות",date:"תאריך",delivery:"אישור המסירה",deliveryReference:"מסמך המסירה",deliveryCheck:"המסירה אומתה",finish:"אשר מסירה",delivered:"המסירה נרשמה",notReady:"הבדיקה לא הסתיימה",error:"שגיאה",saved:"נשמר",warning:"אינו מהווה מסמך משפטי."},
 tr:{title:"Teslim ve anahtar onayı",approval:"Kontrol sonrası onay",reference:"Geliştirici belge referansı",note:"İnceleme notu",confirmChecks:"Açık sorun kalmadığını onaylıyorum",approve:"Teslimi onayla",pendingBuyer:"Müşteri anahtar teslimini onaylamalı",buyerConfirmed:"Müşteri anahtarları teslim aldığını bildirdi",count:"Anahtar sayısı",date:"Tarih",delivery:"Yönetim onayı",deliveryReference:"Teslim tutanağı",deliveryCheck:"Fiziksel teslimi ve belgeleri doğruladım",finish:"Anahtar teslimini onayla",delivered:"Teslim kaydedildi",notReady:"Kontrolü tamamlayın.",error:"İşlem başarısız",saved:"Kaydedildi",warning:"Hukuki devir belgesi yerine geçmez."},
 az:{title:"Təhvil və açar təsdiqi",approval:"Yoxlamadan sonra təsdiq",reference:"Tikinti şirkətinin sənəd istinadı",note:"Yoxlama qeydləri",confirmChecks:"Açıq qüsur qalmadığını təsdiqləyirəm",approve:"Təhvili təsdiqlə",pendingBuyer:"Müştərinin açarları aldığını təsdiqi gözlənilir",buyerConfirmed:"Müştəri açarları aldığını təsdiq edib",count:"Açar sayı",date:"Tarix",delivery:"Rəhbərlik təsdiqi",deliveryReference:"Təhvil sənədi",deliveryCheck:"Faktiki təhvil və sənədləri yoxladım",finish:"Açarların təhvilini təsdiqlə",delivered:"Təhvil qeydə alındı",notReady:"Yoxlama tamamlanmayıb.",error:"Xəta",saved:"Saxlandı",warning:"Hüquqi təhvil sənədini əvəz etmir."}
};
export default function VipKeysAdmin({unitId,status}:{unitId:string;status:string}){
 const {i18n}=useTranslation();const t=strings[i18n.language.split("-")[0]]||strings.en;
 const qc=useQueryClient();
 const [approvalRef,setApprovalRef]=useState(""),[deliveryRef,setDeliveryRef]=useState("");
 const [note,setNote]=useState(""),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[feedback,setFeedback]=useState("");
 const keys=useQuery<{handover:Keys|null}>({
  queryKey:["vip","admin","keys",unitId],
  queryFn:async()=>{const r=await fetch("/api/admin/vip/units/"+encodeURIComponent(unitId)+"/keys",
    {credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:!!unitId,retry:false
 });
 async function submit(e:FormEvent<HTMLFormElement>,step:"approve"|"confirm"){
   e.preventDefault();if(busy||!unitId||!checked)return;
   setBusy(true);setFeedback("");
   const path="/api/admin/vip/units/"+encodeURIComponent(unitId)+(step==="approve"?"/handover/approve":"/keys/confirm");
   try{
    const r=await fetch(path,{
     method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
     body:JSON.stringify(step==="approve"
      ?{developerReference:approvalRef,note,acknowledgedNoOpenSnags:true}
      :{developerReference:deliveryRef,note,confirmedPhysicalDelivery:true})
    });
    if(!r.ok)throw Error(t.error);
    await Promise.all([
     qc.invalidateQueries({queryKey:["vip","admin","keys",unitId]}),
     qc.invalidateQueries({queryKey:["vip","admin","handover",unitId]}),
     qc.invalidateQueries({queryKey:["vip","handover",unitId]}),
     qc.invalidateQueries({queryKey:["vip","keys",unitId]})
    ]);
    setChecked(false);setNote("");setFeedback(t.saved);
   }catch{setFeedback(t.error)}finally{setBusy(false)}
 }
 const k=keys.data?.handover;
 return <section className="mt-6 rounded-xl border border-[#cde5e6] bg-[#f8fcfc] p-4">
  <h4 className="mb-3 flex items-center gap-2 font-semibold"><KeyRound className="h-5 w-5 text-[#008c91]"/>{t.title}</h4>
  {keys.isError?<p role="alert" className="text-sm text-rose-700">{t.error}</p>:
   status==="inspection_completed"&&!k?
   <form onSubmit={e=>void submit(e,"approve")} className="space-y-3">
    <p className="text-sm font-semibold">{t.approval}</p>
    <label className="block text-xs">{t.reference}
     <input value={approvalRef} onChange={e=>setApprovalRef(e.target.value)} required minLength={8} maxLength={160}
      className="mt-2 block w-full rounded-lg border border-[#cde0e2] p-3"/>
    </label>
    <label className="block text-xs">{t.note}
     <textarea value={note} onChange={e=>setNote(e.target.value)} minLength={10} maxLength={500} required rows={2}
      className="mt-2 block w-full rounded-lg border border-[#cde0e2] p-3"/>
    </label>
    <label className="flex items-start gap-2 text-xs"><input type="checkbox" required checked={checked} onChange={e=>setChecked(e.target.checked)}/>{t.confirmChecks}</label>
    <button disabled={busy||!checked} type="submit" className="rounded-lg bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.approve}</button>
   </form>:
   status==="handover_approved"&&k?<>
    {!k.buyer_acknowledged_at?<p className="text-sm">{t.pendingBuyer}</p>:
    <form onSubmit={e=>void submit(e,"confirm")} className="space-y-3">
     <p className="text-sm font-semibold">{t.buyerConfirmed}</p>
     <p className="text-xs">{t.count}: {k.received_keys_count} · {t.date}: {k.received_date}</p>
     <label className="block text-xs">{t.deliveryReference}
      <input value={deliveryRef} onChange={e=>setDeliveryRef(e.target.value)} minLength={8} maxLength={160} required
       className="mt-2 block w-full rounded-lg border border-[#cde0e2] p-3"/>
     </label>
     <label className="block text-xs">{t.note}
      <textarea value={note} onChange={e=>setNote(e.target.value)} minLength={10} maxLength={500} required rows={2}
       className="mt-2 block w-full rounded-lg border border-[#cde0e2] p-3"/>
     </label>
     <label className="flex items-start gap-2 text-xs"><input type="checkbox" required checked={checked} onChange={e=>setChecked(e.target.checked)}/>{t.deliveryCheck}</label>
     <button type="submit" disabled={busy||!checked} className="rounded-lg bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.finish}</button>
    </form>}
   </>:status==="keys_delivered"&&k?<p className="text-sm text-emerald-800">{t.delivered} · {k.received_keys_count} · {k.received_date}</p>:
    <p className="text-xs text-[#76919a]">{t.notReady}</p>}
  {feedback&&<p role="status" className="mt-3 text-xs text-[#005476]">{feedback}</p>}
  <p className="mt-4 flex items-start gap-2 text-xs text-[#72909a]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.warning}</p>
 </section>;
}
