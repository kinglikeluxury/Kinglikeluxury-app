import {useQuery} from "@tanstack/react-query";
import {useEffect,useState} from "react";
import {useTranslation} from "react-i18next";
import {Crown,ShieldCheck,ShieldX} from "lucide-react";
const copy:Record<string,Record<string,string>>={
 ar:{title:"التحقق من عضوية KINGLIKE VIP",valid:"بطاقة عضوية فعالة",invalid:"هذه البطاقة غير فعالة أو غير موجودة",tier:"فئة العضوية",note:"التحقق يؤكد صلاحية البطاقة فقط ولا يمثل ضمانًا لمزايا أو خصومات.",loading:"جاري التحقق..."},
 en:{title:"Verify KINGLIKE VIP membership",valid:"Active VIP card",invalid:"Card not active or not found",tier:"Membership tier",note:"This confirms card validity only and does not guarantee benefits.",loading:"Verifying..."},
 he:{title:"אימות כרטיס KINGLIKE VIP",valid:"כרטיס פעיל",invalid:"כרטיס לא פעיל או לא נמצא",tier:"דרגה",note:"האימות אינו מבטיח הטבות.",loading:"מאמת..."},
 tr:{title:"KINGLIKE VIP kart doğrulama",valid:"Aktif VIP kartı",invalid:"Kart bulunamadı veya aktif değil",tier:"Üyelik seviyesi",note:"Doğrulama, avantaj garantisi değildir.",loading:"Doğrulanıyor..."},
 az:{title:"KINGLIKE VIP kart təsdiqi",valid:"Aktiv VIP kart",invalid:"Kart aktiv deyil və ya tapılmadı",tier:"Üzvlük səviyyəsi",note:"Bu təsdiq güzəştlərə zəmanət vermir.",loading:"Yoxlanılır..."}
};
export default function VipCardVerifyPage(){
 const {i18n}=useTranslation();const t=copy[i18n.language.split("-")[0]]||copy.en;
 const [code]=useState(()=>new URLSearchParams(window.location.search).get("code")||"");
 useEffect(()=>{
   if(code)window.history.replaceState(window.history.state,"","/vip/card/verify");
 },[code]);
 const data=useQuery<{valid:boolean;tier?:string}>({
   queryKey:["vip","card-verification",code],
   queryFn:async()=>{const r=await fetch("/api/vip/cards/verify?code="+encodeURIComponent(code),{cache:"no-store",referrerPolicy:"no-referrer"});if(!r.ok)throw Error("Unavailable");return r.json()},
   enabled:!!code,retry:false
 });
 const valid=data.data?.valid===true;
 return <main dir={/^(ar|he)(-|$)/i.test(i18n.language)?"rtl":"ltr"} className="min-h-[75vh] bg-[#f2f8f9] px-4 py-16">
  <section className="mx-auto max-w-md overflow-hidden rounded-2xl border border-[#d9e8ea] bg-white shadow-lg">
   <header className="bg-[#005476] p-7 text-center text-white">
    <Crown className="mx-auto mb-3 h-9 w-9 text-[#3BCAC4]"/><h1 className="text-xl font-semibold">{t.title}</h1>
   </header>
   <div className="p-7 text-center text-[#005476]">
    {data.isPending&&code?<p>{t.loading}</p>:valid?<><ShieldCheck className="mx-auto mb-4 h-12 w-12 text-emerald-700"/><h2 className="text-xl font-bold">{t.valid}</h2><p className="mt-2">{t.tier}: {data.data?.tier}</p></>:
    <><ShieldX className="mx-auto mb-4 h-12 w-12 text-[#b15252]"/><h2 className="font-bold">{t.invalid}</h2></>}
    <p className="mt-6 text-xs leading-relaxed text-[#708994]">{t.note}</p>
   </div>
  </section>
 </main>;
}
