/**
 * Hidden Arabic landing page — /invest-georgia-il
 * Google/YouTube ads targeting Arabic-speaking real-estate investors.
 * noindex · nofollow · excluded from sitemap · no nav/footer.
 */

import { useState } from "react";
import { Helmet } from "react-helmet-async";

const COUNTRY_CODES = [
  { code: "+972", label: "🇮🇱 +972" },
  { code: "+970", label: "🇵🇸 +970" },
  { code: "+971", label: "🇦🇪 +971" },
  { code: "+966", label: "🇸🇦 +966" },
  { code: "+962", label: "🇯🇴 +962" },
  { code: "+965", label: "🇰🇼 +965" },
  { code: "+974", label: "🇶🇦 +974" },
  { code: "+968", label: "🇴🇲 +968" },
  { code: "+973", label: "🇧🇭 +973" },
  { code: "+20",  label: "🇪🇬 +20"  },
  { code: "+961", label: "🇱🇧 +961" },
  { code: "+963", label: "🇸🇾 +963" },
  { code: "+964", label: "🇮🇶 +964" },
  { code: "+212", label: "🇲🇦 +212" },
  { code: "+213", label: "🇩🇿 +213" },
  { code: "+216", label: "🇹🇳 +216" },
  { code: "+249", label: "🇸🇩 +249" },
  { code: "+218", label: "🇱🇾 +218" },
  { code: "+90",  label: "🇹🇷 +90"  },
  { code: "+995", label: "🇬🇪 +995" },
  { code: "+1",   label: "🇺🇸 +1"   },
  { code: "+44",  label: "🇬🇧 +44"  },
  { code: "+49",  label: "🇩🇪 +49"  },
];

const inp: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  border: "1.5px solid #d1d5db",
  borderRadius: "10px",
  fontSize: "15px",
  fontFamily: "Arial, Helvetica, sans-serif",
  outline: "none",
  boxSizing: "border-box",
  direction: "rtl",
  textAlign: "right",
  color: "#111827",
  background: "#fff",
  appearance: "auto" as any,
};

