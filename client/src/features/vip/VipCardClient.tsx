import {useMemo,useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Crown,ShieldCheck,Copy,Check} from "lucide-react";
import qrcode from "./vendor/qrcode.mjs";

type VipCard={member_code:string;tier:"VIP"|"Silver"|"Gold"|"Platinum";is_active:boolean;created_at:string};
const l:Record<string,Record<string,string>>={
 ar:{title:"بطاقة KINGLIKE VIP الرقمية",subtitle:"عضوية حصرية لعملاء Kinglike Luxury",activate:"تفعيل بطاقتي الرقمية",active:"عضوية فعالة",inactive:"بطاقة غير فعالة — تواصل مع الإدارة",tier:"فئة العضوية",number:"رقم العضوية",since:"عضو منذ",verify:"امسح QR للتحقق من صلاحية البطاقة",copy:"نسخ رقم العضوية",copied:"تم النسخ",error:"البطاقة غير متاحة حاليًا",notice:"المزايا والخصومات تُعرض فقط بعد اعتمادها من إدارة Kinglike Luxury. لا تمنح هذه البطاقة حقًا تلقائيًا بخصم أو مكافأة.",pending:"جاري التجهيز..."},
 en:{title:"KINGLIKE VIP digital card",subtitle:"Exclusive Kinglike Luxury membership",activate:"Activate digital card",active:"Active membership",inactive:"Inactive card — contact management",tier:"Membership tier",number:"Member ID",since:"Member since",verify:"Scan QR to verify membership status",copy:"Copy member ID",copied:"Copied",error:"Membership card unavailable",notice:"Benefits and discounts only apply when explicitly approved by Kinglike Luxury. This card does not guarantee a reward.",pending:"Loading..."},
 he:{title:"כרטיס KINGLIKE VIP",subtitle:"חברות בלעדית",activate:"הפעל כרטיס",active:"חברות פעילה",inactive:"כרטיס לא פעיל",tier:"דרגה",number:"מספר חברות",since:"חבר מאז",verify:"סרוק QR לאימות",copy:"העתק מספר",copied:"הועתק",error:"הכרטיס אינו זמין",notice:"ההטבות כפופות לאישור ההנהלה.",pending:"טוען..."},
 tr:{title:"KINGLIKE VIP dijital kart",subtitle:"Özel Kinglike Luxury üyeliği",activate:"Kartımı etkinleştir",active:"Aktif üyelik",inactive:"Kart devre dışı",tier:"Üyelik seviyesi",number:"Üyelik kodu",since:"Üyelik başlangıcı",verify:"Doğrulamak için QR kodu okutun",copy:"Kodu kopyala",copied:"Kopyalandı",error:"Kart kullanılamıyor",notice:"Avantajlar yalnızca Kinglike Luxury onayından sonra geçerlidir.",pending:"Yükleniyor..."},
 az:{title:"KINGLIKE VIP rəqəmsal kart",subtitle:"Eksklüziv Kinglike Luxury üzvlüyü",activate:"Kartı aktivləşdir",active:"Aktiv üzvlük",inactive:"Kart aktiv deyil",tier:"Üzvlük səviyyəsi",number:"Üzvlük kodu",since:"Üzv olduğu tarix",verify:"Üzvlüyü yoxlamaq üçün QR-ni skan edin",copy:"Kodu köçür",copied:"Köçürüldü",error:"Kart mövcud deyil",notice:"Üstünlüklər yalnız Kinglike Luxury təsdiqindən sonra keçərlidir.",pending:"Yüklənir..."}
};
function VipQr({url}:{url:string}){
 const modules=useMemo(()=>{
  try{
    const qr=qrcode(0,"M");
    qr.addData(url,"Byte");qr.make();
    const count=qr.getModuleCount();const cells:{x:number;y:number}[]=[];
    for(let y=0;y<count;y++)for(let x=0;x<count;x++)if(qr.isDark(y,x))cells.push({x,y});
    return {count,cells};
  }catch{return null;}
 },[url]);
 if(!modules)return null;
 const size=modules.count+8;
 return <svg role="img" aria-label="KINGLIKE VIP membership QR" viewBox={"0 0 "+size+" "+size}
    className="h-36 w-36 rounded-lg bg-white p-2" shapeRendering="crispEdges">
   <rect width={size} height={size} fill="#fff"/>
   {modules.cells.map(c=><rect key={c.y+"-"+c.x} x={c.x+4} y={c.y+4} width={1} height={1} fill="#072d47"/>)}
 </svg>;
}
export default function VipCardClient(){
 const {i18n}=useTranslation();const t=l[i18n.language.split("-")[0]]||l.en;
 const qc=useQueryClient();
 const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [copied,setCopied]=useState(false);
 const data=useQuery<{card:VipCard|null}>({
   queryKey:["vip","card"],
   queryFn:async()=>{const r=await fetch("/api/vip/card",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Not available");return r.json()},
   retry:false
 });
 async function issue(){
   setBusy(true);setError("");
   try{
    const r=await fetch("/api/vip/card/issue",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:"{}"});
    if(!r.ok)throw Error(t.error);
    await qc.invalidateQueries({queryKey:["vip","card"]});
   }catch{setError(t.error)}finally{setBusy(false)}
 }
 const card=data.data?.card;
 const link=card?new URL("/vip/card/verify?code="+encodeURIComponent(card.member_code),window.location.origin).toString():"";
 return <section className="mt-10">
   <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><Crown className="h-6 w-6 text-[#118f95]"/>{t.title}</h2>
   {data.isPending?<p>{t.pending}</p>:data.isError?<p role="alert" className="text-red-700">{t.error}</p>:
    !card?<div className="rounded-2xl border border-[#d7e8ea] bg-white p-6">
      <p className="mb-4 text-sm text-[#537987]">{t.subtitle}</p>
      <button type="button" disabled={busy} onClick={issue} className="rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.activate}</button>
      {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </div>:
    <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#00334e] via-[#005476] to-[#028e91] p-6 text-white shadow-lg md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-5">
       <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-center gap-2"><Crown className="h-8 w-8 text-[#3BCAC4]"/><span className="text-lg font-semibold tracking-[0.15em]">KINGLIKE VIP</span></div>
        <p className="text-sm text-white/75">{t.subtitle}</p>
        <p className="mt-7 text-xs uppercase tracking-widest text-[#a4e4e2]">{t.tier}</p>
        <p className="text-3xl font-bold">{card.tier}</p>
        <p className="mt-6 text-xs text-white/70">{t.number}</p>
        <p dir="ltr" className="mt-1 break-all font-mono text-sm font-semibold tracking-wide">{card.member_code}</p>
        <p className="mt-2 text-xs text-white/70">{t.since}: {new Date(card.created_at).toLocaleDateString(i18n.language)}</p>
        <p className="mt-5 flex items-center gap-1 text-xs text-[#b9f5ec]"><ShieldCheck className="h-4 w-4"/>{card.is_active?t.active:t.inactive}</p>
       </div>
       {card.is_active&&<div className="flex flex-col items-center gap-2">
         <VipQr url={link}/>
         <p className="max-w-40 text-center text-[11px] text-white/85">{t.verify}</p>
       </div>}
      </div>
      <div className="mt-6 border-t border-white/20 pt-4">
        <button type="button" onClick={()=>navigator.clipboard.writeText(card.member_code).then(()=>setCopied(true)).catch(()=>{})}
           className="inline-flex items-center gap-2 rounded-lg border border-white/40 px-3 py-2 text-xs">
          {copied?<Check className="h-4 w-4"/>:<Copy className="h-4 w-4"/>}{copied?t.copied:t.copy}
        </button>
      </div>
    </div>}
   <p className="mt-3 text-xs leading-relaxed text-[#6f8993]">{t.notice}</p>
 </section>;
}
