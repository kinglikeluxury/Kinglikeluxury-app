import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock3, Image, RefreshCw, Save, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const markets = [
  ["georgia", "جورجيا", "🇬🇪"], ["turkey", "تركيا", "🇹🇷"],
  ["syria", "سوريا", "🇸🇾"], ["azerbaijan", "أذربيجان — باكو فقط", "🇦🇿"],
  ["northern-cyprus", "شمال قبرص", "🇨🇾"],
];
const labels: Record<string, string> = {
  waiting: "منتظر", needs_verification: "يحتاج تحقق",
  ready_for_review: "جاهز للمراجعة", rejected: "مرفوض",
  published: "منشور", failed: "فشل",
};
type Draft = {
  id: number; business_date: string; country: string; status: string; title: string;
  content: string; keywords: string[]; seo_description: string; slug: string;
  cover_image: string; sources: {
    url: string; title: string; accessedAt: string; kind?: string;
    license?: string; attribution?: string | null; outputSha256?: string;
  }[];
  review_note?: string; safe_error_code?: string;
};
type State = {
  configured: boolean; message?: string;
  readiness: {
    reason: string; generationEnabled: boolean; schedulerEnabled: boolean; researchReady: boolean;
    textReady: boolean; imageReady: boolean; textProvider?: string; textModel?: string | null;
    textKeyPresent?: boolean; textConfigurationBlockers?: string[];
  };
  schedule: { enabled: boolean; time_georgia: string };
  drafts: Draft[];
};

