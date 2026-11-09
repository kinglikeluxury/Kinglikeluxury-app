import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Activity, ArrowUpRight, CheckCircle2, Database, ExternalLink, LockKeyhole, MessageCircle, RefreshCcw, ShieldCheck } from "lucide-react";

export type WhatsappOperationsStatus = {
  environment: "isolated_staging";
  checkedAt: string;
  proofDatabase: "verified" | "unavailable";
  proofRows: { flows: number; proofs: number } | null;
  testWebhook: "configured" | "not_configured";
  realEnrollment: "disabled" | "awaiting_separate_review";
  employeeMonitoring: "disabled";
  employeeNumbersConnected: "not_verified";
  previousSyntheticResults: "see_ci_logs";
  nextStep: "meta_eligibility_and_privacy_review";
};

type ArchiveReadiness = {
  environment: "isolated_staging";
  checkedAt: string;
  status: "disabled" | "blocked" | "configured_not_verified" | "verified_no_live_numbers";
  blockers: string[];
  checks: Record<
    "isolatedApp" | "runtimeFlag" | "employeeNotice" | "customerNotice" |
    "retentionPolicy" | "metaVerification" | "historyImport" | "privateMedia" |
    "archiveDbIdentity" | "separateAuditRole" | "independentCryptoKeys" |
    "databaseGrants", boolean
  >;
  databaseProbe: "not_run" | "passed" | "failed";
  liveConnection: "not_connected";
  liveNumbers: "not_verified";
  webhookActive: false;
};

const ARCHIVE_CHECKS: { key: keyof ArchiveReadiness["checks"]; title: string }[] = [
  { key:"isolatedApp",title:"عزل تطبيق Staging عن الإنتاج" },
  { key:"archiveDbIdentity",title:"قاعدة أرشيف مستقلة عن Neon والتطبيق" },
  { key:"separateAuditRole",title:"حساب منفصل لسجل الاطلاع" },
  { key:"independentCryptoKeys",title:"مفتاحا تشفير مستقلان" },
  { key:"databaseGrants",title:"صلاحيات وقاعدة أرشيف مدققة" },
  { key:"employeeNotice",title:"إشعار الموظف وموافقته" },
  { key:"customerNotice",title:"إشعار العملاء والأساس القانوني" },
  { key:"retentionPolicy",title:"سياسة الاحتفاظ وحذف البيانات" },
  { key:"metaVerification",title:"التحقق من Meta وأهلية الرقم" },
  { key:"historyImport",title:"جاهزية استيراد المحادثات السابقة" },
  { key:"privateMedia",title:"تخزين خاص وآمن للملفات" },
  { key:"runtimeFlag",title:"إذن تشغيل نسخة Staging" },
];

const REPO = "https://github.com/kinglikeluxury/Kinglikeluxury-app";
const RAILWAY = "https://railway.com/project/8386a5b5-4964-4b37-b2fa-e7177d78111e";

