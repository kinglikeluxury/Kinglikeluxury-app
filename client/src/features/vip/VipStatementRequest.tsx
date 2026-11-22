import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
type RequestRow = { id: string; unit_id: string; status: string; month_start: string };
const labels: Record<string, {request:string, sent:string, error:string, waiting:string, note:string}> = {
  ar: {request:"طلب كشف حساب رسمي",sent:"تم تقديم طلب هذا الشهر",error:"تعذر تقديم الطلب الآن",waiting:"جاري الإرسال…",note:"مرة واحدة شهريًا لكل وحدة. تتابع Kinglike Luxury مع المطور لتأمين الكشف."},
  en: {request:"Request official statement",sent:"Already requested this month",error:"Could not submit request",waiting:"Submitting…",note:"One request per unit per month. Kinglike Luxury will follow up with the developer."},
  he: {request:"בקשת דוח רשמי",sent:"כבר נשלחה בקשה החודש",error:"לא ניתן לשלוח בקשה",waiting:"שולח…",note:"בקשה אחת לחודש ליחידה. Kinglike Luxury תטפל מול היזם."},
  tr: {request:"Resmi hesap dökümü iste",sent:"Bu ay zaten talep edildi",error:"Talep gönderilemedi",waiting:"Gönderiliyor…",note:"Her ünite için ayda bir talep. Kinglike Luxury geliştiriciyle takip eder."},
  az: {request:"Rəsmi hesab çıxarışı istə",sent:"Bu ay artıq sorğu göndərilib",error:"Sorğu göndərilmədi",waiting:"Göndərilir…",note:"Hər mənzil üçün ayda bir sorğu. Kinglike Luxury tikinti şirkəti ilə əlaqə saxlayır."}
};
export default function VipStatementRequest({ unitId }: {unitId: string}) {
  const { i18n } = useTranslation();
  const t=labels[i18n.language.split("-")[0]]||labels.en;
  const qc=useQueryClient();
  const requests=useQuery<{requests:RequestRow[]}>({
    queryKey:["vip","statement-requests"],
    queryFn:async()=>{const r=await fetch("/api/vip/statement-requests",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},
    retry:false
  });
  const send=useMutation({
    mutationFn:async()=>{
      const r=await fetch("/api/vip/statement-requests",{
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({unitId})
      });
      if(!r.ok)throw Error("Cannot submit");return r.json();
    },
    onSuccess:()=>{qc.invalidateQueries({queryKey:["vip","statement-requests"]})}
  });
  // Local calendar month (server enforces the authoritative period and uniqueness).
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:"Asia/Tbilisi",year:"numeric",month:"2-digit"}).formatToParts(new Date());
  const year = parts.find((p)=>p.type==="year")?.value;
  const month = parts.find((p)=>p.type==="month")?.value;
  const currentMonth = year && month ? year+"-"+month : "";
  const already=requests.data?.requests.some(x=>x.unit_id===unitId && String(x.month_start).slice(0,7)===currentMonth);
  return <div className="mt-5 border-t border-[#e2eff0] pt-4">
    <button type="button" disabled={requests.isPending||requests.isError||already||send.isPending}
      onClick={()=>send.mutate()}
      className="w-full rounded-xl bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#b4c9cc]">
      {send.isPending?t.waiting:already?t.sent:t.request}
    </button>
    <p className="mt-2 text-xs text-[#6d8996]">{t.note}</p>
    {(send.isError||requests.isError)&&<p role="alert" className="mt-2 text-xs text-red-700">{t.error}</p>}
  </div>;
}
