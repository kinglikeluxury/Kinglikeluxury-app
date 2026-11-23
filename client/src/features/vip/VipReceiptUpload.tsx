import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileUp } from "lucide-react";

const copy: Record<string,Record<string,string>> = {
  ar:{title:"رفع إيصال التحويل",source:"مصدر الإيصال",admin:"من الإدارة",whatsapp:"واتساب",email:"البريد الإلكتروني",file:"اختر إيصال PDF أو صورة",send:"إرسال الإيصال",sending:"جاري الرفع...",done:"تم رفع الإيصال، وبانتظار التحقق المالي",error:"فشل رفع الإيصال. لم يتم تسجيل أي دفعة.",size:"الحد الأقصى 10 ميغابايت. لا يُعتمد الدفع تلقائيًا."},
  en:{title:"Upload transfer receipt",source:"Receipt source",admin:"Administration",whatsapp:"WhatsApp",email:"Email",file:"Choose a PDF or image",send:"Submit receipt",sending:"Uploading...",done:"Receipt submitted, awaiting finance verification",error:"Upload failed. No payment was recorded.",size:"Maximum 10 MB. Upload does not confirm payment."},
  he:{title:"העלאת קבלת העברה",source:"מקור הקבלה",admin:"הנהלה",whatsapp:"וואטסאפ",email:"דוא״ל",file:"בחר PDF או תמונה",send:"שליחת קבלה",sending:"מעלה...",done:"הקבלה התקבלה וממתינה לאישור",error:"ההעלאה נכשלה. לא אושר תשלום.",size:"עד 10MB. העלאה אינה אישור תשלום."},
  tr:{title:"Havale dekontu yükle",source:"Dekont kaynağı",admin:"Yönetim",whatsapp:"WhatsApp",email:"E-posta",file:"PDF veya resim seçin",send:"Dekontu gönder",sending:"Yükleniyor...",done:"Dekont yüklendi, finans onayı bekleniyor",error:"Yükleme başarısız. Ödeme kaydedilmedi.",size:"En fazla 10 MB. Yükleme ödemeyi onaylamaz."},
  az:{title:"Köçürmə qəbzini yüklə",source:"Qəbzin mənbəyi",admin:"İdarəetmə",whatsapp:"WhatsApp",email:"E-poçt",file:"PDF və ya şəkil seçin",send:"Qəbzi göndər",sending:"Yüklənir...",done:"Qəbz yüklənib, maliyyə yoxlaması gözlənilir",error:"Yükləmə alınmadı. Ödəniş qeydə alınmadı.",size:"Maksimum 10 MB. Yükləmə ödəniş təsdiqi deyil."}
};
export default function VipReceiptUpload({installmentId,asAdmin=false}:{installmentId:string;asAdmin?:boolean}) {
  const {i18n}=useTranslation();
  const t=copy[i18n.language.split("-")[0]]||copy.en;
  const qc=useQueryClient();
  const [file,setFile]=useState<File|null>(null);
  const [source,setSource]=useState("admin");
  const [busy,setBusy]=useState(false);
  const [feedback,setFeedback]=useState<{ok:boolean;text:string}|null>(null);
  const max=10*1024*1024;
  async function upload(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(!file||busy||file.size>max||file.size===0)return;
    setBusy(true);setFeedback(null);
    try{
      const body=new FormData();
      body.append("receipt",file,file.name);
      body.append("source",asAdmin?source:"client");
      const res=await fetch("/api/vip/installments/"+encodeURIComponent(installmentId)+"/receipts",{
        method:"POST",credentials:"include",body
      });
      if(!res.ok)throw Error(t.error);
      setFile(null);
      const element=document.getElementById("vip-file-"+(asAdmin?"a":"c")+"-"+installmentId) as HTMLInputElement|null;
      if(element)element.value="";
      setFeedback({ok:true,text:t.done});
      await Promise.all([
        qc.invalidateQueries({queryKey:["vip","receipts"]}),
        qc.invalidateQueries({queryKey:["vip","admin","receipts"]}),
        qc.invalidateQueries({queryKey:["vip","admin","overview"]}),
      ]);
    }catch {
      setFeedback({ok:false,text:t.error});
    }finally {setBusy(false);}
  }
  return <form onSubmit={upload} className="mt-4 rounded-xl border border-[#d3e8ea] bg-[#f8fcfc] p-3">
    <label htmlFor={"vip-file-"+(asAdmin?"a":"c")+"-"+installmentId} className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#005476]">
      <FileUp className="h-4 w-4"/>{t.title}
    </label>
    <input id={"vip-file-"+(asAdmin?"a":"c")+"-"+installmentId} type="file"
      accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
      onChange={e=>{setFile(e.target.files?.[0]||null);setFeedback(null);}}
      className="w-full min-w-0 text-xs file:me-2 file:rounded-lg file:border-0 file:bg-[#e0f4f3] file:px-3 file:py-2 file:text-[#005476]"/>
    {asAdmin&&<div className="mt-2">
      <label className="mb-1 block text-xs text-[#688491]">{t.source}</label>
      <select value={source} onChange={e=>setSource(e.target.value)} className="w-full rounded-lg border border-[#d1e3e6] bg-white p-2 text-xs">
        <option value="admin">{t.admin}</option><option value="whatsapp">{t.whatsapp}</option><option value="email">{t.email}</option>
      </select>
    </div>}
    <p className="mt-2 text-[11px] text-[#78929b]">{t.size}</p>
    <button type="submit" disabled={!file||busy||file.size>max||file.size===0}
      className="mt-3 rounded-lg bg-[#005476] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
      {busy?t.sending:t.send}
    </button>
    {feedback&&<p role="status" className={"mt-2 text-xs "+(feedback.ok?"text-emerald-800":"text-red-700")}>{feedback.text}</p>}
  </form>;
}
