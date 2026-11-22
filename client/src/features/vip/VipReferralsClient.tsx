import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Gift,UserPlus,Phone,ShieldCheck} from "lucide-react";
import VipReferralLinkClient from "./VipReferralLinkClient";
type Referral={id:string;lead_name:string|null;lead_phone_e164:string|null;source:"direct"|"share_link";status:string;reward_status:string|null;reward_description:string|null;created_at:string};
const l:Record<string,Record<string,string>>={
 ar:{title:"ترشيحات VIP والمكافآت",intro:"رشّح شخصًا مهتمًا بالاستثمار العقاري، وسيتواصل فريقنا معه بعد الحصول على موافقته.",name:"اسم الشخص",phone:"رقم الهاتف الدولي",consent:"أؤكد أن الشخص وافق على مشاركة بياناته مع Kinglike Luxury والتواصل معه بشأن العقارات.",send:"إضافة ترشيح",sending:"جاري الإرسال...",success:"تم تسجيل الترشيح، وسيُراجع من الإدارة.",error:"تعذر تسجيل الترشيح. تأكد من الرقم الدولي والموافقة.",history:"ترشيحاتي",empty:"لم تسجّل أي ترشيحات بعد.",new:"جديد",contacted:"تم التواصل",qualified:"مهتم",converted:"تمت صفقة",declined:"مغلق",proposed:"مكافأة قيد المراجعة",approved:"مكافأة معتمدة",fulfilled:"تم تقديم المكافأة",note:"المكافآت والخصومات ليست تلقائية؛ تعتمد فقط عند مراجعة الإدارة ووفق الشروط المعتمدة."},
 en:{title:"VIP referrals & rewards",intro:"Refer someone interested in property investment after obtaining their consent to be contacted.",name:"Contact name",phone:"International phone number",consent:"I confirm this person consented to sharing their information with Kinglike Luxury for property-related contact.",send:"Submit referral",sending:"Sending...",success:"Referral submitted for management review.",error:"Could not save referral. Check phone and consent.",history:"My referrals",empty:"No referrals yet.",new:"New",contacted:"Contacted",qualified:"Qualified",converted:"Sale recorded",declined:"Closed",proposed:"Reward under review",approved:"Reward approved",fulfilled:"Reward delivered",note:"Benefits are never automatic and require explicit management approval."},
 he:{title:"הפניות ומענקי VIP",intro:"הפנה אדם המעוניין בנדל״ן לאחר קבלת הסכמתו.",name:"שם איש הקשר",phone:"טלפון בינלאומי",consent:"אני מאשר/ת שהאדם הסכים לשיתוף פרטיו וליצירת קשר.",send:"שליחת הפניה",sending:"שולח...",success:"ההפניה התקבלה לבדיקה.",error:"לא ניתן לשמור את ההפניה.",history:"ההפניות שלי",empty:"אין הפניות.",new:"חדש",contacted:"נוצר קשר",qualified:"מתעניין",converted:"בוצעה עסקה",declined:"נסגר",proposed:"תגמול בבדיקה",approved:"תגמול אושר",fulfilled:"תגמול נמסר",note:"הטבות דורשות אישור מפורש."},
 tr:{title:"VIP tavsiyeleri ve ödüller",intro:"İzni alınmış bir yatırımcıyı tavsiye edin.",name:"Kişinin adı",phone:"Uluslararası telefon",consent:"Kişinin iletişim bilgilerinin Kinglike Luxury ile paylaşılmasına izin verdiğini onaylıyorum.",send:"Tavsiye gönder",sending:"Gönderiliyor...",success:"Tavsiye incelemeye alındı.",error:"Tavsiye gönderilemedi.",history:"Tavsiyelerim",empty:"Henüz tavsiye yok.",new:"Yeni",contacted:"İletişim kuruldu",qualified:"İlgileniyor",converted:"Satış kaydı",declined:"Kapatıldı",proposed:"Ödül inceleniyor",approved:"Ödül onaylandı",fulfilled:"Ödül teslim edildi",note:"Ödüller otomatik değildir, yönetim onayı gerekir."},
 az:{title:"VIP tövsiyələr və mükafatlar",intro:"Razılıq vermiş potensial alıcını tövsiyə edin.",name:"Əlaqə şəxsi",phone:"Beynəlxalq telefon",consent:"Şəxsin məlumatlarını Kinglike Luxury ilə paylaşmağa razı olduğunu təsdiq edirəm.",send:"Tövsiyə göndər",sending:"Göndərilir...",success:"Tövsiyə baxılmaq üçün qəbul edildi.",error:"Tövsiyə göndərilmədi.",history:"Tövsiyələrim",empty:"Hələ tövsiyə yoxdur.",new:"Yeni",contacted:"Əlaqə saxlanıldı",qualified:"Maraqlıdır",converted:"Satış qeydi",declined:"Bağlandı",proposed:"Mükafat yoxlanılır",approved:"Mükafat təsdiqləndi",fulfilled:"Mükafat təqdim edildi",note:"Mükafatlar avtomatik verilmir və rəhbərlik təsdiqi tələb olunur."}
};
export default function VipReferralsClient(){
 const {i18n}=useTranslation();const t=l[i18n.language.split("-")[0]]||l.en;
 const qc=useQueryClient();const [name,setName]=useState("");const [phone,setPhone]=useState("");const [countryCode,setCountryCode]=useState("+995");const [consent,setConsent]=useState(false);
 const countries=[["🇬🇪","+995","Georgia"],["🇹🇷","+90","Türkiye"],["🇦🇿","+994","Azerbaijan"],["🇦🇪","+971","UAE"],["🇸🇦","+966","Saudi"],["🇶🇦","+974","Qatar"],["🇰🇼","+965","Kuwait"],["🇮🇱","+972","Israel"],["🇵🇸","+970","Palestine"],["🇯🇴","+962","Jordan"],["🇸🇾","+963","Syria"],["🇱🇧","+961","Lebanon"],["🇪🇬","+20","Egypt"],["🇬🇧","+44","UK"],["🇺🇸","+1","USA"]] as const;
 const fullPhone=phone.trim().startsWith("+")?phone.trim():countryCode+phone.trim().replace(/^0+/,"");
 const phoneOk=/^\+[1-9][0-9]{7,14}$/.test(fullPhone);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [success,setSuccess]=useState(false);
 const data=useQuery<{referrals:Referral[]}>({
   queryKey:["vip","referrals"],
   queryFn:async()=>{const r=await fetch("/api/vip/referrals",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||!consent)return;
  setBusy(true);setMessage("");
  try{
   const r=await fetch("/api/vip/referrals",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({leadName:name,phoneE164:fullPhone,contactConsent:consent})});
   if(!r.ok)throw Error(t.error);
   setSuccess(true);setMessage(t.success);setName("");setPhone("");setConsent(false);
   await qc.invalidateQueries({queryKey:["vip","referrals"]});
  }catch{setSuccess(false);setMessage(t.error)}finally{setBusy(false)}
 }
 return <section className="mt-10">
  <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold"><Gift className="h-6 w-6 text-[#008c93]"/>{t.title}</h2>
  <p className="mb-5 text-sm text-[#67828c]">{t.intro}</p>
  <VipReferralLinkClient/>
  <form onSubmit={submit} className="rounded-2xl border border-[#d6e8ea] bg-white p-5 shadow-sm">
   <div className="grid gap-4 md:grid-cols-2">
    <label className="block text-sm">{t.name}
     <input required minLength={2} maxLength={100} value={name} onChange={e=>setName(e.target.value)}
       className="mt-2 block w-full rounded-xl border border-[#c9dddf] p-3"/>
    </label>
    <label className="block text-sm">{t.phone}
     <div className="mt-2 flex min-w-0 items-center gap-2 rounded-xl border border-[#c9dddf] px-3">
      <Phone className="h-5 w-5 shrink-0 text-[#45989b]"/>
      <select aria-label="Country dialing code" dir="ltr" value={countryCode} onChange={e=>setCountryCode(e.target.value)}
       className="max-w-[115px] shrink-0 bg-white py-3 text-xs outline-none">
       {countries.map(c=><option key={c[1]} value={c[1]}>{c[0]} {c[1]} {c[2]}</option>)}
      </select>
      <input dir="ltr" type="tel" inputMode="tel" placeholder="555123456" required
       value={phone} onChange={e=>setPhone(e.target.value)}
       className="min-w-0 flex-1 py-3 text-sm outline-none"/>
     </div>
     {phone&&<p dir="ltr" className="mt-1 text-xs text-[#6d8994]">{fullPhone}</p>}
    </label>
   </div>
   <label className="mt-4 flex items-start gap-3 text-xs leading-relaxed text-[#466977]">
     <input type="checkbox" required checked={consent} onChange={e=>setConsent(e.target.checked)} className="mt-1"/>
     <span>{t.consent}</span>
   </label>
   <button type="submit" disabled={busy||!consent||!phoneOk}
     className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">
     <UserPlus className="h-4 w-4"/>{busy?t.sending:t.send}
   </button>
   {message&&<p role="status" className={"mt-3 text-xs "+(success?"text-emerald-800":"text-red-700")}>{message}</p>}
  </form>
  <div className="mt-6">
   <h3 className="mb-3 text-sm font-semibold">{t.history}</h3>
   {data.isPending?<p className="text-sm">…</p>:data.isError?<p className="text-sm text-rose-700">{t.error}</p>:
    data.data.referrals.length===0?<p className="rounded-xl bg-white p-4 text-sm text-[#6d8994]">{t.empty}</p>:
    <div className="grid gap-3 md:grid-cols-2">{data.data.referrals.map(r=>
      <div key={r.id} className="rounded-xl border border-[#d7e8e9] bg-white p-4">
       <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-sm">{r.lead_name||"KINGLIKE VIP · Referral"}</strong>
        <span className="rounded-full bg-[#e6f6f4] px-3 py-1 text-xs text-[#00676f]">{t[r.status]||r.status}</span>
       </div>
       {r.lead_phone_e164&&<p dir="ltr" className="mt-2 text-xs text-[#6d8692]">{r.lead_phone_e164}</p>}
       {r.reward_status&&<div className="mt-3 border-t border-[#e1eff0] pt-3">
        <span className="text-xs font-semibold text-[#005476]">{t[r.reward_status]||r.reward_status}</span>
        {r.reward_description&&<p className="mt-2 text-xs text-[#577b84]">{r.reward_description}</p>}
       </div>}
      </div>
    )}</div>}
  </div>
  <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-[#728b94]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.note}</p>
 </section>;
}
