import { useCallback, useEffect, useState } from "react";
import { Archive, CheckCircle2, Clock, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";

type Conversation = {
  id: number;
  contact_wa_id: string;
  phone_number_id: string;
  updated_at: string;
  last_message_preview: string | null;
};
type ArchivedMessage = {
  id: number;
  event_kind: "message" | "revoke" | "edit" | "status";
  direction: "inbound" | "outbound" | "status";
  event_status: string | null;
  message_type: string | null;
  message_text: string | null;
  related_message_id: string | null;
  occurred_at: string | null;
  received_at: string;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  deletion_status: "meta_revoke_reported" | "not_reported";
  deletion_observed_at: string | null;
};

async function requestArchive<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 404) throw new Error("unavailable");
  if (response.status === 401 || response.status === 403) throw new Error("forbidden");
  if (!response.ok) throw new Error("temporary");
  return await response.json() as T;
}
function localTime(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("ar", { dateStyle: "short", timeStyle: "short" });
}
function explainError(error: string | null): string {
  switch (error) {
    case "unavailable":
      return "الأرشيف الحقيقي غير مُفعّل. الواجهة التجريبية لا تعني اتصال أرقام الموظفين.";
    case "forbidden":
      return "لا توجد صلاحية حالية لعرض الأرشيف. يتطلب الاطلاع موافقة الموظف وصلاحية فعالة مسجلة.";
    case "temporary":
      return "تعذّر تحديث الأرشيف. لم يتم عرض بيانات غير مؤكدة.";
    default:
      return "";
  }
}
function Message({ event }: { event: ArchivedMessage }) {
  const sent = event.direction === "outbound";
  const deleted = event.event_kind === "message" &&
    event.deletion_status === "meta_revoke_reported";
  const isEvent = event.event_kind !== "message";
  return (
    <div className={sent ? "flex justify-end" : "flex justify-start"}>
      <div className={"max-w-[90%] rounded-xl border px-3 py-2 text-sm shadow-sm sm:max-w-[76%] " +
        (isEvent ? "border-slate-200 bg-slate-100 text-slate-600" :
          sent ? "border-emerald-200 bg-[#e4f7e6] text-slate-900" :
          "border-slate-200 bg-white text-slate-900")}>
        {isEvent && (
          <p className="mb-1 text-xs font-semibold">
            {event.event_kind === "revoke" ? "إشعار حذف مؤكد من Meta" :
              event.event_kind === "edit" ? "تعديل موثق (السجل الأصلي محفوظ)" :
              "تحديث حالة الرسالة"}
          </p>
        )}
        {event.message_text && (
          <p className="whitespace-pre-wrap break-words" dir="auto">{event.message_text}</p>
        )}
        {event.event_kind === "message" && !event.message_text && (
          <p className="text-xs text-slate-600">
            {event.message_type === "audio" ? "رسالة صوتية محفوظة بياناتها الوصفية" :
              event.message_type === "image" ? "صورة — الملف محفوظ منفصلاً عند تفعيل التخزين" :
              event.message_type === "video" ? "فيديو — الملف محفوظ منفصلاً عند تفعيل التخزين" :
              event.message_type === "sticker" ? "ملصق" :
              event.message_type === "document" ? "مستند" : "رسالة بدون نص"}
          </p>
        )}
        {event.media_mime_type && (
          <div className="mt-1 text-[11px] text-slate-500">
            {event.media_mime_type}
            {event.media_size_bytes != null ? " • " + event.media_size_bytes + " بايت" : ""}
          </div>
        )}
        {deleted && (
          <div role="note" className="mt-2 flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-900">
            <Archive className="h-3.5 w-3.5 shrink-0" />
            تم تأكيد حذفها من Meta — النسخة الأصلية محفوظة
            {event.deletion_observed_at ? " • " + localTime(event.deletion_observed_at) : ""}
          </div>
        )}
        {event.event_status && <p className="mt-1 text-xs text-slate-500">{event.event_status}</p>}
        <time className="mt-1 block text-end text-[10px] text-slate-500">{localTime(event.occurred_at ?? event.received_at)}</time>
      </div>
    </div>
  );
}

/**
 * Read-only live archive view using only server-authorized scope discovery and
 * consent/audit-gated read endpoints. No fallback to mock data on API failures.
 * No media IDs/URLs, no sending and no local persistent copy of messages.
 */