function StatusIndicator({ good, label }: { good: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${good ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>
      {good ? <CheckCircle2 className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}
      {label}
    </span>
  );
}

function SafeCard({ title, value, detail, good }: { title: string; value: string; detail: string; good: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-slate-500">{title}</p>
      <StatusIndicator good={good} label={value} />
      <p className="mt-3 text-sm leading-6 text-slate-600">{detail}</p>
    </div>
  );
}

export default function WhatsappEmployeeOperationsPage() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<WhatsappOperationsStatus | null>(null);
  const [archiveReadiness, setArchiveReadiness] = useState<ArchiveReadiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user?.isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/staging/whatsapp-operations-status", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw Error(response.status === 404
        ? "لوحة الحالة الفعلية متاحة فقط في نسخة Staging التجريبية."
        : "تعذر التحقق من حالة واتساب الآن.");
      const next = await response.json() as WhatsappOperationsStatus;
      if (next.environment !== "isolated_staging" ||
          next.employeeNumbersConnected !== "not_verified" ||
          next.employeeMonitoring !== "disabled" ||
          (next.proofDatabase !== "verified" && next.proofDatabase !== "unavailable")) {
        throw Error("استجابة حالة واتساب غير متوقعة؛ لن نعرض بيانات غير مؤكدة.");
      }
      setStatus(next);
      // Separate read-only diagnostic; no number registration or DB mutation.
      try {
        const readinessResponse = await fetch("/api/admin/staging/whatsapp-archive-readiness",{
          credentials:"same-origin", cache:"no-store",
          headers:{Accept:"application/json"},
        });
        if (!readinessResponse.ok) throw new Error("readiness unavailable");
        const readiness = await readinessResponse.json() as ArchiveReadiness;
        if (readiness.environment !== "isolated_staging" ||
            readiness.liveConnection !== "not_connected" ||
            readiness.webhookActive !== false ||
            readiness.liveNumbers !== "not_verified" ||
            !readiness.checks || !Array.isArray(readiness.blockers)) {
          throw new Error("invalid readiness");
        }
        setArchiveReadiness(readiness);
      } catch {
        // Never imply readiness when separate diagnostic is absent.
        setArchiveReadiness(null);
      }
    } catch (cause) {
      setStatus(null);
      setArchiveReadiness(null);
      setError(cause instanceof Error ? cause.message : "تعذر قراءة الحالة.");
    } finally {
      setLoading(false);
    }
  }, [user?.isAdmin]);

  useEffect(() => {
    if (isLoading) return;
    if (!user) navigate("/login?redirect=/admin/whatsapp-employee-operations");
    else if (!user.isAdmin) navigate("/");
  }, [isLoading, user, navigate]);

  useEffect(() => {
    if (isLoading || !user?.isAdmin) return;
    void reload();
  }, [isLoading, user?.isAdmin, reload]);

  if (isLoading || !user?.isAdmin) return null;

  const counts = status?.proofRows;
  return (
    <main dir="rtl" className="min-h-[75vh] bg-[#f4f8fa] px-4 py-8 text-slate-900 sm:px-6">
      <div className="mx-auto max-w-6xl space-y-7">
        <header className="rounded-3xl bg-[#005476] p-6 text-white sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-white/10 p-3"><MessageCircle className="h-7 w-7 text-[#3BCAC4]" /></span>
              <div>
                <p className="text-xs font-semibold tracking-wide text-[#a5edeb]">KINGLIKE LUXURY · STAGING</p>
                <h1 className="mt-1 text-2xl font-bold sm:text-3xl">إدارة واتساب الموظفين</h1>
                <p className="mt-2 max-w-2xl text-sm leading-7 text-blue-100">
                  لوحة إدارية للمتابعة التقنية فقط. لا تعرض محادثات حقيقية، ولا تفعّل أي رقم أو تسحب سجلات واتساب السابقة.
                </p>
              </div>
            </div>
            <button type="button" onClick={() => void reload()} disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl bg-[#3BCAC4] px-4 py-2.5 text-sm font-bold text-[#00465f] hover:bg-[#59d7d1] disabled:cursor-not-allowed disabled:opacity-60">
              <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              تحديث الحالة
            </button>
          </div>
        </header>

        <section aria-live="polite">
          {loading && <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">جارٍ التحقق من الخادم وقاعدة البيانات...</p>}
          {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="alert">{error} لا يمكن اعتبار الربط جاهزاً دون فحص ناجح.</div>}
          {status && !loading && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Activity className="h-4 w-4" />
              آخر تحقق مباشر من الخادم: {new Date(status.checkedAt).toLocaleString("ar", { dateStyle: "medium", timeStyle: "short" })}
            </p>
          )}
        </section>

        <section aria-labelledby="ops-health">
          <h2 id="ops-health" className="mb-3 text-lg font-bold text-[#005476]">حالة النظام الفعلية</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SafeCard title="قاعدة واتساب المستقلة"
              good={status?.proofDatabase === "verified"}
              value={status?.proofDatabase === "verified" ? "تم التحقق" : "غير مؤكدة"}
              detail={counts ? `طلبات التسجيل المسجلة: ${counts.flows}، وإثباتات الربط: ${counts.proofs}. لا تعني إثباتات الربط تفعيل رقم.` : "لم يتمكن الخادم من التحقق من الأعداد."} />
            <SafeCard title="Webhook التجريبي"
              good={status?.testWebhook === "configured"}
              value={status?.testWebhook === "configured" ? "مهيأ للاختبار" : "غير مؤكد"}
              detail="وضع Meta TEST فقط. لا يثبت استقبال محادثات أي موظف حقيقي." />
            <SafeCard title="تسجيل الأرقام الحقيقية"
              good={false}
              value={status?.realEnrollment === "disabled" ? "معطّل" : "بانتظار مراجعة مستقلة"}
              detail="زر الربط غير مفعّل. يلزم التحقق من Meta والموافقات قبل تشغيله." />
            <SafeCard title="مراقبة المحادثات الفعلية"
              good={false} value="غير مفعّلة"
              detail="لا توجد صلاحية لقراءة محادثات سامر أو غيره عبر هذه الصفحة." />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6" aria-label="جاهزية أرشيف واتساب الحقيقي">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#005476]">الجاهزية الفعلية لأرشيف محادثات الموظفين</h2>
              <p className="mt-1 text-sm text-slate-500">فحص آمن لا يشغّل Webhook ولا يتصل بأرقام الموظفين ولا يغيّر قواعد البيانات.</p>
            </div>
            <StatusIndicator good={archiveReadiness?.status === "verified_no_live_numbers"}
              label={archiveReadiness?.status === "verified_no_live_numbers"
                ? "قاعدة الأرشيف جاهزة تقنياً — الأرقام غير متصلة"
                : "مقفل — لا توجد مزامنة حقيقية"} />
          </div>
          {!archiveReadiness && <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">فحص الأرشيف غير متاح أو لم يكتمل. لا يمكن اعتبار التسجيل أو المزامنة جاهزين.</p>}
          {archiveReadiness && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {ARCHIVE_CHECKS.map(item => (
                  <div key={item.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-3">
                    <span className="text-sm text-slate-700">{item.title}</span>
                    <StatusIndicator good={archiveReadiness.checks[item.key]}
                      label={archiveReadiness.checks[item.key] ? "مؤشر مهيأ" : "غير مكتمل"} />
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs leading-6 text-slate-500">
                صلاحيات قاعدة الأرشيف: {archiveReadiness.databaseProbe === "passed"
                  ? "نجح الفحص القرائي للحسابين المنفصلين"
                  : archiveReadiness.databaseProbe === "failed" ? "فشل الفحص، والتشغيل ممنوع"
                  : "لم يُنفّذ الفحص لأن إعدادات الحماية أو الموافقات غير مكتملة"}.
                مؤشرات الموافقة أعلاه تعتمد على الإعدادات، ولا تثبت موافقة فعلية من الموظف أو Meta بذاتها.
              </p>
            </>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-[#005476]" /><h2 className="text-lg font-bold text-[#005476]">خطة ربط الموظفين</h2></div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { name: "سامر", role: "الرقم الأول المخطط لتجربته" },
              { name: "فادي", role: "لاحقاً بعد نجاح التجربة" },
              { name: "جوانا", role: "لاحقاً بعد نجاح التجربة" },
            ].map(person => (
              <div key={person.name} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-bold text-slate-800">{person.name}</p>
                <p className="mb-3 mt-1 text-sm text-slate-500">{person.role}</p>
                <StatusIndicator good={false} label="لم يُعتمد ربط فعلي" />
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs leading-6 text-slate-500">
            الأسماء أعلاه ترتيب مقترح للتجربة، وليست سجلات حية من Meta أو CRM. لا نعتمد أي موظف كـ«متصل» بناءً على اختبار اصطناعي.
          </p>
          <button type="button" disabled title="لا يفتح حتى اكتمال مراجعة Meta والموافقات"
            className="mt-5 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-500 sm:w-auto">
            <LockKeyhole className="ms-2 inline h-4 w-4" /> ربط موظف — غير متاح حالياً
          </button>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-center gap-2"><Database className="h-5 w-5 text-[#005476]" /><h2 className="text-lg font-bold text-[#005476]">ما أُنجز وما تبقى</h2></div>
          <ol className="space-y-3 text-sm leading-7">
            <li><b className="text-[#005476]">1. منجز تجريبياً:</b> اختبارات الأرشفة المشفّرة وإشعارات الحذف والصلاحيات؛ تحقق من جاهزية قاعدة التشغيل المستقلة أعلاه.</li>
            <li><b className="text-[#005476]">2. منجز في اختبارات GitHub:</b> محاكاة بدء التسجيل، منع التكرار، التحقق من الرقم، والتراجع عن البيانات.</li>
            <li><b className="text-[#005476]">3. منجز تجريبياً:</b> اختبار استقبال حدث Webhook موقّع دون الاحتفاظ بالمحتوى.</li>
            <li><b className="text-amber-800">4. قيد المراجعة:</b> أهلية تطبيق Meta، وموافقات الموظف والعملاء، وسياسة الاحتفاظ بالسجلات وإلغائها.</li>
            <li><b className="text-amber-800">5. لم يبدأ:</b> توصيل رقم سامر واستقبال محادثات العمل المصرّح بها فعلياً.</li>
          </ol>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-bold text-[#005476]">ملفات العمل والاختبارات</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              { label: "نسخة Staging المجمّعة — PR #34", href: REPO + "/pull/34" },
              { label: "تسجيل تجريبي — PR #23", href: REPO + "/pull/23" },
              { label: "قاعدة واتساب — PR #22", href: REPO + "/pull/22" },
              { label: "نتائج اختبارات GitHub", href: REPO + "/actions" },
              { label: "مشروع Railway Staging", href: RAILWAY },
            ].map(link => (
              <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm font-semibold text-[#005476] hover:border-[#3BCAC4] hover:bg-[#f2fbfa]">
                <span>{link.label}</span><ExternalLink className="h-4 w-4 shrink-0" />
              </a>
            ))}
            <Link href="/admin/whatsapp-monitoring"
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm font-semibold text-[#005476] hover:border-[#3BCAC4] hover:bg-[#f2fbfa]">
              <span>معاينة المحادثات (بيانات وهمية فقط)</span><ArrowUpRight className="h-4 w-4 shrink-0" />
            </Link>
          </div>
        </section>
        <p className="pb-4 text-center text-xs leading-6 text-slate-500">
          لا تتصل هذه الصفحة بـ Meta أو هواتف الموظفين، ولا تُجري تغييرات في CRM أو الإنتاج.
        </p>
      </div>
    </main>
  );
}
