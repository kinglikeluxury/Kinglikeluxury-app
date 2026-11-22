import {useState,type FormEvent} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {Coins,ShieldCheck,BadgeCheck} from "lucide-react";

type Rate={id:string;base_currency:string;quote_currency:string;rate:string;effective_date:string;source:string;source_reference:string;published:boolean};
type Commission={id:string;unit_id:string;side:string;category:string;basis_amount:string|null;percentage:string|null;fixed_amount:string|null;currency:string;payee_label:string;contract_reference:string;note:string|null;estimated_amount:string;status:string};
type Unit={id:string;project_id:string;unit_number:string};
const textCopy:Record<string,Record<string,string>>={
 ar:{title:"أسعار الصرف والعمولات الداخلية",rates:"أسعار الصرف المرجعية",base:"من عملة",quote:"إلى عملة",value:"سعر الصرف",date:"تاريخ السعر",source:"مصدر السعر",reference:"مرجع المستند",addRate:"حفظ سعر كمسودة",approve:"اعتماد المصدر ونشر السعر",rateNotice:"لا يتم تحويل أي مبلغ في كشف العميل تلقائيًا. السعر المعتمد مرجعي بتاريخ محدد.",commission:"العمولات الداخلية — سرية",unit:"الوحدة",side:"تدفق العمولة",category:"نوع العمولة",basis:"قيمة الصفقة الأساسية",percentage:"النسبة المئوية",fixed:"مبلغ ثابت بديل عن النسبة",currency:"العملة",payee:"المستفيد أو جهة العمولة",contract:"مرجع الاتفاقية الموقّعة",note:"ملاحظات داخلية",add:"إضافة تقدير عمولة",review:"اعتماد مالي",settle:"تسجيل تسوية موثقة",void:"إبطال",settlement:"مرجع تحويل أو تسوية",reason:"سبب المراجعة",income:"إيراد الشركة",expense:"تكلفة الشركة",success:"تم حفظ السجل",error:"تعذر تنفيذ العملية",private:"العمولات هنا داخلية للإدارة فقط ولا تظهر مطلقًا للعميل. الحساب تقديري حتى اعتماد قسم المالية وتوثيق السداد."},
 en:{title:"Exchange rates and internal commissions",rates:"Reference exchange rates",base:"Base currency",quote:"Quote currency",value:"Rate",date:"Rate date",source:"Rate source",reference:"Document reference",addRate:"Save draft rate",approve:"Finance approve rate",rateNotice:"Rates are dated references; no client balances are converted automatically.",commission:"Private internal commissions",unit:"Unit",side:"Flow",category:"Category",basis:"Sale price basis",percentage:"Percentage",fixed:"Fixed amount instead of percentage",currency:"Currency",payee:"Payee",contract:"Signed agreement reference",note:"Internal note",add:"Create commission estimate",review:"Finance approval",settle:"Record documented settlement",void:"Void",settlement:"Transfer or settlement reference",reason:"Review reason",income:"Company revenue",expense:"Company expense",success:"Saved",error:"Operation failed",private:"Internal only — never shown to the buyer. Figures are estimates until approved and documented by finance."},
 he:{title:"שערי מטבע ועמלות",rates:"שערי מטבע",base:"מטבע בסיס",quote:"מטבע יעד",value:"שער",date:"תאריך",source:"מקור",reference:"אסמכתה",addRate:"שמור טיוטה",approve:"אישור",rateNotice:"שערים לצורך מידע בלבד.",commission:"עמלות פנימיות",unit:"יחידה",side:"סוג",category:"קטגוריה",basis:"סכום בסיס",percentage:"אחוז",fixed:"סכום קבוע",currency:"מטבע",payee:"מוטב",contract:"הסכם",note:"הערה",add:"הוספה",review:"אישור",settle:"רישום תשלום",void:"ביטול",settlement:"אסמכתת תשלום",reason:"סיבה",income:"הכנסה",expense:"הוצאה",success:"נשמר",error:"שגיאה",private:"מידע פנימי למנהלים בלבד."},
 tr:{title:"Döviz kurları ve iç komisyonlar",rates:"Referans kurlar",base:"Kaynak döviz",quote:"Hedef döviz",value:"Kur",date:"Tarih",source:"Kaynak",reference:"Belge",addRate:"Taslak kaydet",approve:"Finans onayı",rateNotice:"Kurlar bilgi amaçlıdır, müşteri bakiyeleri otomatik çevrilmez.",commission:"Gizli iç komisyonlar",unit:"Ünite",side:"Akış",category:"Kategori",basis:"Satış baz tutarı",percentage:"Oran",fixed:"Sabit tutar",currency:"Döviz",payee:"Lehtar",contract:"Sözleşme",note:"Not",add:"Tahmin ekle",review:"Finans onayı",settle:"Belgeli ödeme",void:"İptal",settlement:"Ödeme referansı",reason:"İnceleme nedeni",income:"Gelir",expense:"Gider",success:"Kaydedildi",error:"Başarısız",private:"Yalnızca yönetim içindir. Komisyonlar onaylanana kadar tahmindir."},
 az:{title:"Valyuta məzənnələri və komissiyalar",rates:"İstinad məzənnələri",base:"İlkin valyuta",quote:"Hədəf valyuta",value:"Məzənnə",date:"Tarix",source:"Mənbə",reference:"Sənəd",addRate:"Qaralama saxla",approve:"Maliyyə təsdiqi",rateNotice:"Məzənnələr məlumat üçündür, qalıqlar avtomatik çevrilmir.",commission:"Məxfi daxili komissiyalar",unit:"Mənzil",side:"Növ",category:"Kateqoriya",basis:"Satış məbləği",percentage:"Faiz",fixed:"Sabit məbləğ",currency:"Valyuta",payee:"Alan",contract:"Müqavilə",note:"Qeyd",add:"Təxmini əlavə et",review:"Təsdiq",settle:"Ödənişi qeyd et",void:"Ləğv et",settlement:"Ödəniş istinadı",reason:"Səbəb",income:"Gəlir",expense:"Xərc",success:"Saxlandı",error:"Xəta",private:"Yalnız rəhbərlik üçündür. Təsdiq edilməyən komissiyalar təxminidir."}
};
const input="mt-1 block w-full rounded-lg border border-[#cfe1e4] bg-white px-3 py-2.5 text-sm";
export default function VipAdvancedFinanceAdmin(){
 const {i18n}=useTranslation();const t=textCopy[i18n.language.split("-")[0]]||textCopy.en;
 const qc=useQueryClient();
 const [busy,setBusy]=useState(false),[msg,setMsg]=useState("");
 const [base,setBase]=useState("USD"),[quote,setQuote]=useState("GEL"),[rate,setRate]=useState(""),[effectiveDate,setEffectiveDate]=useState(""),[source,setSource]=useState(""),[reference,setReference]=useState("");
 const [unit,setUnit]=useState(""),[side,setSide]=useState("income"),[category,setCategory]=useState("developer"),
  [basis,setBasis]=useState(""),[percent,setPercent]=useState(""),[fixed,setFixed]=useState(""),[currency,setCurrency]=useState("USD"),
  [payee,setPayee]=useState(""),[contract,setContract]=useState(""),[note,setNote]=useState("");
 const [reason,setReason]=useState(""),[settlement,setSettlement]=useState("");
 const catalog=useQuery<{units:Unit[]}>({
  queryKey:["vip","admin","projects"],queryFn:async()=>{const r=await fetch("/api/admin/vip/projects",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const rates=useQuery<{rates:Rate[]}>({
  queryKey:["vip","admin","fx"],queryFn:async()=>{const r=await fetch("/api/admin/vip/fx-rates",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const commissions=useQuery<{commissions:Commission[]}>({
  queryKey:["vip","admin","commissions"],queryFn:async()=>{const r=await fetch("/api/admin/vip/internal-commissions",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const finance=useQuery<{canApprove:boolean}>({
  queryKey:["vip","finance","me"],queryFn:async()=>{const r=await fetch("/api/admin/vip/finance/me",{credentials:"include",cache:"no-store"});if(!r.ok)throw Error("Unavailable");return r.json()},retry:false
 });
 const unitId=unit||catalog.data?.units[0]?.id||"";
 async function api(path:string,method:"POST"|"PATCH",body:unknown){
  if(busy)return false;setBusy(true);setMsg("");
  try{
   const r=await fetch(path,{method,credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
   if(!r.ok)throw Error(t.error);
   await Promise.all([
    qc.invalidateQueries({queryKey:["vip","admin","fx"]}),
    qc.invalidateQueries({queryKey:["vip","admin","commissions"]}),
    qc.invalidateQueries({queryKey:["vip","fx"]})
   ]);
   setMsg(t.success);return true;
  }catch{setMsg(t.error);return false}
  finally{setBusy(false)}
 }
 async function createFx(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(await api("/api/admin/vip/fx-rates","POST",{baseCurrency:base,quoteCurrency:quote,rate,effectiveDate,source,sourceReference:reference,published:false})){
   setRate("");setReference("");
  }
 }
 async function createCommission(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(!unitId)return;
  if(await api("/api/admin/vip/internal-commissions","POST",{
    unitId:Number(unitId),side,category,basisAmount:fixed?null:basis,percentage:fixed?null:percent,
    fixedAmount:fixed||null,currency,payeeLabel:payee,contractReference:contract,note
  })){setBasis("");setPercent("");setFixed("");setNote("");}
 }
 async function commissionAction(id:string,action:"approve"|"void"|"record_settlement"){
  if(reason.trim().length<10)return;
  if(await api("/api/admin/vip/internal-commissions/"+encodeURIComponent(id),"PATCH",{
    action,note:reason,paymentReference:action==="record_settlement"?settlement:null
  })){setReason("");setSettlement("");}
 }
 return <section className="mt-9 space-y-6">
  <div className="rounded-2xl border border-[#d4e8e9] bg-white p-5 md:p-6">
   <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Coins className="h-6 w-6 text-[#009397]"/>{t.title}</h2>
   <h3 className="mb-3 font-semibold">{t.rates}</h3>
   <form className="grid gap-3 sm:grid-cols-3" onSubmit={createFx}>
    <label className="text-xs">{t.base}<input required maxLength={3} pattern="[A-Z]{3}" value={base} onChange={e=>setBase(e.target.value.toUpperCase())} className={input}/></label>
    <label className="text-xs">{t.quote}<input required maxLength={3} pattern="[A-Z]{3}" value={quote} onChange={e=>setQuote(e.target.value.toUpperCase())} className={input}/></label>
    <label className="text-xs">{t.value}<input required inputMode="decimal" value={rate} onChange={e=>setRate(e.target.value)} className={input}/></label>
    <label className="text-xs">{t.date}<input required type="date" value={effectiveDate} onChange={e=>setEffectiveDate(e.target.value)} className={input}/></label>
    <label className="text-xs">{t.source}<input required minLength={3} maxLength={120} value={source} onChange={e=>setSource(e.target.value)} className={input}/></label>
    <label className="text-xs">{t.reference}<input required minLength={8} maxLength={180} value={reference} onChange={e=>setReference(e.target.value)} className={input}/></label>
    <button disabled={busy} className="rounded-lg bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.addRate}</button>
   </form>
   <div className="mt-4 grid gap-2 sm:grid-cols-2">{rates.data?.rates.slice(0,16).map(r=><div key={r.id} className="rounded-xl border border-[#e1eded] p-3 text-sm">
     <p><strong>{r.base_currency}/{r.quote_currency}</strong> = {r.rate} · {r.effective_date}</p>
     <p className="mt-1 text-xs text-[#668591]">{r.source} · {r.published?"Published":"Draft"}</p>
     {!r.published&&finance.data?.canApprove&&<button type="button" disabled={busy} onClick={()=>void api("/api/admin/vip/fx-rates/"+encodeURIComponent(r.id)+"/approve","POST",{attestOfficialSource:true})}
      className="mt-2 rounded-lg border border-[#86c9ca] px-3 py-2 text-xs disabled:opacity-50">{t.approve}</button>}
    </div>)}</div>
   <p className="mt-4 flex gap-2 text-xs text-[#6f8992]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.rateNotice}</p>
  </div>
  <div className="rounded-2xl border border-[#d4e8e9] bg-white p-5 md:p-6">
   <h3 className="mb-4 font-semibold">{t.commission}</h3>
   <form onSubmit={createCommission} className="grid gap-3 sm:grid-cols-3">
    <label className="text-xs">{t.unit}<select className={input} value={unitId} onChange={e=>setUnit(e.target.value)}>
     {catalog.data?.units.map(x=><option key={x.id} value={x.id}>{x.unit_number}</option>)}</select></label>
    <label className="text-xs">{t.side}<select className={input} value={side} onChange={e=>setSide(e.target.value)}>
     <option value="income">{t.income}</option><option value="expense">{t.expense}</option></select></label>
    <label className="text-xs">{t.category}<select className={input} value={category} onChange={e=>setCategory(e.target.value)}>
     {["developer","employee","field","manager","referral","bonus","other"].map(x=><option key={x} value={x}>{x}</option>)}</select></label>
    <label className="text-xs">{t.basis}<input className={input} inputMode="decimal" value={basis} onChange={e=>setBasis(e.target.value)} disabled={!!fixed}/></label>
    <label className="text-xs">{t.percentage}<input className={input} inputMode="decimal" value={percent} onChange={e=>setPercent(e.target.value)} disabled={!!fixed}/></label>
    <label className="text-xs">{t.fixed}<input className={input} inputMode="decimal" value={fixed} onChange={e=>setFixed(e.target.value)} disabled={!!basis||!!percent}/></label>
    <label className="text-xs">{t.currency}<input required className={input} maxLength={3} value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label>
    <label className="text-xs">{t.payee}<input required minLength={3} maxLength={100} className={input} value={payee} onChange={e=>setPayee(e.target.value)}/></label>
    <label className="text-xs">{t.contract}<input required minLength={8} maxLength={180} className={input} value={contract} onChange={e=>setContract(e.target.value)}/></label>
    <label className="text-xs sm:col-span-3">{t.note}<textarea className={input} maxLength={500} rows={2} value={note} onChange={e=>setNote(e.target.value)}/></label>
    <button disabled={busy||!unitId} className="rounded-lg bg-[#005476] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{t.add}</button>
   </form>
   {finance.data?.canApprove&&<div className="mt-5 grid gap-2 sm:grid-cols-2">
     <label className="text-xs">{t.reason}<input className={input} minLength={10} maxLength={400} value={reason} onChange={e=>setReason(e.target.value)}/></label>
     <label className="text-xs">{t.settlement}<input className={input} maxLength={180} value={settlement} onChange={e=>setSettlement(e.target.value)}/></label>
    </div>}
   <div className="mt-4 space-y-2">{commissions.data?.commissions.map(x=><div key={x.id} className="rounded-xl border border-[#dce9eb] p-4 text-sm">
      <div className="flex flex-wrap justify-between gap-2">
       <strong>{x.payee_label} · {x.category} · {x.side}</strong>
       <span className="font-semibold">{x.estimated_amount} {x.currency}</span>
      </div>
      <p className="mt-1 text-xs text-[#718c98]">{x.contract_reference} · {x.status}</p>
      {finance.data?.canApprove&&<div className="mt-3 flex gap-2">
       {x.status==="draft"&&<button type="button" disabled={busy||reason.trim().length<10} onClick={()=>void commissionAction(x.id,"approve")}
         className="rounded-lg border border-[#a2d3d6] px-3 py-2 text-xs">{t.review}</button>}
       {x.status==="approved"&&<button type="button" disabled={busy||reason.trim().length<10||settlement.trim().length<8} onClick={()=>void commissionAction(x.id,"record_settlement")}
         className="rounded-lg border border-[#a2d3d6] px-3 py-2 text-xs"><BadgeCheck className="me-1 inline h-4 w-4"/>{t.settle}</button>}
       {["draft","approved"].includes(x.status)&&<button type="button" disabled={busy||reason.trim().length<10} onClick={()=>void commissionAction(x.id,"void")}
         className="rounded-lg border border-rose-200 px-3 py-2 text-xs text-rose-800">{t.void}</button>}
      </div>}
    </div>)}</div>
   <p className="mt-4 flex gap-2 text-xs text-[#6f8992]"><ShieldCheck className="h-4 w-4 shrink-0"/>{t.private}</p>
   {msg&&<p role="status" className="mt-4 text-sm text-[#005476]">{msg}</p>}
  </div>
 </section>;
}
