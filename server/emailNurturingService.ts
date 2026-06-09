/**
 * Email Nurturing Service
 * Automatically starts trust-based email sequences when leads enter the CRM.
 * Sending is gated behind EMAIL_NURTURING_ENABLED=true (default: off — logs only).
 */

import crypto from "crypto";
import { pool } from "./db";

// ─── Constants ────────────────────────────────────────────────────────────────
const UNSUBSCRIBE_SECRET = process.env.EMAIL_NURTURING_UNSUBSCRIBE_SECRET || "kinglike-unsub-secret-2024";
const ENABLED = () => process.env.EMAIL_NURTURING_ENABLED === "true";
const APP_URL = process.env.APP_URL || "https://www.kinglikeluxury.app";

/** Statuses that permanently stop nurturing */
const STOP_STATUSES = new Set([
  "purchased", "sold_by_kinglike_luxury", "lost_competition",
  "not_interested", "junk_lead", "invalid_number", "duplicate", "blacklisted",
  "second_hand",
]);

// ─── Email HTML wrapper ────────────────────────────────────────────────────────
function emailWrapper(content: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kinglike Luxury</title></head>
<body style="margin:0;padding:0;background:#f0f9f9;font-family:Arial,Helvetica,sans-serif;direction:rtl">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f9f9;padding:40px 20px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,84,118,0.10)">
      <tr>
        <td style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:40px;text-align:center">
          <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800;letter-spacing:-0.5px">Kinglike Luxury</h1>
          <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">منصة العقارات الفاخرة</p>
        </td>
      </tr>
      <tr>
        <td style="padding:40px 40px 24px">
          ${content}
        </td>
      </tr>
      <tr>
        <td style="padding:0 40px 32px;text-align:center;border-top:1px solid #e8f4f8">
          <p style="color:#aaa;font-size:12px;margin:16px 0 4px">Kinglike Luxury — منصة العقارات الفاخرة</p>
          <p style="color:#aaa;font-size:11px;margin:0">
            إذا كنت لا تريد تلقي هذه الرسائل، يمكنك
            <a href="${unsubscribeUrl}" style="color:#3bcac4;text-decoration:underline">إلغاء الاشتراك من هنا</a>
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function btnStyle() {
  return `display:inline-block;background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:700;margin-top:20px`;
}

// ─── Template version (bump when content changes to auto-migrate DB) ───────────
const TEMPLATE_VERSION = "v2";

