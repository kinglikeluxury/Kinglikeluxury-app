/**
 * Hidden Arabic landing page — /invest-georgia-il
 * Google/YouTube ads targeting Arabic-speaking real-estate investors (IL default).
 * noindex · nofollow · excluded from sitemap · no nav/footer.
 *
 * BUDGET VALUES: must be plain numeric strings so the CRM's
 *   fmtBudget(Number(budget)) renders without NaN.
 */

import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { trackGoogleAdsLeadConversion } from "@/lib/googleAds";

/* ─── Country-code list ──────────────────────────────────────────────────── */
const COUNTRY_CODES = [
  { code: "+972", flag: "🇮🇱" },
  { code: "+970", flag: "🇵🇸" },
  { code: "+971", flag: "🇦🇪" },
  { code: "+966", flag: "🇸🇦" },
  { code: "+962", flag: "🇯🇴" },
  { code: "+965", flag: "🇰🇼" },
  { code: "+974", flag: "🇶🇦" },
  { code: "+968", flag: "🇴🇲" },
  { code: "+973", flag: "🇧🇭" },
  { code: "+20",  flag: "🇪🇬" },
  { code: "+961", flag: "🇱🇧" },
  { code: "+963", flag: "🇸🇾" },
  { code: "+964", flag: "🇮🇶" },
  { code: "+212", flag: "🇲🇦" },
  { code: "+213", flag: "🇩🇿" },
  { code: "+216", flag: "🇹🇳" },
  { code: "+249", flag: "🇸🇩" },
  { code: "+218", flag: "🇱🇾" },
  { code: "+90",  flag: "🇹🇷" },
  { code: "+995", flag: "🇬🇪" },
  { code: "+1",   flag: "🇺🇸" },
  { code: "+44",  flag: "🇬🇧" },
  { code: "+49",  flag: "🇩🇪" },
];

/**
 * Budget options.
 * value = plain numeric string → stored in CRM budget column as text.
 * CRM displays via fmtBudget(Number(value)), so must be parseable.
 */
const BUDGET_OPTIONS = [
  { value: "45000",  label: "أقل من $50,000"          },
  { value: "50000",  label: "$50,000 – $75,000"        },
  { value: "75000",  label: "$75,000 – $100,000"       },
  { value: "100000", label: "$100,000 – $150,000"      },
  { value: "150000", label: "$150,000 – $200,000"      },
  { value: "200000", label: "أكثر من $200,000"         },
];

/* ─── Shared style helpers ───────────────────────────────────────────────── */
const FF = "Arial, Helvetica, sans-serif";

const inp: React.CSSProperties = {
  width: "100%",
  padding: "13px 14px",
  border: "1.5px solid #d1d5db",
  borderRadius: "10px",
  fontSize: "15px",
  fontFamily: FF,
  outline: "none",
  boxSizing: "border-box",
  direction: "rtl",
  textAlign: "right",
  color: "#111827",
  background: "#fff",
};

const lbl: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: "700",
  color: "#374151",
  marginBottom: "6px",
};