async function call(path: string, method = "GET", body?: unknown) {
  const response = await fetch(path, {
    method, credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "تعذر تنفيذ الطلب");
  return data;
}

export function AiBlogDraftsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<State>({
    queryKey: ["/api/admin/ai-blog/status"],
    queryFn: async () => {
      const response = await fetch("/api/admin/ai-blog/status", { credentials: "include" });
      return response.json();
    },
    refetchInterval: 30000,
  });
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [enabled, setEnabled] = useState(false);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [sourcesJson, setSourcesJson] = useState("");
  const [coverSourceUrl, setCoverSourceUrl] = useState("");
  const [coverLicense, setCoverLicense] = useState("");
  const [coverAttribution, setCoverAttribution] = useState("");
  const [coverOutputSha256, setCoverOutputSha256] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (data?.schedule) {
      setScheduleTime(data.schedule.time_georgia || "09:00");
      setEnabled(data.schedule.enabled);
    }
  }, [data?.schedule?.enabled, data?.schedule?.time_georgia]);

  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true); setNotice("");
    try { await fn(); setNotice(success); await qc.invalidateQueries({ queryKey: ["/api/admin/ai-blog/status"] }); }
    catch (error) { setNotice(error instanceof Error ? error.message : "تعذر تنفيذ الطلب"); }
    finally { setBusy(false); }
  }
  const drafts = data?.drafts || [];

  return <section dir="rtl" className="my-8 space-y-4">
    <Card className="overflow-hidden border-[#3bcac4]/50 shadow-sm">
      <CardHeader className="bg-gradient-to-l from-[#005476] to-[#087f91] text-white">
        <CardTitle className="flex items-center gap-2 text-xl"><Sparkles className="h-5 w-5" />مسودات الذكاء الاصطناعي</CardTitle>
        <p className="text-sm text-white/85">مراجعة خاصة بالمدير فقط. لا تُعرض المسودات للزوار ولا لخريطة الموقع.</p>
      </CardHeader>
      <CardContent className="space-y-5 p-4 md:p-6">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex gap-2 font-semibold"><AlertTriangle className="h-5 w-5 shrink-0" />{data?.readiness?.reason || "التوليد والجدولة معطلان افتراضياً."}</div>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <span>البحث: معطل، لا يوجد موصل مجاني معتمد</span>
            <span>موصل النص: {data?.readiness?.textProvider || "Gemini"}</span>
            <span>مفتاح Gemini: {data?.readiness?.textKeyPresent ? "موجود فقط" : "غير مضبوط"}</span>
            <span>النموذج: {data?.readiness?.textModel || "غير محدد"}</span>
            <span>مفتاح الصور/Cloudinary: {data?.readiness?.imageReady ? "موجود فقط" : "غير مضبوط"}</span>
            <span>التنفيذ: {data?.readiness?.schedulerEnabled ? "متاح" : "غير موصول"}</span>
          </div>
          <p className="mt-2">وجود مفتاح لا يعني أن التكامل جاهز أو نشط. يجب إثبات أهلية النموذج والحصة المجانية وتعطيل الفوترة من حساب Google؛ التطبيق لا يستطيع التحقق من ذلك تلقائياً. لا يوجد بحث مؤسس على Google Search ولا تحويل إلى OpenAI أو Tavily أو SerpAPI.</p>
          {!!data?.readiness?.textConfigurationBlockers?.length && (
            <ul className="mt-2 list-inside list-disc text-xs">
              {data.readiness.textConfigurationBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          )}
          <div className="mt-3 rounded border border-amber-400/60 bg-white/70 p-3">
            <strong>إعداد غلاف محلي بلا رفع</strong>
            <p className="mt-1">يمكن تجهيز نسخة مشتقة من صورة تملكها Kinglike أو تملك ترخيص استخدامها عبر ImageMagick في مساحة العمل، مع الاحتفاظ بكامل الإطار حتى لا تُقص أي علامة أصلية. لا يضيف المسار علامة مائية ولا يزيل علامة موجودة، ولا يتصل بـCloudinary أو أي خدمة. سعة Cloudinary لم تُثبت، لذلك الرفع غير متاح ولا تُحفظ الصورة في التخزين الحي.</p>
            <code dir="ltr" className="mt-2 block break-all rounded bg-slate-100 p-2 text-xs">npm run ai-blog:cover -- &lt;input-image&gt; generated-artifacts/ai-blog-covers/&lt;name&gt;.jpg --source-url &lt;https-url&gt; --license "Kinglike-owned"</code>
            <p className="mt-1 text-xs">الناتج المحلي 1200×630 وأقل من 10MB مع ملف provenance جانبي. لن يصبح رابطاً عاماً ولن يُرفع تلقائياً؛ لا تستخدم مساراً محلياً كرابط غلاف منشور. Pexels API يتطلب إسناداً في سجل المصدر عند استخدامه.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {markets.map(([key, name, flag]) => {
            const row = drafts.find(d => d.country === key);
            return <div key={key} className="rounded-lg border bg-white p-3">
              <div className="font-semibold text-[#005476]">{flag} {name}</div>
              <div className="mt-2 text-sm">{row ? labels[row.status] || row.status : "لا توجد مسودة محفوظة"}</div>
              <div className="mt-1 text-xs text-gray-500">{row?.business_date || "—"}</div>
            </div>;
          })}
        </div>
        <div className="flex flex-col gap-3 rounded-lg bg-slate-50 p-4 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-3">
            <Clock3 className="h-5 w-5 text-[#005476]" />
            <label className="text-sm font-medium">موعد الصباح — توقيت جورجيا</label>
            <Input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} className="w-32 bg-white" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled} disabled={!data?.readiness?.schedulerEnabled} onChange={e => setEnabled(e.target.checked)} />
            تشغيل الجدولة
          </label>
          <Button variant="outline" disabled={busy || !data?.configured} onClick={() => action(
            () => call("/api/admin/ai-blog/schedule", "PUT", { enabled, timeGeorgia: scheduleTime }),
            "تم حفظ إعداد الجدولة (لن تعمل ما دامت مفاتيح التشغيل مغلقة).",
          )}>حفظ الموعد</Button>
          <Button disabled title="التوليد معطل افتراضياً" onClick={() => action(() => call("/api/admin/ai-blog/run-now", "POST", {}), "")}>
            <Sparkles className="ml-2 h-4 w-4" />إنشاء مسودات اليوم الآن
          </Button>
        </div>
        {!data?.configured && <div className="text-sm text-gray-600">{data?.message || "يظهر هنا سبب التعطيل ومتطلبات الترحيل."}</div>}
        {notice && <div role="status" className="rounded bg-slate-100 p-3 text-sm">{notice}</div>}
      </CardContent>
    </Card>

    {isLoading && <p className="text-sm text-gray-500">جارٍ تحميل حالة المسودات…</p>}
    {drafts.map(draft => <Card key={draft.id} className="border-slate-200">
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><span className="font-semibold text-[#005476]">{markets.find(m => m[0] === draft.country)?.[1] || draft.country}</span>
            <span className="mr-3 rounded-full bg-slate-100 px-3 py-1 text-xs">{labels[draft.status] || draft.status}</span>
            <span className="mr-2 text-xs text-gray-500">{draft.business_date}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => {
              if (editing?.id === draft.id) setEditing(null);
              else {
                setEditing({ ...draft });
                const storedSources = draft.sources || [];
                const coverSource = storedSources.find(source => source.kind === "cover_image");
                setSourcesJson(JSON.stringify(storedSources.filter(source => source.kind !== "cover_image"), null, 2));
                setCoverSourceUrl(coverSource?.url || "");
                setCoverLicense(coverSource?.license || "");
                setCoverAttribution(coverSource?.attribution || "");
                setCoverOutputSha256(coverSource?.outputSha256 || "");
              }
            }}>مراجعة وتعديل</Button>
            <Button size="sm" variant="outline" disabled title="إعادة المحاولة معطلة إلى حين اعتماد الخدمات"><RefreshCw className="ml-1 h-4 w-4" />إعادة محاولة</Button>
            {draft.status === "ready_for_review" && <Button size="sm" disabled={busy} onClick={() => {
              if (window.confirm("سيُنشر هذا المقال علناً الآن. هل راجعت المعلومات والمصادر؟")) {
                void action(() => call(`/api/admin/ai-blog/drafts/${draft.id}/publish`, "POST", {}), "تم النشر يدوياً.");
              }
            }}><Send className="ml-1 h-4 w-4" />نشر يدوي</Button>}
          </div>
        </div>
        {draft.safe_error_code && <p className="text-sm text-amber-800">سبب آمن: {draft.safe_error_code}</p>}
        {editing?.id === draft.id && <div className="grid gap-3">
          <Input aria-label="العنوان" placeholder="العنوان" value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })} />
          <Textarea aria-label="المحتوى" placeholder="المحتوى العربي" rows={10} value={editing.content} onChange={e => setEditing({ ...editing, content: e.target.value })} />
          <Input aria-label="الكلمات المفتاحية" placeholder="الكلمات المفتاحية، مفصولة بفواصل" value={(editing.keywords || []).join(", ")} onChange={e => setEditing({ ...editing, keywords: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} />
          <Textarea aria-label="وصف SEO" placeholder="وصف SEO" value={editing.seo_description} onChange={e => setEditing({ ...editing, seo_description: e.target.value })} />
          <Input aria-label="الرابط" placeholder="SEO slug" value={editing.slug} onChange={e => setEditing({ ...editing, slug: e.target.value })} />
          <div className="flex items-center gap-2"><Image className="h-4 w-4" /><Input aria-label="رابط صورة الغلاف" placeholder="رابط صورة الغلاف (الرفع يدوياً من أدوات المقالات الحالية)" value={editing.cover_image} onChange={e => setEditing({ ...editing, cover_image: e.target.value })} /></div>
           <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
             <strong className="text-sm">إثبات مصدر الغلاف وترخيصه</strong>
             <Input aria-label="رابط مصدر صورة الغلاف" placeholder="رابط الصورة الأصلية HTTPS" value={coverSourceUrl} onChange={e => setCoverSourceUrl(e.target.value)} />
             <Input aria-label="ترخيص صورة الغلاف" placeholder="مثال: Kinglike-owned أو Pexels License" value={coverLicense} onChange={e => setCoverLicense(e.target.value)} />
             <Input aria-label="إسناد صورة الغلاف" placeholder="اسم المصور ورابطه عند اشتراط الإسناد" value={coverAttribution} onChange={e => setCoverAttribution(e.target.value)} />
             <Input aria-label="بصمة ملف الغلاف" placeholder="SHA-256 من ملف provenance (اختياري)" value={coverOutputSha256} onChange={e => setCoverOutputSha256(e.target.value)} />
             <p className="text-xs text-slate-600">هذه البيانات تحفظ مع مصادر المسودة. لا تحفظ المسار المحلي للصورة كرابط، ولا ترفع الملف إلى Cloudinary أو التخزين الحي من هذه اللوحة.</p>
           </div>
          <Textarea aria-label="ملاحظة المراجعة" placeholder="ملاحظات المراجعة" value={editing.review_note || ""} onChange={e => setEditing({ ...editing, review_note: e.target.value })} />
          <Textarea aria-label="المصادر" placeholder='مصادر بصيغة JSON: [{"title":"...","url":"https://...","accessedAt":"YYYY-MM-DD"}]' rows={5} value={sourcesJson} onChange={e => setSourcesJson(e.target.value)} />
          <label className="text-sm">حالة المراجعة
            <select className="mr-2 rounded border p-2" value={editing.status} onChange={e => setEditing({ ...editing, status: e.target.value })}>
              <option value="needs_verification">يحتاج تحقق</option><option value="ready_for_review">جاهز للمراجعة</option><option value="rejected">مرفوض</option>
            </select>
          </label>
          <Button disabled={busy} onClick={() => action(async () => {
            let parsedSources: Draft["sources"];
            try {
              const parsed = JSON.parse(sourcesJson || "[]");
              if (!Array.isArray(parsed)) throw new Error();
              parsedSources = parsed;
            } catch {
              throw new Error("صيغة المصادر غير صحيحة؛ أدخل قائمة JSON صالحة.");
            }
             const hasCoverMetadata = Boolean(coverSourceUrl.trim() || coverLicense.trim() || coverAttribution.trim() || coverOutputSha256.trim());
             if (hasCoverMetadata) {
               let sourceUrl: URL;
               try { sourceUrl = new URL(coverSourceUrl.trim()); }
               catch { throw new Error("أدخل رابط HTTPS صالحاً لمصدر صورة الغلاف."); }
               if (sourceUrl.protocol !== "https:" || !coverLicense.trim()) {
                 throw new Error("يلزم رابط HTTPS وترخيص أو إثبات ملكية للغلاف.");
               }
               if (/pexels/i.test(coverLicense) && !coverAttribution.trim()) {
                 throw new Error("أضف إسناد المصور وPexels عند استخدام صور عبر Pexels API.");
               }
               parsedSources.push({
                 kind: "cover_image",
                 title: "مصدر صورة الغلاف",
                 url: sourceUrl.toString(),
                 accessedAt: new Date().toISOString(),
                 license: coverLicense.trim(),
                 attribution: coverAttribution.trim() || null,
                 outputSha256: coverOutputSha256.trim() || undefined,
               });
             }
            await call(`/api/admin/ai-blog/drafts/${draft.id}`, "PUT", {
              ...editing, seoDescription: editing.seo_description, coverImage: editing.cover_image,
              sources: parsedSources,
            });
            setEditing(null);
          }, "تم حفظ التعديلات.")}><Save className="ml-2 h-4 w-4" />حفظ المراجعة</Button>
          <div className="space-y-1 text-sm">
            <strong>المصادر وتاريخ الاطلاع</strong>
            {(editing.sources || []).length ? editing.sources.map((s, i) => <a key={i} className="block break-all text-blue-700 underline" href={s.url} target="_blank" rel="noreferrer">{s.title} — {s.accessedAt}</a>) : <p className="text-gray-500">لا توجد مصادر محفوظة.</p>}
          </div>
        </div>}
      </CardContent>
    </Card>)}
    {!isLoading && !drafts.length && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-gray-500">لا توجد مسودات محفوظة بعد. لن تُنشأ مسودات تجريبية أو معروضة على أنها مولدة بالذكاء الاصطناعي.</div>}
  </section>;
}