// ─── Default templates — trust-based Georgia real estate sequence ──────────────
function defaultTemplates() {
  return [
    // ── Email 1 — Day 0 (immediate): Welcome + services ────────────────────────
    {
      day_offset: 0, sort_order: 1, is_recurring: false,
      subject: "مرحباً بك في Kinglike Luxury",
      body_text: "أهلاً {{firstName}}، شكراً لاهتمامك. سيتواصل معك مستشار من فريقنا قريباً.",
      get body_html() {
        return emailWrapper(`
          <h2 style="color:#005476;margin-top:0;font-size:22px">مرحباً {{firstName}} 👋</h2>
          <p style="color:#444;line-height:1.9;font-size:15px">
            شكراً لاهتمامك بـ <strong>Kinglike Luxury</strong>.
          </p>
          <p style="color:#444;line-height:1.9;font-size:15px">
            سيتواصل معك أحد مستشارينا قريباً لمساعدتك في رحلتك الاستثمارية.
          </p>
          <div style="background:#f0f9f9;border-radius:12px;padding:24px 28px;margin:24px 0">
            <p style="color:#005476;font-weight:700;font-size:16px;margin:0 0 16px">لماذا تختار Kinglike Luxury؟</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${[
                ["✓", "لا عمولة على المشتري", "خدماتنا مجانية لك تماماً"],
                ["✓", "تمثيل رسمي لعدة مطورين", "نمنحك أوسع نطاق من الخيارات"],
                ["✓", "توجيه قبل الشراء", "نساعدك على اتخاذ القرار الصحيح"],
                ["✓", "دعم بعد الشراء", "علاقتنا لا تنتهي بعد التوقيع"],
                ["✓", "متابعة تقدم المشروع", "نبقيك على اطلاع دائم بمراحل البناء"],
                ["✓", "مساعدة في إدارة الإيجار", "نساعدك في استثمار عقارك"],
                ["✓", "دعم إعادة البيع", "شبكتنا في خدمتك عند البيع"],
                ["✓", "خدمات VIP", "رعاية شخصية لكل عميل"],
              ].map(([check, title, desc]) => `
                <tr>
                  <td width="28" valign="top" style="padding:6px 0">
                    <span style="color:#3bcac4;font-weight:700;font-size:16px">${check}</span>
                  </td>
                  <td style="padding:6px 0 6px 8px">
                    <strong style="color:#005476;font-size:14px">${title}</strong>
                    <span style="color:#777;font-size:13px"> — ${desc}</span>
                  </td>
                </tr>
              `).join("")}
            </table>
          </div>
          <p style="color:#444;line-height:1.9;font-size:15px">
            نحن هنا لمساعدة المستثمرين على اتخاذ قرارات مدروسة وتقديم التوجيه المهني في كل مرحلة.
          </p>
          <div style="text-align:center">
            <a href="https://www.kinglikeluxury.app/consultation" style="${btnStyle()}">احجز استشارة مجانية</a>
          </div>
        `, "{{unsubscribeUrl}}");
      }
    },

    // ── Email 2 — Day 2: Why Georgia in 2026 ───────────────────────────────────
    {
      day_offset: 2, sort_order: 2, is_recurring: false,
      subject: "لماذا يختار المستثمرون جورجيا في 2026؟",
      body_text: "أهلاً {{firstName}}، اكتشف لماذا تتصدر جورجيا قائمة وجهات الاستثمار العقاري في 2026.",
      get body_html() {
        return emailWrapper(`
          <h2 style="color:#005476;margin-top:0;font-size:22px">لماذا يختار المستثمرون جورجيا في 2026؟</h2>
          <p style="color:#444;line-height:1.9;font-size:15px">أهلاً {{firstName}}،</p>
          <p style="color:#444;line-height:1.9;font-size:15px">
            تتصدر جورجيا قائمة الوجهات الاستثمارية الواعدة في المنطقة. إليك أبرز الأسباب التي تدفع المستثمرين إلى اختيارها:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:20px 0">
            ${[
              ["🏖️", "قطاع سياحي متنامٍ", "تشهد جورجيا نمواً متسارعاً في أعداد السياح سنة بعد سنة، مما يرفع الطلب على الإيجارات قصيرة المدى."],
              ["📈", "تزايد الطلب على العقارات", "يتصاعد الطلب المحلي والدولي على العقارات، مما يدعم استقرار السوق واتجاهاته على المدى البعيد."],
              ["🏗️", "توسع البنية التحتية", "مشاريع طرق ومطارات وبنية تحتية تُحوّل مناطق واعدة إلى وجهات استثمارية حيوية."],
              ["🌍", "ملكية حرة للأجانب", "يمنح القانون الجورجي الأجانب حق التملك الكامل للعقارات دون قيود أو اشتراطات معقدة."],
              ["🔭", "إمكانات على المدى البعيد", "يجمع الموقع الاستراتيجي والاستقرار الاقتصادي والبيئة الاستثمارية المواتية لتوفير فرص طويلة الأمد."],
            ].map(([icon, title, desc]) => `
              <tr>
                <td width="52" valign="top" style="padding:10px 0">
                  <div style="width:44px;height:44px;background:#e8faf9;border-radius:10px;text-align:center;line-height:44px;font-size:22px">${icon}</div>
                </td>
                <td style="padding:10px 0 10px 14px;border-bottom:1px solid #f0f0f0">
                  <strong style="color:#005476;font-size:14px;display:block;margin-bottom:4px">${title}</strong>
                  <span style="color:#666;font-size:13px;line-height:1.7">${desc}</span>
                </td>
              </tr>
            `).join("")}
          </table>
          <p style="color:#888;font-size:13px;line-height:1.7;border-right:3px solid #3bcac4;padding-right:12px;margin:20px 0">
            هذه المعلومات لأغراض توعوية فقط. الاستثمار العقاري ينطوي على مخاطر، وننصح دائماً بالبحث الدقيق والاستشارة المتخصصة قبل اتخاذ أي قرار.
          </p>
          <div style="text-align:center">
            <a href="https://www.kinglikeluxury.app/consultation" style="${btnStyle()}">تحدث مع مستشار</a>
          </div>
        `, "{{unsubscribeUrl}}");
      }
    },

    // ── Email 3 — Day 5: Common investor mistakes ───────────────────────────────
    {
      day_offset: 5, sort_order: 3, is_recurring: false,
      subject: "أخطاء شائعة يقع فيها المستثمرون قبل شراء العقار",
      body_text: "أهلاً {{firstName}}، تعرف على أبرز الأخطاء التي يجب تجنبها قبل اتخاذ قرار الشراء.",
      get body_html() {
        return emailWrapper(`
          <h2 style="color:#005476;margin-top:0;font-size:22px">أخطاء شائعة يقع فيها المستثمرون</h2>
          <p style="color:#444;line-height:1.9;font-size:15px">أهلاً {{firstName}}،</p>
          <p style="color:#444;line-height:1.9;font-size:15px">
            من خبرتنا في العمل مع مئات المستثمرين، رصدنا أبرز الأخطاء التي تؤدي إلى قرارات مكلفة. نشاركها معك لتتجنبها:
          </p>
          ${[
            ["❌", "الشراء دون بحث في السوق", "يتسرع بعض المستثمرين في اتخاذ القرار دون فهم كافٍ للسوق المحلي واتجاهاته وأسعاره المرجعية."],
            ["❌", "اختيار الموقع الخاطئ", "الموقع هو العامل الأكثر تأثيراً في قيمة العقار. مناطق بعيدة عن الخدمات أو السياحة قد لا تحقق العوائد المرجوة."],
            ["❌", "تجاهل سمعة المطور", "التاريخ البنائي للمطور وسجله في التسليم والجودة من أهم المعايير التي لا يجب إغفالها."],
            ["❌", "إغفال مراجعة الوثائق", "نساعد عملاءنا على فهم الوثائق المتاحة والتنسيق مع الأطراف ذات الصلة عند الحاجة — دون الاستعاضة عن المشورة القانونية المتخصصة."],
            ["❌", "التركيز على السعر فقط", "أدنى سعر لا يعني أفضل صفقة. الجودة والموقع وموثوقية المطور عوامل لا تقل أهمية عن السعر."],
          ].map(([icon, title, desc]) => `
            <div style="background:#fff8f8;border-right:4px solid #e8a0a0;border-radius:8px;padding:14px 18px;margin:12px 0">
              <p style="color:#c0392b;font-weight:700;margin:0 0 6px;font-size:14px">${icon} ${title}</p>
              <p style="color:#666;margin:0;font-size:13px;line-height:1.7">${desc}</p>
            </div>
          `).join("")}
          <div style="background:linear-gradient(135deg,#e8faf9 0%,#e0f0f8 100%);border-radius:10px;padding:20px 24px;margin:24px 0;text-align:center">
            <p style="color:#005476;font-weight:700;font-size:15px;margin:0 0 6px">نحن هنا لمساعدتك على تجنب هذه الأخطاء</p>
            <p style="color:#555;font-size:13px;margin:0;line-height:1.7">توجيه مهني خطوة بخطوة — قبل أي قرار وبعده.</p>
          </div>
          <div style="text-align:center">
            <a href="https://www.kinglikeluxury.app/consultation" style="${btnStyle()}">اطلب توجيهاً احترافياً</a>
          </div>
        `, "{{unsubscribeUrl}}");
      }
    },

    // ── Email 4 — Day 10: Services value proposition ───────────────────────────
    {
      day_offset: 10, sort_order: 4, is_recurring: false,
      subject: "ما الخدمات التي يحصل عليها عملاء Kinglike Luxury؟",
      body_text: "أهلاً {{firstName}}، اكتشف الخدمات الشاملة التي نقدمها لعملائنا في كل مرحلة.",
      get body_html() {
        return emailWrapper(`
          <h2 style="color:#005476;margin-top:0;font-size:22px">ما الذي يحصل عليه عملاء Kinglike Luxury؟</h2>
          <p style="color:#444;line-height:1.9;font-size:15px">أهلاً {{firstName}}،</p>
          <p style="color:#444;line-height:1.9;font-size:15px">
            في Kinglike Luxury، نرافقك في كل مرحلة من رحلتك الاستثمارية. إليك ما يحصل عليه عملاؤنا:
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:20px 0">
            ${[
              ["🏘️", "مساعدة في اختيار المشروع", "نستعرض معك الخيارات المتاحة ونساعدك على تقييمها وفق أهدافك وميزانيتك."],
              ["🤝", "التنسيق مع المطور", "نتولى التواصل مع المطور نيابة عنك لتوفير وقتك وضمان سلاسة المراحل."],
              ["📋", "دعم عملية الشراء", "نساعدك على فهم الوثائق المتاحة والتنسيق مع الأطراف ذات الصلة عند الحاجة."],
              ["🏗️", "تحديثات البناء", "نبقيك على اطلاع منتظم بمراحل تقدم مشروعك حتى التسليم."],
              ["🏠", "مساعدة في الإيجار", "عند رغبتك في تأجير عقارك، نساعدك بشبكة دعم متكاملة."],
              ["📊", "دعم إعادة البيع", "عندما يحين وقت البيع، نوفر لك شبكة مشترين وخبرة ميدانية."],
              ["👑", "خدمة VIP", "رعاية شخصية ومستشار مخصص لكل عميل طوال رحلته الاستثمارية."],
            ].map(([icon, title, desc]) => `
              <tr>
                <td width="52" valign="top" style="padding:8px 0">
                  <div style="width:40px;height:40px;background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);border-radius:10px;text-align:center;line-height:40px;font-size:18px">${icon}</div>
                </td>
                <td style="padding:8px 0 8px 14px;border-bottom:1px solid #f5f5f5">
                  <strong style="color:#005476;font-size:14px;display:block;margin-bottom:3px">${title}</strong>
                  <span style="color:#666;font-size:13px;line-height:1.7">${desc}</span>
                </td>
              </tr>
            `).join("")}
          </table>
          <p style="color:#888;font-size:13px;line-height:1.7;text-align:center;margin-top:8px">
            جميع الخدمات المذكورة مجانية للمشتري — لا عمولات ولا رسوم خفية.
          </p>
          <div style="text-align:center">
            <a href="https://www.kinglikeluxury.app/consultation" style="${btnStyle()}">تواصل مع فريقنا</a>
          </div>
        `, "{{unsubscribeUrl}}");
      }
    },

    // ── Email 5 — Day 20: Investment opportunities in Georgia ──────────────────
    {
      day_offset: 20, sort_order: 5, is_recurring: false,
      subject: "أحدث فرص الاستثمار في جورجيا",
      body_text: "أهلاً {{firstName}}، اكتشف أبرز فرص الاستثمار العقاري المتاحة حالياً في جورجيا.",
      get body_html() {
        return emailWrapper(`
          <h2 style="color:#005476;margin-top:0;font-size:22px">أحدث فرص الاستثمار في جورجيا</h2>
          <p style="color:#444;line-height:1.9;font-size:15px">أهلاً {{firstName}}،</p>
          <p style="color:#444;line-height:1.9;font-size:15px">
            نشارك معك نماذج من الفرص الاستثمارية المتاحة حالياً في جورجيا عبر شركاء Kinglike Luxury:
          </p>
          ${[
            {
              title: "مشروع سكني في قلب تبليسي",
              location: "📍 تبليسي — وسط المدينة",
              price: "يبدأ من 55,000 $",
              desc: "وحدات سكنية حديثة بموقع مميز في قلب العاصمة، قريبة من المعالم السياحية والمرافق الرئيسية.",
            },
            {
              title: "مجمع فندقي على البحر الأسود",
              location: "📍 باتومي — الواجهة البحرية",
              price: "يبدأ من 45,000 $",
              desc: "استوديوهات وشقق بإطلالة بحرية في أكثر المناطق السياحية حيوية على البحر الأسود.",
            },
            {
              title: "فلل ومنازل في المناطق الجبلية",
              location: "📍 منطقة كوداوري والمناطق الجبلية",
              price: "يبدأ من 80,000 $",
              desc: "منازل وفلل في مناطق سياحية جبلية تشهد طلباً متزايداً طوال العام.",
            },
          ].map(op => `
            <div style="border:1px solid #e0f0ed;border-radius:10px;overflow:hidden;margin:16px 0">
              <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:14px 20px">
                <p style="color:#fff;font-weight:700;font-size:15px;margin:0">${op.title}</p>
                <p style="color:rgba(255,255,255,0.85);font-size:12px;margin:4px 0 0">${op.location}</p>
              </div>
              <div style="padding:16px 20px;background:#fff">
                <p style="color:#3bcac4;font-weight:700;font-size:16px;margin:0 0 8px">${op.price}</p>
                <p style="color:#666;font-size:13px;line-height:1.7;margin:0">${op.desc}</p>
              </div>
            </div>
          `).join("")}
          <p style="color:#888;font-size:12px;line-height:1.7;text-align:center;margin:16px 0 0;border-top:1px solid #f0f0f0;padding-top:16px">
            هذه أمثلة توضيحية. للاطلاع على قائمة الفرص الحالية وفق ميزانيتك وأهدافك، تواصل مع فريقنا مباشرة.
          </p>
          <div style="text-align:center">
            <a href="https://www.kinglikeluxury.app/consultation" style="${btnStyle()}">اعرض الفرص المتاحة</a>
          </div>
        `, "{{unsubscribeUrl}}");
      }
    },

    // ── Email 6 — Day 35: Re-engagement ────────────────────────────────────────
    {
      day_offset: 35, sort_order: 6, is_recurring: false,
      subject: "هل لا تزال تفكر في الاستثمار في جورجيا؟",
      body_text: "أهلاً {{firstName}}، نحن هنا متى كنت مستعداً — مع أحدث تحديثات السوق وفرصة استشارة مجانية.",
      get body_html() {
        return emailWrapper(`
          <h2 style="color:#005476;margin-top:0;font-size:22px">هل لا تزال تفكر في الاستثمار في جورجيا؟</h2>
          <p style="color:#444;line-height:1.9;font-size:15px">أهلاً {{firstName}}،</p>
          <p style="color:#444;line-height:1.9;font-size:15px">
            نعلم أن قرار الاستثمار يحتاج وقتاً ودراسة — لهذا لن نضغط عليك. نحن هنا متى كنت مستعداً.
          </p>
          <div style="background:#f0f9f9;border-radius:12px;padding:22px 26px;margin:22px 0">
            <p style="color:#005476;font-weight:700;font-size:15px;margin:0 0 14px">ما يمكننا تقديمه لك الآن:</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${[
                ["📊", "تحديثات السوق", "آخر مستجدات سوق العقارات في جورجيا وأبرز التوجهات."],
                ["🎯", "استشارة مجانية", "جلسة شخصية مع أحد مستشارينا للإجابة عن أسئلتك دون أي التزام."],
                ["💡", "توصيات شخصية", "فرص مختارة وفق ميزانيتك وأهدافك الاستثمارية تحديداً."],
              ].map(([icon, title, desc]) => `
                <tr>
                  <td width="36" valign="top" style="padding:6px 0">
                    <span style="font-size:20px">${icon}</span>
                  </td>
                  <td style="padding:6px 0 6px 10px">
                    <strong style="color:#005476;font-size:14px">${title}</strong>
                    <p style="margin:2px 0 0;color:#666;font-size:13px;line-height:1.6">${desc}</p>
                  </td>
                </tr>
              `).join("")}
            </table>
          </div>
          <p style="color:#444;line-height:1.9;font-size:15px">
            رسالة واحدة منك تكفي لنبدأ المحادثة. فريقنا في انتظارك.
          </p>
          <div style="text-align:center">
            <a href="https://www.kinglikeluxury.app/consultation" style="${btnStyle()}">حدد موعداً</a>
          </div>
        `, "{{unsubscribeUrl}}");
      }
    },

    // ── Email 7 — Day 65, then every 30 days: Monthly update ──────────────────
    {
      day_offset: 65, sort_order: 7, is_recurring: true,
      subject: "تحديثات شهرية من Kinglike Luxury",
      body_text: "أهلاً {{firstName}}، إليك أبرز تحديثات السوق العقاري في جورجيا هذا الشهر.",
      get body_html() {
        return emailWrapper(`
          <h2 style="color:#005476;margin-top:0;font-size:22px">تحديثات شهرية — سوق العقارات في جورجيا</h2>
          <p style="color:#444;line-height:1.9;font-size:15px">أهلاً {{firstName}}،</p>
          <p style="color:#444;line-height:1.9;font-size:15px">
            رسالتنا الشهرية لإبقائك على اطلاع بأبرز مستجدات السوق العقاري في جورجيا:
          </p>
          <div style="margin:20px 0">
            ${[
              ["📈", "تحديثات السوق", "يواصل سوق العقارات في جورجيا نموه، مع ارتفاع مستمر في الطلب على العقارات السكنية والسياحية في المدن الرئيسية."],
              ["🏗️", "تحديثات البناء", "تتواصل مشاريع البنية التحتية ومشاريع التطوير العقاري في تبليسي وباتومي وكوداوري."],
              ["🆕", "فرص جديدة", "لمعرفة أحدث المشاريع المتاحة وفق ميزانيتك، تواصل مع فريقنا مباشرة للحصول على قائمة مخصصة."],
              ["⚖️", "تحديثات تنظيمية", "يحتفظ القانون الجورجي بحق التملك الكامل للأجانب دون قيود. للاطلاع على آخر المستجدات القانونية، ننصح بمتابعة المصادر الرسمية."],
              ["💡", "رؤى الاستثمار", "الاستثمار العقاري قرار مدروس يستوجب البحث والتخطيط. فريقنا جاهز لمناقشة خياراتك بكل موضوعية."],
            ].map(([icon, title, desc]) => `
              <div style="border-right:4px solid #3bcac4;border-radius:0 8px 8px 0;background:#f8feff;padding:14px 18px;margin:12px 0">
                <p style="color:#005476;font-weight:700;font-size:14px;margin:0 0 6px">${icon} ${title}</p>
                <p style="color:#666;font-size:13px;line-height:1.7;margin:0">${desc}</p>
              </div>
            `).join("")}
          </div>
          <p style="color:#888;font-size:12px;line-height:1.7;text-align:center;border-top:1px solid #f0f0f0;padding-top:16px;margin-top:8px">
            هذه المعلومات لأغراض توعوية فقط ولا تمثل نصيحة استثمارية. استشر متخصصين قبل اتخاذ أي قرار.
          </p>
          <div style="text-align:center">
            <a href="https://www.kinglikeluxury.app/consultation" style="${btnStyle()}">تواصل مع فريقنا</a>
          </div>
        `, "{{unsubscribeUrl}}");
      }
    },
  ];
}

