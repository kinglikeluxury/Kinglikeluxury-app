import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Link2,Copy,Check} from "lucide-react";
type LinkInfo={code:string;is_active:boolean};
const copy:Record<string,Record<string,string>>={
 ar:{title:"رابط الإحالة الخاص بك",info:"شارك الرابط مع أشخاص مهتمين بالاستثمار. يضع الشخص بياناته بموافقته، ويمكنك متابعة حالة الإحالة دون الاطلاع على رقم هاتفه.",create:"إنشاء رابط إحالة خاص",share:"نسخ رابط الدعوة",copied:"تم نسخ الرابط",inactive:"رابط الإحالة ملغى",error:"تعذر إنشاء الرابط أو نسخه"},
 en:{title:"Your personal referral link",info:"Share this link with interested buyers. They submit their information with consent. You may follow the referral status, but not their phone.",create:"Create personal referral link",share:"Copy invitation link",copied:"Link copied",inactive:"Link disabled",error:"Couldn't generate or copy link"},
 he:{title:"קישור הפניה אישי",info:"שתף עם מתעניינים. הפרטים מתקבלים בהסכמה בלבד.",create:"צור קישור",share:"העתק קישור",copied:"הועתק",inactive:"הקישור בוטל",error:"שגיאה"},
 tr:{title:"Kişisel tavsiye bağlantısı",info:"Bağlantıyı paylaşın; ilgili kişi izin vererek form doldurur. Telefon bilgisi size gösterilmez.",create:"Bağlantı oluştur",share:"Bağlantıyı kopyala",copied:"Kopyalandı",inactive:"Bağlantı kapalı",error:"İşlem başarısız"},
 az:{title:"Şəxsi tövsiyə keçidi",info:"Maraqlanan şəxslərlə paylaşın. Əlaqə məlumatı yalnız razılıqla təqdim edilir.",create:"Keçid yarat",share:"Keçidi köçür",copied:"Köçürüldü",inactive:"Keçid söndürülüb",error:"Xəta"}
};
export default function VipReferralLinkClient(){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const qc=useQueryClient();const [busy,setBusy]=useState(false),[notice,setNotice]=useState("");
 const query=useQuery<{link:LinkInfo|null}>({
   queryKey:["vip","referral-link"],
   queryFn:async()=>{const r=await fetch("/api/vip/referral-link",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
   retry:false
 });
 const active=query.data?.link?.is_active===true;
 const url=active?window.location.origin+"/vip/refer/"+query.data!.link!.code:"";
 async function issue(){
  setBusy(true);setNotice("");
  try{
   const r=await fetch("/api/vip/referral-link",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{}"});
   if(!r.ok)throw Error(t.error);
   await qc.invalidateQueries({queryKey:["vip","referral-link"]});
  }catch{setNotice(t.error)}finally{setBusy(false)}
 }
 async function clipboard(){
  try{await navigator.clipboard.writeText(url);setNotice(t.copied)}
  catch{setNotice(t.error)}
 }
 return <section className="mt-8 rounded-2xl border border-[#cae3e3] bg-[#f6fcfb] p-5">
  <h3 className="flex items-center gap-2 text-base font-semibold"><Link2 className="h-5 w-5 text-[#069396]"/>{t.title}</h3>
  <p className="mt-2 text-xs leading-relaxed text-[#6c8994]">{t.info}</p>
  {query.data?.link&&!active?<p className="mt-3 text-xs text-rose-700">{t.inactive}</p>:
   active?<div className="mt-4">
    <input type="text" readOnly dir="ltr" aria-label={t.title} className="w-full rounded-lg border border-[#c9e5e6] bg-white p-3 font-mono text-xs" value={url}/>
    <button type="button" onClick={()=>void clipboard()} className="mt-2 inline-flex items-center gap-2 rounded-lg bg-[#005476] px-4 py-2 text-xs font-semibold text-white">
     {notice===t.copied?<Check className="h-4 w-4"/>:<Copy className="h-4 w-4"/>}{t.share}</button>
   </div>:query.isSuccess?<button type="button" disabled={busy} onClick={()=>void issue()}
     className="mt-4 rounded-lg bg-[#005476] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t.create}</button>:null}
  {notice&&<p role="status" className="mt-2 text-xs text-[#005476]">{notice}</p>}
 </section>;
}