export default function WhatsappEmployeeLiveArchive() {
  const [employeeIds, setEmployeeIds] = useState<number[]>([]);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ArchivedMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const loadScopes = useCallback(async () => {
    setLoading(true);
    try {
      const response = await requestArchive<{ employeeIds: number[] }>(
        "/api/whatsapp-employee/archive/scopes");
      if (!Array.isArray(response.employeeIds) ||
          !response.employeeIds.every(x => Number.isSafeInteger(x) && x > 0)) {
        throw new Error("temporary");
      }
      setEmployeeIds(response.employeeIds);
      setEmployeeId(current => current && response.employeeIds.includes(current) ?
        current : response.employeeIds[0] ?? null);
      setError(null);
    } catch (err) {
      setEmployeeIds([]);
      setEmployeeId(null);
      setConversations([]);
      setMessages([]);
      setError(err instanceof Error ? err.message : "temporary");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadScopes(); }, [loadScopes]);

  useEffect(() => {
    if (employeeId === null) {
      setConversations([]);
      setConversationId(null);
      return;
    }
    let active = true;
    const fetchConversations = async () => {
      try {
        const data = await requestArchive<{ conversations: Conversation[] }>(
          "/api/whatsapp-employee/archive/employees/" + employeeId + "/conversations");
        if (!active) return;
        if (!Array.isArray(data.conversations)) throw new Error("temporary");
        setConversations(data.conversations);
        setConversationId(current => current != null && data.conversations.some(c => c.id === current) ?
          current : data.conversations[0]?.id ?? null);
        setError(null);
      } catch (err) {
        if (!active) return;
        setConversations([]);
        setConversationId(null);
        setMessages([]);
        setError(err instanceof Error ? err.message : "temporary");
      }
    };
    void fetchConversations();
    const interval = setInterval(() => { void fetchConversations(); }, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [employeeId]);

  useEffect(() => {
    if (conversationId === null) {
      setMessages([]);
      return;
    }
    let active = true;
    const fetchMessages = async () => {
      try {
        const data = await requestArchive<{ messages: ArchivedMessage[] }>(
          "/api/whatsapp-employee/archive/conversations/" + conversationId + "/messages");
        if (!active) return;
        if (!Array.isArray(data.messages)) throw new Error("temporary");
        setMessages(data.messages);
        setLastUpdated(new Date().toISOString());
        setError(null);
      } catch (err) {
        if (!active) return;
        setMessages([]);
        setError(err instanceof Error ? err.message : "temporary");
      }
    };
    void fetchMessages();
    const interval = setInterval(() => { void fetchMessages(); }, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [conversationId]);

  return (
    <section dir="rtl" className="flex min-h-0 flex-1 flex-col gap-3 rounded-xl bg-white p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-[#005476]">
            <ShieldCheck className="h-5 w-5" /> أرشيف واتساب الحقيقي
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            قراءة محمية بالصلاحيات • تحديث تلقائي كل 5 ثوانٍ عند توفر اتصال معتمد
          </p>
        </div>
        <button type="button" onClick={() => { void loadScopes(); }}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-[#005476] hover:bg-slate-50">
          <RefreshCw className="h-4 w-4" /> تحديث الصلاحيات
        </button>
      </header>
      {loading && <p className="text-sm text-slate-600" role="status">جارٍ التحقق من الصلاحيات...</p>}
      {error && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
          {explainError(error)}
        </div>
      )}
      {!loading && !error && employeeIds.length === 0 &&
        <p className="rounded-lg border p-4 text-sm text-slate-600">لا توجد أرقام موظفين موصولة ومخوّلة للعرض حالياً.</p>}
      {employeeIds.length > 0 && (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[180px_260px_minmax(0,1fr)]">
          <nav aria-label="الموظفون المخوّلون" className="max-h-40 overflow-y-auto rounded-lg border lg:max-h-none">
            {employeeIds.map(id => (
              <button key={id} type="button" onClick={() => setEmployeeId(id)}
                className={"block w-full border-b p-3 text-start text-sm " +
                  (employeeId === id ? "bg-[#e7f8f7] font-semibold text-[#005476]" : "hover:bg-slate-50")}>
                موظف #{id}
              </button>
            ))}
          </nav>
          <nav aria-label="المحادثات" className="max-h-52 overflow-y-auto rounded-lg border lg:max-h-none">
            {conversations.length === 0 &&
              <p className="p-3 text-sm text-slate-500">لا توجد محادثات مؤرشفة لهذا الموظف.</p>}
            {conversations.map(c => (
              <button key={c.id} type="button" onClick={() => setConversationId(c.id)}
                className={"block w-full border-b p-3 text-start text-sm " +
                  (conversationId === c.id ? "bg-[#e7f8f7]" : "hover:bg-slate-50")}>
                <span dir="ltr" className="block truncate font-medium text-[#005476]">{c.contact_wa_id}</span>
                <span className="mt-1 block truncate text-xs text-slate-500">{c.last_message_preview || "محادثة مؤرشفة"}</span>
              </button>
            ))}
          </nav>
          <div className="flex min-h-[220px] flex-col gap-3 overflow-y-auto rounded-lg bg-[#efeae2] p-3 lg:min-h-0">
            {messages.length === 0 && <p className="text-center text-sm text-slate-600">اختر محادثة لعرض رسائلها المصرّح بها.</p>}
            {messages.map(event => <Message key={event.id} event={event} />)}
            {lastUpdated && <p className="flex items-center justify-center gap-1 text-[11px] text-slate-500">
              <Clock className="h-3 w-3" /> آخر تحديث {localTime(lastUpdated)}
            </p>}
          </div>
        </div>
      )}
      <p className="text-[11px] text-slate-500">
        <CheckCircle2 className="ms-1 inline h-3.5 w-3.5" />
        علامة الحذف تظهر فقط عند وصول حدث حذف مؤكد. حذف «لديّ فقط» على الهاتف لا يوفّر إشعاراً مضموناً.
        عرض الملفات نفسها يحتاج مخزناً خاصاً وصلاحيات تحميل منفصلة.
      </p>
    </section>
  );
}