// ─── Helpers ────────────────────────────────────────────────────────────────────
export function generateUnsubscribeToken(leadId: number): string {
  return crypto.createHmac("sha256", UNSUBSCRIBE_SECRET).update(String(leadId)).digest("hex").slice(0, 32);
}
export function verifyUnsubscribeToken(leadId: number, token: string): boolean {
  return generateUnsubscribeToken(leadId) === token;
}
function unsubscribeUrl(leadId: number): string {
  return `${APP_URL}/api/email/unsubscribe?leadId=${leadId}&token=${generateUnsubscribeToken(leadId)}`;
}

function fillTemplate(tmpl: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v || ""), tmpl);
}

// ─── DB ensure + seed ───────────────────────────────────────────────────────────
export async function ensureEmailNurturingTables(): Promise<void> {
  const client = await pool.connect();
  try {
    // Tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_nurturing_sequences (
        id          SERIAL PRIMARY KEY,
        name        TEXT    NOT NULL,
        description TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_nurturing_templates (
        id           SERIAL PRIMARY KEY,
        sequence_id  INT     NOT NULL REFERENCES email_nurturing_sequences(id) ON DELETE CASCADE,
        day_offset   INT     NOT NULL DEFAULT 0,
        sort_order   INT     NOT NULL DEFAULT 0,
        is_recurring BOOLEAN NOT NULL DEFAULT false,
        is_active    BOOLEAN NOT NULL DEFAULT true,
        subject      TEXT    NOT NULL,
        body_html    TEXT    NOT NULL,
        body_text    TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_email_sequence_status (
        id                    SERIAL PRIMARY KEY,
        lead_id               INT     NOT NULL,
        sequence_id           INT     NOT NULL REFERENCES email_nurturing_sequences(id),
        status                TEXT    NOT NULL DEFAULT 'active',
        started_at            TIMESTAMPTZ DEFAULT NOW(),
        next_send_at          TIMESTAMPTZ,
        last_sent_at          TIMESTAMPTZ,
        current_template_index INT    NOT NULL DEFAULT 0,
        pause_reason          TEXT,
        stopped_reason        TEXT,
        engagement_score      INT     NOT NULL DEFAULT 0,
        unsubscribed_at       TIMESTAMPTZ,
        updated_at            TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(lead_id, sequence_id)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS lead_email_events (
        id                 SERIAL PRIMARY KEY,
        lead_id            INT     NOT NULL,
        sequence_status_id INT,
        template_id        INT,
        event_type         TEXT    NOT NULL,
        subject            TEXT,
        body_html          TEXT,
        recipient_email    TEXT,
        metadata           JSONB,
        created_at         TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_nurturing_settings (
        id         SERIAL PRIMARY KEY,
        key        TEXT UNIQUE NOT NULL,
        value      TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lead_email_seq_status_lead ON lead_email_sequence_status(lead_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lead_email_seq_status_next ON lead_email_sequence_status(next_send_at) WHERE status='active'`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_lead_email_events_lead ON lead_email_events(lead_id)`);

    // Default settings
    const defaultSettings = [
      ["sender_name",  "Kinglike Luxury"],
      ["sender_email", "info@kinglikeluxury.app"],
      ["reply_to",     "info@kinglikeluxury.app"],
    ];
    for (const [key, value] of defaultSettings) {
      await client.query(`INSERT INTO email_nurturing_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING`, [key, value]);
    }

    // Default sequence + templates — seed on first run, migrate on version bump
    const existing = await client.query(`SELECT id FROM email_nurturing_sequences LIMIT 1`);
    const versionRow = await client.query(`SELECT value FROM email_nurturing_settings WHERE key='template_version' LIMIT 1`);
    const currentVersion = versionRow.rows[0]?.value ?? null;

    if (existing.rows.length === 0) {
      // Fresh install — create sequence and seed templates
      const seqRes = await client.query(`
        INSERT INTO email_nurturing_sequences(name, description, is_active)
        VALUES('متابعة العملاء الجدد', 'تسلسل بريد الكتروني لبناء الثقة وتعزيز التفاعل مع العملاء الجدد', true)
        RETURNING id
      `);
      const seqId = seqRes.rows[0].id;
      for (const t of defaultTemplates()) {
        await client.query(`
          INSERT INTO email_nurturing_templates
            (sequence_id, day_offset, sort_order, is_recurring, is_active, subject, body_html, body_text)
          VALUES($1,$2,$3,$4,true,$5,$6,$7)
        `, [seqId, t.day_offset, t.sort_order, t.is_recurring, t.subject, t.body_html, t.body_text]);
      }
      await client.query(`
        INSERT INTO email_nurturing_settings(key,value,updated_at) VALUES('template_version',$1,NOW())
        ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=NOW()
      `, [TEMPLATE_VERSION]);
      console.log("[EmailNurturing] Default sequence and templates seeded");

    } else if (currentVersion !== TEMPLATE_VERSION) {
      // Version mismatch — replace templates in-place (preserves lead sequence status)
      const seqId = existing.rows[0].id;
      await client.query(`DELETE FROM email_nurturing_templates WHERE sequence_id=$1`, [seqId]);
      for (const t of defaultTemplates()) {
        await client.query(`
          INSERT INTO email_nurturing_templates
            (sequence_id, day_offset, sort_order, is_recurring, is_active, subject, body_html, body_text)
          VALUES($1,$2,$3,$4,true,$5,$6,$7)
        `, [seqId, t.day_offset, t.sort_order, t.is_recurring, t.subject, t.body_html, t.body_text]);
      }
      await client.query(`
        INSERT INTO email_nurturing_settings(key,value,updated_at) VALUES('template_version',$1,NOW())
        ON CONFLICT(key) DO UPDATE SET value=$1, updated_at=NOW()
      `, [TEMPLATE_VERSION]);
      console.log(`[EmailNurturing] Templates migrated to ${TEMPLATE_VERSION}`);
    }

    console.log("[DB] Email nurturing tables ensured");
  } catch (err: any) {
    console.warn("[DB] Could not ensure email nurturing tables:", err.message);
  } finally {
    client.release();
  }
}

// ─── Get active sequence ────────────────────────────────────────────────────────
async function getActiveSequence(client: any): Promise<{ id: number; templates: any[] } | null> {
  const sq = await client.query(`SELECT id FROM email_nurturing_sequences WHERE is_active=true ORDER BY id LIMIT 1`);
  if (!sq.rows.length) return null;
  const seqId = sq.rows[0].id;
  const tmplRes = await client.query(`
    SELECT * FROM email_nurturing_templates
    WHERE sequence_id=$1 AND is_active=true
    ORDER BY sort_order ASC
  `, [seqId]);
  return { id: seqId, templates: tmplRes.rows };
}

// ─── Start nurturing for a lead ─────────────────────────────────────────────────
export async function initNurturingForLead(leadId: number, email: string | null, leadData: {
  firstName?: string | null;
  fullName?: string | null;
}): Promise<void> {
  if (!email?.trim()) {
    console.log(`[EmailNurturing] Skipping leadId=${leadId} — no email address`);
    return;
  }
  const client = await pool.connect();
  try {
    const seq = await getActiveSequence(client);
    if (!seq) { console.log("[EmailNurturing] No active sequence found"); return; }

    // Idempotent — only create if not already exists
    const existing = await client.query(
      `SELECT id FROM lead_email_sequence_status WHERE lead_id=$1 AND sequence_id=$2`,
      [leadId, seq.id]
    );
    if (existing.rows.length > 0) return;

    const now = new Date();
    // First template is day 0 — send immediately (or within scheduler window)
    const firstTemplate = seq.templates.find(t => t.sort_order === 1) || seq.templates[0];
    const nextSendAt = firstTemplate ? now : null;

    await client.query(`
      INSERT INTO lead_email_sequence_status
        (lead_id, sequence_id, status, started_at, next_send_at, current_template_index, updated_at)
      VALUES($1,$2,'active',$3,$4,0,NOW())
      ON CONFLICT(lead_id, sequence_id) DO NOTHING
    `, [leadId, seq.id, now, nextSendAt]);

    await logEvent(client, leadId, null, null, "sequence_started", null, null, email, { sequenceId: seq.id });
    console.log(`[EmailNurturing] Sequence started for leadId=${leadId}`);
  } catch (err: any) {
    console.error(`[EmailNurturing] initNurturingForLead failed leadId=${leadId}:`, err.message);
  } finally {
    client.release();
  }
}

// ─── Stop / pause / resume ──────────────────────────────────────────────────────
export async function stopNurturingForLead(leadId: number, reason: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE lead_email_sequence_status
      SET status='stopped', stopped_reason=$2, updated_at=NOW()
      WHERE lead_id=$1 AND status NOT IN ('stopped','unsubscribed')
    `, [leadId, reason]);
    console.log(`[EmailNurturing] Sequence stopped for leadId=${leadId} reason=${reason}`);
  } finally { client.release(); }
}

export async function pauseNurturingForLead(leadId: number, reason?: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE lead_email_sequence_status
      SET status='paused', pause_reason=$2, updated_at=NOW()
      WHERE lead_id=$1 AND status='active'
    `, [leadId, reason || null]);
  } finally { client.release(); }
}

export async function resumeNurturingForLead(leadId: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE lead_email_sequence_status
      SET status='active', pause_reason=NULL, updated_at=NOW()
      WHERE lead_id=$1 AND status='paused'
    `, [leadId]);
  } finally { client.release(); }
}

export async function handleLeadStatusChangeForNurturing(leadId: number, newStatus: string): Promise<void> {
  if (STOP_STATUSES.has(newStatus)) {
    await stopNurturingForLead(leadId, `lead_status:${newStatus}`);
  }
}

// ─── Unsubscribe ────────────────────────────────────────────────────────────────
export async function handleUnsubscribe(leadId: number, token: string): Promise<boolean> {
  if (!verifyUnsubscribeToken(leadId, token)) return false;
  const client = await pool.connect();
  try {
    await client.query(`
      UPDATE lead_email_sequence_status
      SET status='unsubscribed', unsubscribed_at=NOW(), updated_at=NOW()
      WHERE lead_id=$1 AND status NOT IN ('unsubscribed','stopped')
    `, [leadId]);
    await logEvent(client, leadId, null, null, "email_unsubscribed", null, null, null, {});
    console.log(`[EmailNurturing] Lead unsubscribed leadId=${leadId}`);
    return true;
  } finally { client.release(); }
}

// ─── Log event helper ───────────────────────────────────────────────────────────
async function logEvent(client: any, leadId: number, statusId: number | null, templateId: number | null,
  eventType: string, subject: string | null, bodyHtml: string | null, recipientEmail: string | null,
  metadata: Record<string, any>
): Promise<number> {
  const r = await client.query(`
    INSERT INTO lead_email_events
      (lead_id, sequence_status_id, template_id, event_type, subject, body_html, recipient_email, metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id
  `, [leadId, statusId, templateId, eventType, subject, bodyHtml, recipientEmail, JSON.stringify(metadata)]);
  return r.rows[0]?.id;
}

// ─── Update engagement score ────────────────────────────────────────────────────
async function bumpEngagement(client: any, leadId: number, points: number): Promise<void> {
  await client.query(`
    UPDATE lead_email_sequence_status SET engagement_score=engagement_score+$2, updated_at=NOW()
    WHERE lead_id=$1
  `, [leadId, points]);
}

// ─── Get settings ───────────────────────────────────────────────────────────────
async function getSettings(client: any): Promise<{ senderName: string; senderEmail: string; replyTo: string }> {
  const r = await client.query(`SELECT key, value FROM email_nurturing_settings`);
  const m: Record<string, string> = {};
  for (const row of r.rows) m[row.key] = row.value;
  return {
    senderName:  m["sender_name"]  || "Kinglike Luxury",
    senderEmail: m["sender_email"] || "info@kinglikeluxury.app",
    replyTo:     m["reply_to"]     || "info@kinglikeluxury.app",
  };
}

// ─── Send one email ─────────────────────────────────────────────────────────────
async function sendOneEmail(
  leadId: number, statusId: number, template: any,
  recipientEmail: string, leadData: { firstName?: string | null; fullName?: string | null }
): Promise<boolean> {
  const firstName = leadData.firstName || leadData.fullName?.split(" ")[0] || "عزيزي";
  const unsub = unsubscribeUrl(leadId);
  const vars = { firstName, unsubscribeUrl: unsub };
  const subject   = fillTemplate(template.subject,   vars);
  const bodyHtml  = fillTemplate(template.body_html,  vars);
  const bodyText  = fillTemplate(template.body_text || "", vars);

  const client = await pool.connect();
  try {
    const settings = await getSettings(client);
    const from = `${settings.senderName} <${settings.senderEmail}>`;

    if (!ENABLED()) {
      console.log(`[EmailNurturing] Sending disabled, would send templateId=${template.id} leadId=${leadId} to=${recipientEmail}`);
      await logEvent(client, leadId, statusId, template.id, "email_skipped_disabled", subject, bodyHtml, recipientEmail, { from });
      return true; // treat as success so sequence advances
    }

    // Get Resend key
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      console.warn("[EmailNurturing] RESEND_API_KEY not set");
      return false;
    }
    const { Resend } = await import("resend");
    const resend = new Resend(key);

    const result = await resend.emails.send({
      from,
      to: [recipientEmail],
      subject,
      html: bodyHtml,
      text: bodyText,
      replyTo: settings.replyTo,
      headers: { "List-Unsubscribe": `<${unsub}>` },
    });

    if (result.error) {
      console.error(`[EmailNurturing] Send failed leadId=${leadId}: ${result.error.message}`);
      await logEvent(client, leadId, statusId, template.id, "email_failed", subject, bodyHtml, recipientEmail, { error: result.error.message });
      return false;
    }

    await logEvent(client, leadId, statusId, template.id, "email_sent", subject, bodyHtml, recipientEmail, { resendId: result.data?.id, from });
    console.log(`[EmailNurturing] Email sent templateId=${template.id} leadId=${leadId}`);
    return true;
  } finally { client.release(); }
}

// ─── Process queue ──────────────────────────────────────────────────────────────
export async function processNurturingQueue(): Promise<void> {
  const client = await pool.connect();
  try {
    // Find due records
    const due = await client.query(`
      SELECT s.*, l.email, l.first_name, l.full_name
      FROM lead_email_sequence_status s
      JOIN crm_leads l ON l.id = s.lead_id
      WHERE s.status = 'active'
        AND s.next_send_at IS NOT NULL
        AND s.next_send_at <= NOW()
      LIMIT 50
    `);

    for (const row of due.rows) {
      const email = row.email;
      if (!email?.trim()) {
        // No email — advance or stop
        await client.query(`UPDATE lead_email_sequence_status SET status='stopped', stopped_reason='no_email', updated_at=NOW() WHERE id=$1`, [row.id]);
        continue;
      }

      // Load templates for this sequence
      const tmplRes = await client.query(`
        SELECT * FROM email_nurturing_templates
        WHERE sequence_id=$1 AND is_active=true
        ORDER BY sort_order ASC
      `, [row.sequence_id]);
      const templates = tmplRes.rows;
      if (!templates.length) continue;

      const idx = row.current_template_index;
      const template = templates[idx];
      if (!template) {
        // Sequence completed
        await client.query(`UPDATE lead_email_sequence_status SET status='completed', updated_at=NOW() WHERE id=$1`, [row.id]);
        continue;
      }

      // Send
      const ok = await sendOneEmail(row.lead_id, row.id, template, email, {
        firstName: row.first_name, fullName: row.full_name,
      });

      if (ok) {
        const nextIdx = idx + 1;
        const nextTemplate = templates[nextIdx];

        let nextSendAt: Date | null = null;
        let nextIndex = nextIdx;

        if (nextTemplate) {
          const msPerDay = 24 * 60 * 60 * 1000;
          const daysDiff = nextTemplate.day_offset - template.day_offset;
          nextSendAt = new Date(Date.now() + Math.max(1, daysDiff) * msPerDay);
        } else if (template.is_recurring) {
          // Recurring template — resend in 30 days
          nextIndex = idx; // stay on same template
          nextSendAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        } else {
          // Look for a recurring template to fall back to
          const recurring = templates.findIndex(t => t.is_recurring);
          if (recurring >= 0) {
            nextIndex = recurring;
            nextSendAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          }
          // else sequence ends — set status completed
        }

        if (nextSendAt) {
          await client.query(`
            UPDATE lead_email_sequence_status
            SET current_template_index=$2, last_sent_at=NOW(), next_send_at=$3, updated_at=NOW()
            WHERE id=$1
          `, [row.id, nextIndex, nextSendAt]);
        } else {
          await client.query(`
            UPDATE lead_email_sequence_status
            SET status='completed', last_sent_at=NOW(), updated_at=NOW()
            WHERE id=$1
          `, [row.id]);
        }
      } else {
        // On failure, retry after 4 hours (max 3 attempts implicit in daily run)
        const retryAt = new Date(Date.now() + 4 * 60 * 60 * 1000);
        await client.query(`UPDATE lead_email_sequence_status SET next_send_at=$2, updated_at=NOW() WHERE id=$1`, [row.id, retryAt]);
      }
    }
  } catch (err: any) {
    console.error("[EmailNurturing] Queue processor error:", err.message);
  } finally {
    client.release();
  }
}

// ─── Scheduler ──────────────────────────────────────────────────────────────────
let _schedulerHandle: NodeJS.Timeout | null = null;
export function startNurturingScheduler(): void {
  if (_schedulerHandle) return;
  // Run every hour
  _schedulerHandle = setInterval(() => {
    processNurturingQueue().catch(err =>
      console.error("[EmailNurturing] Scheduler tick error:", err.message)
    );
  }, 60 * 60 * 1000);
  // Run once on startup after a short delay
  setTimeout(() => processNurturingQueue().catch(() => {}), 15_000);
  console.log("[EmailNurturing] Scheduler started — runs every 60 min");
}

// ─── Handle Resend webhook ──────────────────────────────────────────────────────
export async function handleNurturingWebhookEvent(eventType: string, data: any): Promise<void> {
  // Resend sends events like email.opened, email.clicked, email.bounced, email.complained
  // We look up the event by resendId stored in our metadata
  const resendId = data?.email_id || data?.id;
  if (!resendId) return;

  const client = await pool.connect();
  try {
    // Find the matching sent event
    const ev = await client.query(`
      SELECT lead_id, sequence_status_id, id FROM lead_email_events
      WHERE event_type IN ('email_sent','email_skipped_disabled') AND metadata->>'resendId'=$1
      LIMIT 1
    `, [resendId]);
    if (!ev.rows.length) return;

    const { lead_id: leadId, sequence_status_id: statusId } = ev.rows[0];
    let ourType = "";
    let points = 0;
    switch (eventType) {
      case "email.delivered":  ourType = "email_delivered";    break;
      case "email.opened":     ourType = "email_opened";   points = 5;  break;
      case "email.clicked":    ourType = "link_clicked";   points = 10; break;
      case "email.bounced":    ourType = "email_bounced";      break;
      case "email.complained": ourType = "spam_complaint";     break;
      default: return;
    }
    await logEvent(client, leadId, statusId, null, ourType, null, null, null, data);
    if (points > 0) await bumpEngagement(client, leadId, points);
    if (ourType === "email_bounced") {
      await client.query(`UPDATE lead_email_sequence_status SET status='stopped', stopped_reason='bounced', updated_at=NOW() WHERE lead_id=$1`, [leadId]);
    }
    console.log(`[EmailNurturing] ${ourType} for leadId=${leadId}`);
  } finally { client.release(); }
}

// ─── Read APIs ──────────────────────────────────────────────────────────────────
export async function getLeadNurturingStatus(leadId: number): Promise<any> {
  const client = await pool.connect();
  try {
    const s = await client.query(`
      SELECT s.*, seq.name AS sequence_name
      FROM lead_email_sequence_status s
      JOIN email_nurturing_sequences seq ON seq.id = s.sequence_id
      WHERE s.lead_id=$1
      ORDER BY s.id DESC LIMIT 1
    `, [leadId]);
    if (!s.rows.length) return null;
    const status = s.rows[0];
    // Compute engagement label
    const score = status.engagement_score || 0;
    status.engagement_label = score >= 30 ? "high" : score >= 10 ? "medium" : "low";
    return status;
  } finally { client.release(); }
}

export async function getLeadEmailEvents(leadId: number): Promise<any[]> {
  const client = await pool.connect();
  try {
    const r = await client.query(`
      SELECT e.*, t.subject AS template_subject, t.day_offset
      FROM lead_email_events e
      LEFT JOIN email_nurturing_templates t ON t.id = e.template_id
      WHERE e.lead_id=$1
      ORDER BY e.created_at DESC
    `, [leadId]);
    return r.rows;
  } finally { client.release(); }
}

export async function getNurturingOverview(): Promise<any> {
  const client = await pool.connect();
  try {
    const stats = await client.query(`
      SELECT
        COUNT(*) FILTER(WHERE status='active')       AS active,
        COUNT(*) FILTER(WHERE status='paused')       AS paused,
        COUNT(*) FILTER(WHERE status='stopped')      AS stopped,
        COUNT(*) FILTER(WHERE status='unsubscribed') AS unsubscribed,
        COUNT(*) FILTER(WHERE status='completed')    AS completed,
        COUNT(*)                                     AS total
      FROM lead_email_sequence_status
    `);
    const events = await client.query(`
      SELECT
        COUNT(*) FILTER(WHERE event_type='email_sent')           AS sent,
        COUNT(*) FILTER(WHERE event_type='email_opened')         AS opened,
        COUNT(*) FILTER(WHERE event_type='link_clicked')         AS clicked,
        COUNT(*) FILTER(WHERE event_type='email_bounced')        AS bounced,
        COUNT(*) FILTER(WHERE event_type='email_unsubscribed')   AS unsubscribed_events
      FROM lead_email_events
    `);
    return { ...stats.rows[0], ...events.rows[0] };
  } finally { client.release(); }
}

export async function getEmailHistoryPage(params: {
  page: number; limit: number;
  search?: string; status?: string; dateFrom?: string; dateTo?: string;
}): Promise<{ rows: any[]; total: number }> {
  const client = await pool.connect();
  try {
    const { page = 1, limit = 50, search, status, dateFrom, dateTo } = params;
    const offset = (page - 1) * limit;
    const conditions: string[] = ["e.event_type IN ('email_sent','email_skipped_disabled','email_failed')"];
    const args: any[] = [];
    let idx = 1;

    if (search) {
      conditions.push(`(l.full_name ILIKE $${idx} OR l.email ILIKE $${idx} OR l.phone ILIKE $${idx})`);
      args.push(`%${search}%`); idx++;
    }
    if (status) {
      const statusMap: Record<string, string> = {
        opened: "email_opened", clicked: "link_clicked", bounced: "email_bounced",
      };
      if (statusMap[status]) {
        conditions.push(`EXISTS(SELECT 1 FROM lead_email_events e2 WHERE e2.lead_id=e.lead_id AND e2.event_type=$${idx})`);
        args.push(statusMap[status]); idx++;
      } else if (status === "not_opened") {
        conditions.push(`NOT EXISTS(SELECT 1 FROM lead_email_events e2 WHERE e2.lead_id=e.lead_id AND e2.event_type='email_opened')`);
      }
    }
    if (dateFrom) { conditions.push(`e.created_at >= $${idx}`); args.push(dateFrom); idx++; }
    if (dateTo)   { conditions.push(`e.created_at <= $${idx}`); args.push(dateTo);   idx++; }

    const where = "WHERE " + conditions.join(" AND ");
    const countRes = await client.query(
      `SELECT COUNT(*) FROM lead_email_events e LEFT JOIN crm_leads l ON l.id=e.lead_id ${where}`,
      args
    );
    const rows = await client.query(`
      SELECT e.*, l.full_name, l.email AS lead_email, l.phone,
        EXISTS(SELECT 1 FROM lead_email_events e2 WHERE e2.lead_id=e.lead_id AND e2.event_type='email_opened') AS opened,
        EXISTS(SELECT 1 FROM lead_email_events e2 WHERE e2.lead_id=e.lead_id AND e2.event_type='link_clicked') AS clicked,
        EXISTS(SELECT 1 FROM lead_email_events e2 WHERE e2.lead_id=e.lead_id AND e2.event_type='email_bounced') AS bounced
      FROM lead_email_events e
      LEFT JOIN crm_leads l ON l.id=e.lead_id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT $${idx} OFFSET $${idx+1}
    `, [...args, limit, offset]);

    return { rows: rows.rows, total: parseInt(countRes.rows[0].count) };
  } finally { client.release(); }
}

export async function getSequences(): Promise<any[]> {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT * FROM email_nurturing_sequences ORDER BY id`);
    return r.rows;
  } finally { client.release(); }
}

export async function getSequenceTemplates(sequenceId: number): Promise<any[]> {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT * FROM email_nurturing_templates WHERE sequence_id=$1 ORDER BY sort_order`, [sequenceId]);
    return r.rows;
  } finally { client.release(); }
}

export async function getNurturingSettings(): Promise<Record<string, string>> {
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT key, value FROM email_nurturing_settings`);
    const m: Record<string, string> = {};
    for (const row of r.rows) m[row.key] = row.value;
    return m;
  } finally { client.release(); }
}

export async function updateNurturingSettings(settings: Record<string, string>): Promise<void> {
  const client = await pool.connect();
  try {
    for (const [key, value] of Object.entries(settings)) {
      await client.query(`
        INSERT INTO email_nurturing_settings(key,value,updated_at) VALUES($1,$2,NOW())
        ON CONFLICT(key) DO UPDATE SET value=$2, updated_at=NOW()
      `, [key, value]);
    }
  } finally { client.release(); }
}