function PillGroup({
  options,
  value,
  onChange,
}: {
  options: { value: string; icon: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            style={{
              flex: "1",
              minWidth: "90px",
              padding: "11px 8px",
              border: selected ? "2px solid #3bcac4" : "1.5px solid #d1d5db",
              borderRadius: "10px",
              background: selected ? "#effdf9" : "#fff",
              color: selected ? "#005476" : "#374151",
              fontSize: "13px",
              fontWeight: "700",
              cursor: "pointer",
              textAlign: "center",
              transition: "all 0.15s",
              fontFamily: FF,
            }}
          >
            {opt.icon} {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function InvestGeorgiaIl() {
  const [form, setForm] = useState({
    fullName: "",
    countryCode: "+972",
    phoneNumber: "",
    email: "",
    budget: "",
    goal: "",
    city: "",
    expectedPurchaseMonth: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Capture UTM / gclid once on mount
  const [utmParams] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return {
      utm_source:   p.get("utm_source")   || "",
      utm_medium:   p.get("utm_medium")   || "",
      utm_campaign: p.get("utm_campaign") || "",
      utm_content:  p.get("utm_content")  || "",
      utm_term:     p.get("utm_term")     || "",
      gclid:        p.get("gclid")        || "",
    };
  });

  const set = (field: string, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitted) return; // prevent duplicate submissions
    setError(null);
    if (!form.fullName.trim())    { setError("الرجاء إدخال الاسم الكامل");      return; }
    if (!form.phoneNumber.trim()) { setError("الرجاء إدخال رقم الهاتف");        return; }
    if (!form.budget)             { setError("الرجاء اختيار الميزانية");         return; }
    if (!form.goal)               { setError("الرجاء اختيار الهدف من الشراء");  return; }

    setLoading(true);
    try {
      const res = await fetch("/api/landing/invest-georgia-il", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          phone:    form.countryCode + form.phoneNumber.trim(),
          email:    form.email.trim() || null,
          budget:   form.budget,   // numeric string e.g. "50000"
          goal:     form.goal,
          city:     form.city     || null,
          expectedPurchaseMonth: form.expectedPurchaseMonth || null,
          ...utmParams,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.success !== true) { setError(data.message || "حدث خطأ، يرجى المحاولة مجدداً"); return; }
      trackGoogleAdsLeadConversion();
      setSubmitted(true);
    } catch {
      setError("حدث خطأ في الاتصال، يرجى المحاولة مجدداً");
    } finally {
      setLoading(false);
    }
  };

  /* ── Success screen ───────────────────────────────────────────────────── */
  if (submitted) {
    return (
      <>
        <Helmet>
          <meta name="robots" content="noindex,nofollow" />
          <title>شكراً لك | Kinglike Luxury</title>
        </Helmet>
        <div
          dir="rtl"
          style={{
            minHeight: "100vh",
            background: "linear-gradient(135deg,#005476 0%,#3bcac4 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
            fontFamily: FF,
          }}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "20px",
              padding: "48px 28px",
              maxWidth: "460px",
              width: "100%",
              textAlign: "center",
              boxShadow: "0 8px 40px rgba(0,84,118,0.18)",
            }}
          >
            <div style={{ fontSize: "56px", marginBottom: "12px" }}>✓</div>
            <h2 style={{ color: "#005476", fontSize: "22px", fontWeight: "800", margin: "0 0 14px" }}>
              شكراً لك
            </h2>
            <p style={{ color: "#374151", fontSize: "16px", lineHeight: "1.75", margin: "0 0 24px" }}>
              تم استلام طلبك بنجاح، وسيتواصل معك أحد مستشاري{" "}
              <strong style={{ color: "#005476" }}>Kinglike Luxury</strong>{" "}
              قريباً.
            </p>
            <div
              style={{
                padding: "12px 20px",
                background: "linear-gradient(135deg,#3bcac4,#005476)",
                borderRadius: "10px",
                color: "#fff",
                fontSize: "14px",
                fontWeight: "700",
              }}
            >
              🇬🇪 عقارات جورجيا — Kinglike Luxury
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ── Form screen ──────────────────────────────────────────────────────── */
  return (
    <>
      <Helmet>
        <meta name="robots" content="noindex,nofollow" />
        <title>استثمر في عقارات جورجيا 🇬🇪 | Kinglike Luxury</title>
      </Helmet>

      <div dir="rtl" style={{ minHeight: "100vh", background: "#f0f9f9", fontFamily: FF }}>

        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <div style={{ position: "relative", overflow: "hidden" }}>
          {/* Background image */}
          <img
            src="https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&q=75"
            alt=""
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
            }}
          />
          {/* Overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "linear-gradient(160deg,rgba(0,84,118,0.88) 0%,rgba(59,202,196,0.75) 100%)",
            }}
          />
          {/* Content */}
          <div
            style={{
              position: "relative",
              padding: "44px 20px 52px",
              textAlign: "center",
            }}
          >
            <div
              style={{
                display: "inline-block",
                background: "rgba(255,255,255,0.15)",
                borderRadius: "20px",
                padding: "5px 14px",
                fontSize: "12px",
                color: "rgba(255,255,255,0.9)",
                letterSpacing: "0.8px",
                fontWeight: "700",
                marginBottom: "14px",
              }}
            >
              Kinglike Luxury Real Estate · 🇬🇪 جورجيا
            </div>

            <h1
              style={{
                color: "#fff",
                fontSize: "clamp(22px, 5vw, 30px)",
                fontWeight: "900",
                margin: "0 0 12px",
                lineHeight: "1.3",
                textShadow: "0 2px 8px rgba(0,0,0,0.25)",
              }}
            >
              استثمر في عقارات جورجيا 🇬🇪
            </h1>
            <p
              style={{
                color: "rgba(255,255,255,0.92)",
                fontSize: "15px",
                margin: "0 0 22px",
                lineHeight: "1.65",
                maxWidth: "420px",
                marginInline: "auto",
              }}
            >
              اكتشف فرصاً عقارية مختارة في باتومي وتبليسي تناسب ميزانيتك وهدفك الاستثماري
            </p>

            {/* Trust badges */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "10px",
                flexWrap: "wrap",
                marginBottom: "4px",
              }}
            >
              {[
                { icon: "🏆", text: "+1250 صفقة عقارية" },
                { icon: "📅", text: "متخصصون في السوق الجورجي منذ 2022" },
                { icon: "🆓", text: "استشارة مجانية" },
              ].map((b) => (
                <div
                  key={b.text}
                  style={{
                    background: "rgba(255,255,255,0.15)",
                    borderRadius: "20px",
                    padding: "7px 14px",
                    fontSize: "12px",
                    color: "#fff",
                    fontWeight: "700",
                    backdropFilter: "blur(4px)",
                    border: "1px solid rgba(255,255,255,0.2)",
                  }}
                >
                  {b.icon} {b.text}
                </div>
              ))}
            </div>

            {/* Returns disclaimer */}
            <p
              style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: "11px",
                margin: "12px 0 0",
              }}
            >
              عوائد استثمارية متوقعة قد تصل إلى 12% حسب المشروع
            </p>
          </div>
        </div>

        {/* ── Form card ─────────────────────────────────────────────────── */}
        <div style={{ maxWidth: "520px", margin: "-26px auto 0", padding: "0 14px 0" }}>
          <div
            style={{
              background: "#fff",
              borderRadius: "20px",
              padding: "28px 22px",
              boxShadow: "0 4px 28px rgba(0,84,118,0.13)",
            }}
          >
            <h2
              style={{
                color: "#005476",
                fontSize: "18px",
                fontWeight: "800",
                textAlign: "center",
                margin: "0 0 4px",
              }}
            >
              احصل على استشارة مجانية
            </h2>
            <p style={{ color: "#6b7280", fontSize: "13px", textAlign: "center", margin: "0 0 22px" }}>
              فريقنا يتواصل معك خلال 24 ساعة
            </p>

            <form onSubmit={handleSubmit} noValidate>

              {/* Full name */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>الاسم الكامل *</label>
                <input
                  type="text"
                  placeholder="مثال: محمد أحمد"
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  style={inp}
                />
              </div>

              {/* Phone */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>رقم الهاتف / واتساب *</label>
                <div style={{ display: "flex", gap: "8px", direction: "ltr" }}>
                  <select
                    value={form.countryCode}
                    onChange={(e) => set("countryCode", e.target.value)}
                    style={{
                      ...inp,
                      width: "128px",
                      direction: "ltr",
                      textAlign: "left",
                      flexShrink: 0,
                    }}
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>{c.flag} {c.code}</option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="501234567"
                    value={form.phoneNumber}
                    onChange={(e) => set("phoneNumber", e.target.value.replace(/\D/g, ""))}
                    style={{ ...inp, flex: 1, direction: "ltr", textAlign: "left" }}
                  />
                </div>
              </div>

              {/* Budget — required */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>الميزانية *</label>
                <select
                  value={form.budget}
                  onChange={(e) => set("budget", e.target.value)}
                  style={inp}
                >
                  <option value="">اختر الميزانية</option>
                  {BUDGET_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Goal — required */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>الهدف من الشراء *</label>
                <PillGroup
                  value={form.goal}
                  onChange={(v) => set("goal", v)}
                  options={[
                    { value: "استثمار",       icon: "📈", label: "استثمار"       },
                    { value: "سكن",           icon: "🏠", label: "سكن"           },
                    { value: "استثمار وسكن", icon: "🏆", label: "استثمار وسكن" },
                  ]}
                />
              </div>

              {/* Email — optional */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>
                  البريد الإلكتروني{" "}
                  <span style={{ color: "#9ca3af", fontWeight: "400" }}>(اختياري)</span>
                </label>
                <input
                  type="email"
                  placeholder="example@email.com"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  style={{ ...inp, direction: "ltr", textAlign: "left" }}
                />
              </div>

              {/* City — optional */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>
                  المدينة المفضلة{" "}
                  <span style={{ color: "#9ca3af", fontWeight: "400" }}>(اختياري)</span>
                </label>
                <PillGroup
                  value={form.city}
                  onChange={(v) => set("city", v === form.city ? "" : v)}
                  options={[
                    { value: "باتومي",   icon: "🌊", label: "باتومي"   },
                    { value: "تبليسي",   icon: "🏔️", label: "تبليسي"   },
                    { value: "غير محدد", icon: "🗺️", label: "غير محدد" },
                  ]}
                />
              </div>

              {/* Timeline — optional */}
              <div style={{ marginBottom: "22px" }}>
                <label style={lbl}>
                  موعد الشراء المتوقع{" "}
                  <span style={{ color: "#9ca3af", fontWeight: "400" }}>(اختياري)</span>
                </label>
                <select
                  value={form.expectedPurchaseMonth}
                  onChange={(e) => set("expectedPurchaseMonth", e.target.value)}
                  style={inp}
                >
                  <option value="">اختر الفترة الزمنية</option>
                  <option value="خلال 3 أشهر">خلال 3 أشهر</option>
                  <option value="خلال 6 أشهر">خلال 6 أشهر</option>
                  <option value="خلال سنة">خلال سنة</option>
                  <option value="أكثر من سنة">أكثر من سنة</option>
                  <option value="غير محدد">غير محدد بعد</option>
                </select>
              </div>

              {/* Inline error */}
              {error && (
                <div
                  style={{
                    marginBottom: "14px",
                    padding: "11px 14px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "10px",
                    color: "#dc2626",
                    fontSize: "14px",
                    textAlign: "center",
                  }}
                >
                  ⚠️ {error}
                </div>
              )}

              {/* CTA */}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: "100%",
                  padding: "15px",
                  background: loading
                    ? "#9ca3af"
                    : "linear-gradient(135deg,#3bcac4 0%,#005476 100%)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "16px",
                  fontWeight: "900",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontFamily: FF,
                  transition: "opacity 0.2s",
                  letterSpacing: "0.2px",
                  direction: "rtl",
                }}
              >
                {loading
                  ? "⏳ جاري الإرسال..."
                  : "اعرض لي أفضل الفرص المناسبة لميزانيتي ←"}
              </button>

              <p style={{ textAlign: "center", color: "#9ca3af", fontSize: "11px", margin: "10px 0 0" }}>
                🔒 معلوماتك محمية بالكامل ولن تُشارَك مع أي طرف ثالث
              </p>
            </form>
          </div>

          {/* ── What happens next ────────────────────────────────────────── */}
          <div
            style={{
              marginTop: "20px",
              background: "#fff",
              borderRadius: "16px",
              padding: "22px 20px",
              boxShadow: "0 2px 12px rgba(0,84,118,0.08)",
            }}
          >
            <h3
              style={{
                color: "#005476",
                fontSize: "15px",
                fontWeight: "800",
                margin: "0 0 16px",
                textAlign: "center",
              }}
            >
              ماذا يحدث بعد إرسال طلبك؟
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[
                { num: "١", text: "نراجع ميزانيتك وهدفك الاستثماري" },
                { num: "٢", text: "نختار الفرص العقارية الأكثر ملاءمة لك" },
                { num: "٣", text: "يتواصل معك أحد مستشارينا المتخصصين" },
              ].map((step) => (
                <div key={step.num} style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div
                    style={{
                      width: "34px",
                      height: "34px",
                      borderRadius: "50%",
                      background: "linear-gradient(135deg,#3bcac4,#005476)",
                      color: "#fff",
                      fontWeight: "800",
                      fontSize: "14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      fontFamily: FF,
                    }}
                  >
                    {step.num}
                  </div>
                  <span style={{ color: "#374151", fontSize: "14px", fontWeight: "600" }}>
                    {step.text}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Trust row */}
          <div
            style={{
              marginTop: "18px",
              display: "flex",
              justifyContent: "center",
              gap: "18px",
              flexWrap: "wrap",
            }}
          >
            {["✅ استشارة مجانية", "🏆 +1250 صفقة", "🌍 عملاء من 20+ دولة"].map((b) => (
              <span key={b} style={{ fontSize: "12px", color: "#005476", fontWeight: "700" }}>
                {b}
              </span>
            ))}
          </div>

          {/* Brand footer */}
          <div
            style={{
              textAlign: "center",
              margin: "22px 0 40px",
              color: "#9ca3af",
              fontSize: "11px",
            }}
          >
            © {new Date().getFullYear()} Kinglike Luxury Real Estate · جورجيا
          </div>
        </div>
      </div>
    </>
  );
}
