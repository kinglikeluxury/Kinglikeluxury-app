import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Building2, TrendingUp, KeyRound, Plus, ShieldCheck } from "lucide-react";
import VipInstallmentsAdmin from "./VipInstallmentsAdmin";

type Project = { id: string; name: string; developer_name: string | null; progress_percent: number | null };
type Unit = { id: string; project_id: string; unit_number: string; floor_number: number | null; owner_id: number | null; owner_email: string | null };
type Catalog = { projects: Project[]; units: Unit[] };

const lang: Record<string, Record<string,string>> = {
  ar: {title:"التحكم بالمشاريع والوحدات",create:"إضافة مشروع",name:"اسم المشروع",developer:"اسم المطور",addUnit:"إضافة وحدة",project:"المشروع",unit:"رقم الوحدة",floor:"الطابق (اختياري)",owner:"ربط الوحدة بالعميل",email:"البريد الإلكتروني لحساب موثّق",choose:"اختر الوحدة",progress:"تحديث تقدم البناء",percent:"نسبة الإنجاز",stage:"المرحلة الحالية",note:"ملاحظة التقدم (اختياري)",publish:"نشر التحديث للعميل فورًا",save:"حفظ التغيير",saving:"جارٍ الحفظ...",noProjects:"أضف أول مشروع لبدء إدارة الوحدات",noUnits:"لا توجد وحدات غير مخصصة",success:"تم حفظ التغيير",error:"تعذر حفظ التغيير",verified:"يشترط وجود حساب نشط وبريد موثّق قبل الربط.",history:"كل تعديل يُسجّل باسم الإدارة، ويمكن تصحيح النسبة لاحقًا دون حذف السجل.",total:"الوحدات",latest:"آخر نسبة منشورة"},
  en: {title:"Projects & units control",create:"Add project",name:"Project name",developer:"Developer",addUnit:"Add unit",project:"Project",unit:"Unit number",floor:"Floor (optional)",owner:"Assign a client",email:"Verified account email",choose:"Choose unit",progress:"Construction progress",percent:"Completion percentage",stage:"Current stage",note:"Progress note (optional)",publish:"Publish immediately to client",save:"Save change",saving:"Saving...",noProjects:"Add a project to get started",noUnits:"No unassigned units",success:"Change saved",error:"Could not save",verified:"Assignment requires a verified active user account.",history:"All changes are recorded with the administrator identity.",total:"Units",latest:"Last published"},
  he: {title:"ניהול פרויקטים ויחידות",create:"הוספת פרויקט",name:"שם הפרויקט",developer:"יזם",addUnit:"הוספת יחידה",project:"פרויקט",unit:"מספר יחידה",floor:"קומה (אופציונלי)",owner:"שיוך יחידה ללקוח",email:"דוא״ל מאומת",choose:"בחירת יחידה",progress:"התקדמות הבנייה",percent:"אחוז השלמה",stage:"השלב הנוכחי",note:"הערה (אופציונלי)",publish:"פרסום העדכון ללקוח",save:"שמירת שינוי",saving:"שומר...",noProjects:"הוסף פרויקט ראשון",noUnits:"אין יחידות ללא בעלים",success:"נשמר בהצלחה",error:"לא ניתן לשמור",verified:"נדרש חשבון פעיל עם כתובת דוא״ל מאומתת.",history:"כל שינוי מתועד בשם המנהל.",total:"יחידות",latest:"פורסם לאחרונה"},
  tr: {title:"Proje ve ünite yönetimi",create:"Proje ekle",name:"Proje adı",developer:"Geliştirici",addUnit:"Ünite ekle",project:"Proje",unit:"Ünite numarası",floor:"Kat (isteğe bağlı)",owner:"Müşteriye ata",email:"Doğrulanmış hesap e-postası",choose:"Ünite seç",progress:"İnşaat ilerlemesi",percent:"Tamamlanma yüzdesi",stage:"Mevcut aşama",note:"Not (isteğe bağlı)",publish:"Müşteriye hemen yayımla",save:"Kaydet",saving:"Kaydediliyor...",noProjects:"Önce bir proje ekleyin",noUnits:"Atanmamış ünite yok",success:"Kaydedildi",error:"Kaydedilemedi",verified:"Atama için doğrulanmış aktif hesap gerekir.",history:"Her değişiklik yöneticiyle birlikte kaydedilir.",total:"Üniteler",latest:"Son yayımlanan"},
  az: {title:"Layihə və mənzil idarəetməsi",create:"Layihə əlavə et",name:"Layihənin adı",developer:"Tikinti şirkəti",addUnit:"Mənzil əlavə et",project:"Layihə",unit:"Mənzil nömrəsi",floor:"Mərtəbə (istəyə bağlı)",owner:"Müştəriyə təyin et",email:"Təsdiqlənmiş hesab e-poçtu",choose:"Mənzil seçin",progress:"Tikinti irəliləyişi",percent:"Tamamlanma faizi",stage:"Cari mərhələ",note:"Qeyd (istəyə bağlı)",publish:"Müştəriyə dərhal göstər",save:"Yadda saxla",saving:"Yadda saxlanılır...",noProjects:"Əvvəlcə layihə əlavə edin",noUnits:"Təyin olunmamış mənzil yoxdur",success:"Yadda saxlanıldı",error:"Yadda saxlanılmadı",verified:"Təyinat üçün təsdiqlənmiş aktiv hesab tələb olunur.",history:"Hər dəyişiklik idarəçinin adı ilə qeydə alınır.",total:"Mənzillər",latest:"Son yenilənmə"}
};

