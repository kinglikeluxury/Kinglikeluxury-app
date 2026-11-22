import {useState,type FormEvent} from "react";
import {useQuery} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Building2,ShieldCheck,UserRoundPlus} from "lucide-react";
const copy:Record<string,Record<string,string>>={
 ar:{title:"التعرّف على فرص الاستثمار العقاري",subtitle:"دعوة من أحد عملاء KINGLIKE VIP",intro:"يمكنك ترك بيانات التواصل ليقوم فريق Kinglike Luxury بالتواصل معك بشأن العقارات. إرسال الطلب اختياري ولا يلزمك بشراء أي شيء.",name:"اسمك الكامل",phone:"رقم الهاتف الدولي",consent:"أوافق على مشاركة اسمي ورقم هاتفي مع Kinglike Luxury للتواصل معي بشأن الاستثمار العقاري. قد يتمكن الشخص الذي دعاني من متابعة حالة الإحالة فقط، وليس رقم هاتفي.",send:"أرسل طلب التواصل",sent:"شكرًا لك، وصل طلبك وسيُراجع من فريقنا.",error:"تعذر إرسال الطلب. تحقق من الرقم أو حاول لاحقًا.",invalid:"هذا الرابط لم يعد فعالًا.",privacy:"لن تُمنح مكافآت أو امتيازات تلقائيًا بسبب إرسال هذا النموذج."},
 en:{title:"Explore real estate opportunities",subtitle:"An invitation from a KINGLIKE VIP customer",intro:"Leave your details if you want Kinglike Luxury to contact you about real estate. Submission is optional and does not imply any purchase.",name:"Full name",phone:"International phone number",consent:"I consent to sharing my name and phone number with Kinglike Luxury for property-related contact. The person who invited me may see the referral status, but not my phone number.",send:"Request contact",sent:"Thank you, our team has received your request.",error:"We couldn't submit your details. Check the number or try later.",invalid:"This link is no longer active.",privacy:"No reward or benefit is automatically granted by this form."},
 he:{title:"השקעות נדל״ן",subtitle:"הזמנה מלקוח KINGLIKE VIP",intro:"ניתן להשאיר פרטים ליצירת קשר.",name:"שם מלא",phone:"טלפון בינלאומי",consent:"אני מסכים/ה לשתף את פרטי עם Kinglike Luxury. המזמין יראה רק את מצב ההפניה.",send:"שלח",sent:"תודה, הבקשה התקבלה.",error:"השליחה נכשלה",invalid:"הקישור אינו פעיל.",privacy:"הטבות אינן מובטחות."},
 tr:{title:"Gayrimenkul yatırım fırsatları",subtitle:"KINGLIKE VIP müşterisinin daveti",intro:"Kinglike Luxury'nin sizinle iletişime geçmesini istiyorsanız bilgilerinizi bırakın.",name:"Ad soyad",phone:"Uluslararası telefon",consent:"Bilgilerimin Kinglike Luxury ile paylaşılmasına izin veriyorum. Davet eden yalnızca tavsiye durumunu görebilir.",send:"İletişim iste",sent:"Başvurunuz alındı.",error:"Talep gönderilemedi.",invalid:"Bu bağlantı artık geçerli değil.",privacy:"Ödüller otomatik değildir."},
 az:{title:"Daşınmaz əmlak imkanları",subtitle:"KINGLIKE VIP müştərisinin dəvəti",intro:"Kinglike Luxury-nin sizinlə əlaqə saxlamasını istəyirsinizsə, məlumatınızı qeyd edin.",name:"Ad və soyad",phone:"Beynəlxalq telefon",consent:"Məlumatlarımın Kinglike Luxury ilə paylaşılmasına razıyam. Dəvət edən yalnız statusu görə bilər.",send:"Əlaqə istə",sent:"Müraciət qəbul edildi.",error:"Göndərilmədi.",invalid:"Bu keçid artıq aktiv deyil.",privacy:"Mükafatlar avtomatik verilmir."}
};
export default function VipReferralLanding(){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const rtl=/^(ar|he)(-|$)/i.test(i18n.language);
 const [code]=useState(()=>decodeURIComponent(window.location.pathname.split("/").pop()||""));
 const [name,setName]=useState(""),[phone,setPhone]=useState(""),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false),[sent,setSent]=useState(false),[error,setError]=useState("");
 const valid=useQuery<{valid:boolean}>({
  queryKey:["vip","referral-valid",code],
  queryFn:async()=>{const r=await fetch("/api/vip/referral-share/"+encodeURIComponent(code),{cache:"no-store",referrerPolicy:"no-referrer"});if(!r.ok)throw Error("Unavailable");return r.json()},
  enabled:/^KLR-[A-F0-9]{32}$/.test(code),retry:false
 });
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(!consent||busy||!valid.data?.valid)return;
  setBusy(true);setError("");
  try{
   const r=await fetch("/api/vip/referral-share/"+encodeURIComponent(code),{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({name,phoneE164:phone,consent})
   });
   if(!r.ok)throw Error(t.error);
   setSent(true);setName("");setPhone("");setConsent(false);
  }catch{setError(t.error)}finally{setBusy(false)}
 }
 return <main dir={rtl?"rtl":"ltr"} className="min-h-[75vh] bg-[#f1f8f9] px-4 py-10">
  <section className="mx-auto max-w-xl overflow-hidden rounded-2xl bg-white shadow-lg">
   <header className="bg-gradient-to-br from-[#003e5d] to-[#008488] p-7 text-white">
    <Building2 className="mb-3 h-9 w-9 text-[#3BCAC4]"/>
    <h1 className="text-2xl font-semibold">{t.title}</h1>
    <p className="mt-2 text-sm text-white/85">{t.subtitle}</p>
   </header>
   <div className="p-7">
    {!valid.data?.valid||valid.isError?<p role="alert" className="text-sm text-[#8b4545]">{valid.isPending?"…":t.invalid}</p>:
     sent?<p role="status" className="rounded-xl bg-[#eaf8f5] p-5 text-sm text-[#005476]">{t.sent}</p>:
     <>
      <p className="mb-6 text-sm leading-relaxed text-[#527683]">{t.intro}</p>
      <form onSubmit={submit}>
       <label className="block text-sm">{t.name}<input className="mt-2 block w-full rounded-xl border border-[#d4e5e7] p-3" value={name} minLength={2} maxLength={100} required onChange={e=>setName(e.target.value)}/></label>
       <label className="mt-4 block text-sm">{t.phone}<input dir="ltr" type="tel" className="mt-2 block w-full rounded-xl border border-[#d4e5e7] p-3" placeholder="+995555123456" pattern="\+[1-9][0-9]{7,14}" value={phone} required onChange={e=>setPhone(e.target.value)}/></label>
       <label className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-[#476c77]"><input className="mt-1" type="checkbox" required checked={consent} onChange={e=>setConsent(e.target.checked)}/>{t.consent}</label>
       <button type="submit" disabled={busy||!consent||!name.trim()||!phone.trim()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"><UserRoundPlus className="h-4 w-4"/>{t.send}</button>
       {error&&<p role="alert" className="mt-3 text-xs text-rose-700">{error}</p>}
      </form>
     </>}
    <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-[#738d97]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.privacy}</p>
   </div>
  </section>
 </main>;
}
