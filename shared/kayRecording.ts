export const KAY_RECORDING_NOTICE_TEMPLATE =
  "مرحبا {name}، معك كاي. حبيت أحكي معك عن تقرير اليوم بخصوص العملاء، علمًا أن المكالمة مسجلة لضمان جودة الخدمة.";

export function buildKayRecordingNotice(name: string): string {
  const safeName = String(name || "الزميل").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return KAY_RECORDING_NOTICE_TEMPLATE.replace("{name}", safeName || "الزميل");
}