const field = "w-full rounded-xl border border-[#c8dcdf] bg-white px-4 py-3 text-[#164b60] outline-none focus:border-[#22bcb6] focus:ring-2 focus:ring-[#22bcb6]/20";
const primary = "rounded-xl bg-[#005476] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#00778a] disabled:cursor-not-allowed disabled:opacity-50";
const card = "rounded-2xl border border-[#d9e9ea] bg-white p-5 shadow-sm md:p-6";

export default function VipProjectsAdmin() {
  const { i18n } = useTranslation();
  const t = lang[i18n.language.split("-")[0]] || lang.en;
  const qc = useQueryClient();
  const catalog = useQuery<Catalog>({
    queryKey:["vip","admin","projects"],
    queryFn: async () => {
      const r = await fetch("/api/admin/vip/projects",{credentials:"include",cache:"no-store"});
      if (!r.ok) throw Error("Catalog unavailable");
      return r.json();
    },
    retry:false,
  });
  const projects = catalog.data?.projects || [];
  const units = catalog.data?.units || [];
  const unassigned = useMemo(() => units.filter(u => !u.owner_id),[units]);
  const [projectName,setProjectName] = useState("");
  const [developerName,setDeveloperName] = useState("");
  const [projectChoice,setProjectChoice] = useState("");
  const [unitNumber,setUnitNumber] = useState("");
  const [floor,setFloor] = useState("");
  const [unitChoice,setUnitChoice] = useState("");
  const [email,setEmail] = useState("");
  const [percent,setPercent] = useState(0);
  const [stage,setStage] = useState("");
  const [note,setNote] = useState("");
  const [publish,setPublish] = useState(true);
  const [busy,setBusy] = useState(false);
  const [feedback,setFeedback] = useState<{type:"ok"|"error";message:string}|null>(null);

  const selectedProject = projectChoice || projects[0]?.id || "";
  const selectedUnit = unitChoice || unassigned[0]?.id || "";
  useEffect(() => {
    if (projectChoice && !projects.some(p=>p.id===projectChoice)) setProjectChoice("");
  },[projectChoice,projects]);
  useEffect(() => {
    if (unitChoice && !unassigned.some(u=>u.id===unitChoice)) setUnitChoice("");
  },[unitChoice,unassigned]);

  async function save(path: string, body: unknown) {
    setBusy(true);
    setFeedback(null);
    try {
      const r = await fetch(path, {
        method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(body),
      });
      if (!r.ok) {
        const response = await r.json().catch(()=>({error:t.error}));
        throw Error(response?.error || t.error);
      }
      const result = await r.json();
      setFeedback({type:"ok",message:t.success});
      await Promise.all([
        qc.invalidateQueries({queryKey:["vip","admin","projects"]}),
        qc.invalidateQueries({queryKey:["vip","admin","overview"]}),
        qc.invalidateQueries({queryKey:["vip","me"]}),
      ]);
      return result;
    } catch(e) {
      setFeedback({type:"error",message:e instanceof Error ? e.message : t.error});
      return null;
    } finally { setBusy(false); }
  }

  async function createProject(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const result = await save("/api/admin/vip/projects",{name:projectName,developerName});
    if(result){ setProjectName("");setDeveloperName("");setProjectChoice(result.project.id); }
  }
  async function createUnit(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(!selectedProject)return;
    const result=await save("/api/admin/vip/projects/"+encodeURIComponent(selectedProject)+"/units",{
      unitNumber,floorNumber:floor.trim() ? Number(floor) : null
    });
    if(result){setUnitNumber("");setFloor("");setUnitChoice(result.unit.id);}
  }
  async function assignOwner(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(!selectedUnit)return;
    const result=await save("/api/admin/vip/units/"+encodeURIComponent(selectedUnit)+"/assign-owner",{email});
    if(result){setEmail("");setUnitChoice("");}
  }
  async function updateProgress(e:FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if(!selectedProject)return;
    const result=await save("/api/admin/vip/projects/"+encodeURIComponent(selectedProject)+"/progress",{
      percent,stage,note,publish
    });
    if(result){setStage("");setNote("");}
  }
  return (
    <section className="mt-9">
      <div className="mb-5 flex items-center gap-3">
        <ShieldCheck className="h-7 w-7 text-[#008c93]"/>
        <h2 className="text-xl font-semibold">{t.title}</h2>
      </div>
      {feedback && <div role="status" className={"mb-4 rounded-xl px-4 py-3 text-sm "+(feedback.type==="ok"?"bg-emerald-50 text-emerald-800":"bg-red-50 text-red-800")}>{feedback.message}</div>}
      {catalog.isError && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-4 text-amber-900">{t.error}</p>}
      <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map(p=>{
          const count=units.filter(u=>u.project_id===p.id).length;
          return <div key={p.id} className="rounded-2xl border border-[#d9e9ea] bg-white p-5">
            <div className="flex items-start justify-between gap-2">
              <div><p className="font-semibold">{p.name}</p><p className="text-xs text-[#76909c]">{p.developer_name || "—"}</p></div>
              <Building2 className="h-6 w-6 shrink-0 text-[#1cb4b1]"/>
            </div>
            <div className="mt-4 flex justify-between text-sm text-[#597a86]"><span>{t.total}: {count}</span><span>{t.latest}: <b className="text-[#005476]">{p.progress_percent==null?"—":p.progress_percent+"%"}</b></span></div>
          </div>;
        })}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <form onSubmit={createProject} className={card}>
          <h3 className="mb-5 flex items-center gap-2 font-semibold"><Plus className="h-5 w-5 text-[#008c93]"/>{t.create}</h3>
          <label className="mb-2 block text-sm">{t.name}</label>
          <input className={field} value={projectName} onChange={e=>setProjectName(e.target.value)} maxLength={140} minLength={2} required />
          <label className="mb-2 mt-4 block text-sm">{t.developer}</label>
          <input className={field} value={developerName} onChange={e=>setDeveloperName(e.target.value)} maxLength={140}/>
          <button className={primary+" mt-5"} disabled={busy||catalog.isError} type="submit">{busy?t.saving:t.save}</button>
        </form>
        <form onSubmit={createUnit} className={card}>
          <h3 className="mb-5 flex items-center gap-2 font-semibold"><Building2 className="h-5 w-5 text-[#008c93]"/>{t.addUnit}</h3>
          <label className="mb-2 block text-sm">{t.project}</label>
          <select className={field} value={selectedProject} onChange={e=>setProjectChoice(e.target.value)} disabled={!projects.length}>
            {projects.length===0?<option value="">{t.noProjects}</option>:projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div><label className="mb-2 block text-sm">{t.unit}</label><input className={field} value={unitNumber} onChange={e=>setUnitNumber(e.target.value)} maxLength={40} required/></div>
            <div><label className="mb-2 block text-sm">{t.floor}</label><input className={field} type="number" min={-5} max={250} step={1} value={floor} onChange={e=>setFloor(e.target.value)} /></div>
          </div>
          <button className={primary+" mt-5"} disabled={busy||!selectedProject} type="submit">{busy?t.saving:t.save}</button>
        </form>
        <form onSubmit={assignOwner} className={card}>
          <h3 className="mb-5 flex items-center gap-2 font-semibold"><KeyRound className="h-5 w-5 text-[#008c93]"/>{t.owner}</h3>
          <label className="mb-2 block text-sm">{t.choose}</label>
          <select className={field} value={selectedUnit} onChange={e=>setUnitChoice(e.target.value)} disabled={!unassigned.length}>
            {!unassigned.length?<option value="">{t.noUnits}</option>:unassigned.map(u=><option key={u.id} value={u.id}>{projects.find(p=>p.id===u.project_id)?.name} · {u.unit_number}</option>)}
          </select>
          <label className="mb-2 mt-4 block text-sm">{t.email}</label>
          <input className={field} type="email" value={email} onChange={e=>setEmail(e.target.value)} required maxLength={254} />
          <p className="mt-2 text-xs text-[#78929b]">{t.verified}</p>
          <button className={primary+" mt-5"} disabled={busy||!selectedUnit} type="submit">{busy?t.saving:t.save}</button>
        </form>
        <form onSubmit={updateProgress} className={card}>
          <h3 className="mb-5 flex items-center gap-2 font-semibold"><TrendingUp className="h-5 w-5 text-[#008c93]"/>{t.progress}</h3>
          <label className="mb-2 block text-sm">{t.project}</label>
          <select className={field} value={selectedProject} onChange={e=>setProjectChoice(e.target.value)} disabled={!projects.length}>
            {projects.length===0?<option value="">{t.noProjects}</option>:projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="mt-4 flex items-end justify-between"><label className="text-sm">{t.percent}</label><strong className="text-2xl text-[#005476]">{percent}%</strong></div>
          <input aria-label={t.percent} type="range" min={0} max={100} step={1} className="mt-3 w-full accent-[#008c93]" value={percent} onChange={e=>setPercent(Number(e.target.value))}/>
          <label className="mb-2 mt-4 block text-sm">{t.stage}</label>
          <input className={field} value={stage} onChange={e=>setStage(e.target.value)} minLength={2} maxLength={100} required/>
          <label className="mb-2 mt-4 block text-sm">{t.note}</label>
          <textarea className={field} value={note} onChange={e=>setNote(e.target.value)} rows={2} maxLength={1000}/>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={publish} onChange={e=>setPublish(e.target.checked)} /> {t.publish}</label>
          <p className="mt-2 text-xs text-[#78929b]">{t.history}</p>
          <button className={primary+" mt-5"} disabled={busy||!selectedProject} type="submit">{busy?t.saving:t.save}</button>
        </form>
      </div>
      <VipInstallmentsAdmin units={units} projects={projects} />
    </section>
  );
}