const lbl: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: "700",
  color: "#374151",
  marginBottom: "6px",
};

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

  // Capture UTM / gclid from URL on mount (stable — read once)
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
    setForm(f => ({ ...f, [field]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.fullName.trim())   { setError("الرجاء إدخال الاسم الكامل"); return; }
    if (!form.phoneNumber.trim()) { setError("الرجاء إدخال رقم الهاتف"); return; }
    if (!form.budget)             { setError("الرجاء اختيار الميزانية"); return; }
    if (!form.goal)               { setError("الرجاء اختيار الهدف من الشراء"); return; }
    if (!form.city)               { setError("الرجاء اختيار المدينة المفضلة"); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/landing/invest-georgia-il", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: form.fullName.trim(),
          phone:    form.countryCode + form.phoneNumber.trim(),
          email:    form.email.trim() || null,
          budget:   form.budget,
          goal:     form.goal,
          city:     form.city,
          expectedPurchaseMonth: form.expectedPurchaseMonth || null,
          ...utmParams,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || "حدث خطأ، يرجى المحاولة مجدداً"); return; }
      setSubmitted(true);
    } catch {
      setError("حدث خطأ في الاتصال، يرجى المحاولة مجدداً");
    } finally {
      setLoading(false);
    }
  };

  /* ── Success screen ─────────────────────────────────────────────────────── */
  if (submitted) {
    return (
      <>
        <Helmet>
          <meta name="robots" content="noindex,nofollow" />
          <title>شكراً لك | Kinglike Luxury</title>
        </Helmet>
        <div dir="rtl" style={{ minHeight: "100vh", background: "linear-gradient(135deg,#005476 0%,#3bcac4 100%)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", fontFamily: "Arial,Helvetica,sans-serif" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "48px 32px", maxWidth: "460px", width: "100%", textAlign: "center", boxShadow: "0 8px 40px rgba(0,84,118,0.18)" }}>
            <div style={{ fontSize: "60px", marginBottom: "12px" }}>✅</div>
            <h2 style={{ color: "#005476", fontSize: "22px", fontWeight: "800", margin: "0 0 14px" }}>شكراً لك!</h2>
            <p style={{ color: "#374151", fontSize: "16px", lineHeight: "1.75", margin: "0 0 24px" }}>
              تم استلام طلبك بنجاح.<br />
              سيتواصل معك أحد مستشاري{" "}
              <strong style={{ color: "#005476" }}>Kinglike Luxury</strong>{" "}
              قريباً.
            </p>
            <div style={{ padding: "12px 20px", background: "linear-gradient(135deg,#3bcac4,#005476)", borderRadius: "10px", color: "#fff", fontSize: "14px", fontWeight: "700" }}>
              🇬🇪 عقارات جورجيا — Kinglike Luxury
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ── Form screen ────────────────────────────────────────────────────────── */
  return (
    <>
      <Helmet>
        <meta name="robots" content="noindex,nofollow" />
        <title>استثمر في عقارات جورجيا 🇬🇪 | Kinglike Luxury</title>
      </Helmet>

      <div dir="rtl" style={{ minHeight: "100vh", background: "#f0f9f9", fontFamily: "Arial,Helvetica,sans-serif" }}>

        {/* ── Hero header ─────────────────────────────────────────────────── */}
        <div style={{ background: "linear-gradient(135deg,#005476 0%,#3bcac4 100%)", padding: "40px 20px 52px", textAlign: "center" }}>
          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.7)", letterSpacing: "1.2px", textTransform: "uppercase", marginBottom: "8px" }}>
            Kinglike Luxury Real Estate
          </div>
          <h1 style={{ color: "#fff", fontSize: "26px", fontWeight: "900", margin: "0 0 10px", lineHeight: "1.35" }}>
            استثمر في عقارات جورجيا 🇬🇪
          </h1>
          <p style={{ color: "rgba(255,255,255,0.88)", fontSize: "15px", margin: "0 0 20px", lineHeight: "1.65" }}>
            عوائد مرتفعة · إقامة دائمة · بيئة استثمارية آمنة
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "10px", flexWrap: "wrap" }}>
            {[
              "🏙️ باتومي وتبليسي",
              "📈 عوائد 8–12%",
              "🛂 إقامة بالشراء",
              "💵 من $50,000",
            ].map(b => (
              <span key={b} style={{ background: "rgba(255,255,255,0.18)", borderRadius: "20px", padding: "6px 13px", fontSize: "12px", color: "#fff", fontWeight: "700" }}>
                {b}
              </span>
            ))}
          </div>
        </div>

        {/* ── Form card ───────────────────────────────────────────────────── */}
        <div style={{ maxWidth: "520px", margin: "-26px auto 0", padding: "0 14px 48px" }}>
          <div style={{ background: "#fff", borderRadius: "20px", padding: "28px 22px", boxShadow: "0 4px 28px rgba(0,84,118,0.13)" }}>

            <h2 style={{ color: "#005476", fontSize: "18px", fontWeight: "800", textAlign: "center", margin: "0 0 4px" }}>
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
                  onChange={e => set("fullName", e.target.value)}
                  style={inp}
                />
              </div>

              {/* Phone with country code */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>رقم الهاتف / واتساب *</label>
                <div style={{ display: "flex", gap: "8px", direction: "ltr" }}>
                  <select
                    value={form.countryCode}
                    onChange={e => set("countryCode", e.target.value)}
                    style={{ ...inp, width: "128px", direction: "ltr", textAlign: "left", flexShrink: 0 }}
                  >
                    {COUNTRY_CODES.map(c => (
                      <option key={c.code} value={c.code}>{c.label}</option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="501234567"
                    value={form.phoneNumber}
                    onChange={e => set("phoneNumber", e.target.value.replace(/\D/g, ""))}
                    style={{ ...inp, flex: 1, direction: "ltr", textAlign: "left" }}
                  />
                </div>
              </div>

              {/* Email (optional) */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>
                  البريد الإلكتروني{" "}
                  <span style={{ color: "#9ca3af", fontWeight: "400" }}>(اختياري)</span>
                </label>
                <input
                  type="email"
                  placeholder="example@email.com"
                  value={form.email}
                  onChange={e => set("email", e.target.value)}
                  style={{ ...inp, direction: "ltr", textAlign: "left" }}
                />
              </div>

              {/* Budget */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>الميزانية *</label>
                <select value={form.budget} onChange={e => set("budget", e.target.value)} style={inp}>
                  <option value="">اختر الميزانية</option>
                  <option value="< $50k">أقل من $50,000</option>
                  <option value="$50k–75k">$50,000 – $75,000</option>
                  <option value="$75k–100k">$75,000 – $100,000</option>
                  <option value="$100k–150k">$100,000 – $150,000</option>
                  <option value="> $150k">أكثر من $150,000</option>
                </select>
              </div>

              {/* Goal — pill buttons */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>الهدف من الشراء *</label>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {[
                    { value: "استثمار",       icon: "📈" },
                    { value: "سكن",           icon: "🏠" },
                    { value: "استثمار وسكن", icon: "🏆" },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => set("goal", opt.value)}
                      style={{
                        flex: "1",
                        minWidth: "90px",
                        padding: "10px 8px",
                        border: form.goal === opt.value ? "2px solid #3bcac4" : "1.5px solid #d1d5db",
                        borderRadius: "10px",
                        background: form.goal === opt.value ? "#effdf9" : "#fff",
                        color: form.goal === opt.value ? "#005476" : "#374151",
                        fontSize: "13px",
                        fontWeight: "700",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.15s",
                        fontFamily: "Arial,Helvetica,sans-serif",
                      }}
                    >
                      {opt.icon} {opt.value}
                    </button>
                  ))}
                </div>
              </div>

              {/* City — pill buttons */}
              <div style={{ marginBottom: "15px" }}>
                <label style={lbl}>المدينة المفضلة *</label>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  {[
                    { value: "باتومي",   icon: "🌊" },
                    { value: "تبليسي",   icon: "🏔️" },
                    { value: "غير محدد", icon: "🗺️" },
                  ].map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => set("city", opt.value)}
                      style={{
                        flex: "1",
                        minWidth: "90px",
                        padding: "10px 8px",
                        border: form.city === opt.value ? "2px solid #3bcac4" : "1.5px solid #d1d5db",
                        borderRadius: "10px",
                        background: form.city === opt.value ? "#effdf9" : "#fff",
                        color: form.city === opt.value ? "#005476" : "#374151",
                        fontSize: "13px",
                        fontWeight: "700",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.15s",
                        fontFamily: "Arial,Helvetica,sans-serif",
                      }}
                    >
                      {opt.icon} {opt.value}
                    </button>
                  ))}
                </div>
              </div>

              {/* Purchase timeline */}
              <div style={{ marginBottom: "22px" }}>
                <label style={lbl}>موعد الشراء المتوقع</label>
                <select
                  value={form.expectedPurchaseMonth}
                  onChange={e => set("expectedPurchaseMonth", e.target.value)}
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
                <div style={{ marginBottom: "14px", padding: "11px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", color: "#dc2626", fontSize: "14px", textAlign: "center" }}>
                  ⚠️ {error}
                </div>
              )}

              {/* Submit button */}
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
                  fontSize: "17px",
                  fontWeight: "900",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontFamily: "Arial,Helvetica,sans-serif",
                  letterSpacing: "0.2px",
                  transition: "opacity 0.2s",
                }}
              >
                {loading ? "⏳ جاري الإرسال..." : "🚀 أرسل طلبك الآن — مجاناً"}
              </button>

              <p style={{ textAlign: "center", color: "#9ca3af", fontSize: "12px", margin: "10px 0 0" }}>
                🔒 معلوماتك محمية بالكامل ولن تُشارَك مع أي طرف ثالث
              </p>
            </form>
          </div>

          {/* Trust badges */}
          <div style={{ marginTop: "18px", display: "flex", justifyContent: "center", gap: "16px", flexWrap: "wrap" }}>
            {[
              "✅ استشارة مجانية",
              "🏆 خبرة 10+ سنوات",
              "🌍 عملاء من 20+ دولة",
            ].map(b => (
              <span key={b} style={{ fontSize: "12px", color: "#005476", fontWeight: "700" }}>{b}</span>
            ))}
          </div>

          {/* Brand footer */}
          <div style={{ textAlign: "center", marginTop: "22px", color: "#9ca3af", fontSize: "11px" }}>
            © {new Date().getFullYear()} Kinglike Luxury Real Estate · جورجيا
          </div>
        </div>
      </div>
    </>
  );
}
