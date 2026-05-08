import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Phone, Mail, Download, Search, Building2,
  Eye, ShoppingBag, ArrowLeft, FileText
} from "lucide-react";

type Lead = {
  id: number;
  username: string;
  phoneNumber: string;
  email: string;
  whatsappNumber: string;
  authMethod: string;
  isAdmin: boolean;
  isVerified: boolean;
  propertiesCount: number;
  leadType: "seller" | "browser";
  registeredAt: string;
};

// PDF labels for all 10 supported languages
const PDF_LABELS: Record<string, {
  dir: "rtl" | "ltr"; lang: string; locale: string;
  title: string; exportDate: string; total: string;
  sellers: string; browsers: string; reportTotal: string;
  num: string; username: string; phone: string; email: string;
  whatsapp: string; method: string; type: string; properties: string;
  verified: string; regDate: string;
  sellerLabel: string; browserLabel: string;
  yesLabel: string; noLabel: string;
  methods: Record<string, string>;
  footer: string;
}> = {
  ar: {
    dir: "rtl", lang: "ar", locale: "ar-EG",
    title: "Kinglike Luxury — قاعدة بيانات العملاء",
    exportDate: "تاريخ التصدير", total: "إجمالي المسجّلين",
    sellers: "رافعو عقارات", browsers: "متصفحون", reportTotal: "المعروضون في التقرير",
    num: "#", username: "المستخدم", phone: "رقم الهاتف", email: "البريد",
    whatsapp: "واتساب", method: "طريقة التسجيل", type: "النوع",
    properties: "عقارات", verified: "موثّق", regDate: "تاريخ التسجيل",
    sellerLabel: "بائع", browserLabel: "متصفح",
    yesLabel: "نعم", noLabel: "لا",
    methods: { phone: "هاتف", email: "إيميل", whatsapp: "واتساب", facebook: "فيسبوك" },
    footer: "Kinglike Luxury Real Estate Platform",
  },
  en: {
    dir: "ltr", lang: "en", locale: "en-US",
    title: "Kinglike Luxury — Leads Database",
    exportDate: "Export Date", total: "Total Registered",
    sellers: "Property Uploaders", browsers: "Browsers", reportTotal: "In This Report",
    num: "#", username: "Username", phone: "Phone", email: "Email",
    whatsapp: "WhatsApp", method: "Auth Method", type: "Type",
    properties: "Properties", verified: "Verified", regDate: "Registered At",
    sellerLabel: "Seller", browserLabel: "Browser",
    yesLabel: "Yes", noLabel: "No",
    methods: { phone: "Phone", email: "Email", whatsapp: "WhatsApp", facebook: "Facebook" },
    footer: "Kinglike Luxury Real Estate Platform",
  },
  he: {
    dir: "rtl", lang: "he", locale: "he-IL",
    title: "Kinglike Luxury — מסד נתוני לקוחות",
    exportDate: "תאריך ייצוא", total: "סה״כ רשומים",
    sellers: "מעלי נכסים", browsers: "גולשים", reportTotal: "בדוח זה",
    num: "#", username: "שם משתמש", phone: "טלפון", email: "אימייל",
    whatsapp: "ווטסאפ", method: "שיטת הרשמה", type: "סוג",
    properties: "נכסים", verified: "מאומת", regDate: "תאריך הרשמה",
    sellerLabel: "מוכר", browserLabel: "גולש",
    yesLabel: "כן", noLabel: "לא",
    methods: { phone: "טלפון", email: "אימייל", whatsapp: "ווטסאפ", facebook: "פייסבוק" },
    footer: "Kinglike Luxury Real Estate Platform",
  },
  ru: {
    dir: "ltr", lang: "ru", locale: "ru-RU",
    title: "Kinglike Luxury — База клиентов",
    exportDate: "Дата экспорта", total: "Всего зарегистрировано",
    sellers: "Продавцы", browsers: "Просматривающие", reportTotal: "В отчёте",
    num: "#", username: "Пользователь", phone: "Телефон", email: "Email",
    whatsapp: "WhatsApp", method: "Способ регистрации", type: "Тип",
    properties: "Объектов", verified: "Верифицирован", regDate: "Дата регистрации",
    sellerLabel: "Продавец", browserLabel: "Просматривающий",
    yesLabel: "Да", noLabel: "Нет",
    methods: { phone: "Телефон", email: "Email", whatsapp: "WhatsApp", facebook: "Facebook" },
    footer: "Kinglike Luxury Real Estate Platform",
  },
  tr: {
    dir: "ltr", lang: "tr", locale: "tr-TR",
    title: "Kinglike Luxury — Müşteri Veritabanı",
    exportDate: "Dışa Aktarma Tarihi", total: "Toplam Kayıtlı",
    sellers: "İlan Yükleyenler", browsers: "Gezginler", reportTotal: "Bu Raporda",
    num: "#", username: "Kullanıcı", phone: "Telefon", email: "E-posta",
    whatsapp: "WhatsApp", method: "Kayıt Yöntemi", type: "Tür",
    properties: "İlanlar", verified: "Doğrulandı", regDate: "Kayıt Tarihi",
    sellerLabel: "Satıcı", browserLabel: "Gezgin",
    yesLabel: "Evet", noLabel: "Hayır",
    methods: { phone: "Telefon", email: "E-posta", whatsapp: "WhatsApp", facebook: "Facebook" },
    footer: "Kinglike Luxury Real Estate Platform",
  },
  ka: {
    dir: "ltr", lang: "ka", locale: "ka-GE",
    title: "Kinglike Luxury — კლიენტთა ბაზა",
    exportDate: "ექსპორტის თარიღი", total: "სულ დარეგისტრირებული",
    sellers: "განცხადების ავტორები", browsers: "მომხმარებლები", reportTotal: "ანგარიშში",
    num: "#", username: "მომხმარებელი", phone: "ტელეფონი", email: "ელ-ფოსტა",
    whatsapp: "WhatsApp", method: "რეგისტრაციის მეთოდი", type: "ტიპი",
    properties: "განცხადება", verified: "დადასტურებული", regDate: "რეგისტრაციის თარიღი",
    sellerLabel: "გამყიდველი", browserLabel: "მომხმარებელი",
    yesLabel: "კი", noLabel: "არა",
    methods: { phone: "ტელეფონი", email: "ელ-ფოსტა", whatsapp: "WhatsApp", facebook: "Facebook" },
    footer: "Kinglike Luxury Real Estate Platform",
  },
  az: {
    dir: "ltr", lang: "az", locale: "az-AZ",
    title: "Kinglike Luxury — Müştəri Bazası",
    exportDate: "İxrac tarixi", total: "Cəmi qeydiyyatdan keçmiş",
    sellers: "Elan yükləyənlər", browsers: "Baxanlar", reportTotal: "Bu hesabatda",
    num: "#", username: "İstifadəçi", phone: "Telefon", email: "E-poçt",
    whatsapp: "WhatsApp", method: "Qeydiyyat üsulu", type: "Növ",
    properties: "Elanlar", verified: "Təsdiqlənmiş", regDate: "Qeydiyyat tarixi",
    sellerLabel: "Satıcı", browserLabel: "Baxan",
    yesLabel: "Bəli", noLabel: "Xeyr",
    methods: { phone: "Telefon", email: "E-poçt", whatsapp: "WhatsApp", facebook: "Facebook" },
    footer: "Kinglike Luxury Real Estate Platform",
  },
  zh: {
    dir: "ltr", lang: "zh", locale: "zh-CN",
    title: "Kinglike Luxury — 客户数据库",
    exportDate: "导出日期", total: "总注册人数",
    sellers: "房源发布者", browsers: "浏览者", reportTotal: "本报告合计",
    num: "#", username: "用户名", phone: "电话", email: "邮箱",
    whatsapp: "WhatsApp", method: "注册方式", type: "类型",
    properties: "房源数", verified: "已验证", regDate: "注册日期",
    sellerLabel: "卖家", browserLabel: "浏览者",
    yesLabel: "是", noLabel: "否",
    methods: { phone: "电话", email: "邮箱", whatsapp: "WhatsApp", facebook: "Facebook" },
    footer: "Kinglike Luxury Real Estate Platform",
  },
  pl: {
    dir: "ltr", lang: "pl", locale: "pl-PL",
    title: "Kinglike Luxury — Baza klientów",
    exportDate: "Data eksportu", total: "Łącznie zarejestrowanych",
    sellers: "Dodający oferty", browsers: "Przeglądający", reportTotal: "W tym raporcie",
    num: "#", username: "Użytkownik", phone: "Telefon", email: "E-mail",
    whatsapp: "WhatsApp", method: "Metoda rejestracji", type: "Typ",
    properties: "Oferty", verified: "Zweryfikowany", regDate: "Data rejestracji",
    sellerLabel: "Sprzedający", browserLabel: "Przeglądający",
    yesLabel: "Tak", noLabel: "Nie",
    methods: { phone: "Telefon", email: "E-mail", whatsapp: "WhatsApp", facebook: "Facebook" },
    footer: "Kinglike Luxury Real Estate Platform",
  },
  it: {
    dir: "ltr", lang: "it", locale: "it-IT",
    title: "Kinglike Luxury — Database clienti",
    exportDate: "Data esportazione", total: "Totale registrati",
    sellers: "Caricatori di annunci", browsers: "Navigatori", reportTotal: "In questo report",
    num: "#", username: "Utente", phone: "Telefono", email: "Email",
    whatsapp: "WhatsApp", method: "Metodo registrazione", type: "Tipo",
    properties: "Annunci", verified: "Verificato", regDate: "Data registrazione",
    sellerLabel: "Venditore", browserLabel: "Navigatore",
    yesLabel: "Sì", noLabel: "No",
    methods: { phone: "Telefono", email: "Email", whatsapp: "WhatsApp", facebook: "Facebook" },
    footer: "Kinglike Luxury Real Estate Platform",
  },
};

export default function LeadsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "seller" | "browser">("all");

  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) navigate("/");
  }, [user, authLoading, navigate]);

  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/admin/leads"],
    enabled: !!user?.isAdmin,
  });

  const filtered = leads.filter((l) => {
    const matchSearch =
      l.username.toLowerCase().includes(search.toLowerCase()) ||
      l.phoneNumber.includes(search) ||
      l.email.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || l.leadType === filter;
    return matchSearch && matchFilter;
  });

  const sellers = leads.filter((l) => l.leadType === "seller").length;
  const browsers = leads.filter((l) => l.leadType === "browser").length;

  const handleExport = () => {
    window.open("/api/admin/leads/export", "_blank");
  };

  const handleExportPDF = () => {
    const lang = i18n.language?.split("-")[0] || "en";
    const lb = PDF_LABELS[lang] || PDF_LABELS["en"];
    const date = new Date().toLocaleDateString(lb.locale);
    const thAlign = lb.dir === "rtl" ? "right" : "left";
    const metaAlign = lb.dir === "rtl" ? "left" : "right";

    const rows = filtered.map((l, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${l.username}</td>
        <td dir="ltr">${l.phoneNumber || "—"}</td>
        <td>${l.email || "—"}</td>
        <td dir="ltr">${l.whatsappNumber || "—"}</td>
        <td>${lb.methods[l.authMethod] || l.authMethod}</td>
        <td>${l.leadType === "seller" ? lb.sellerLabel : lb.browserLabel}</td>
        <td>${l.propertiesCount}</td>
        <td>${l.isVerified ? lb.yesLabel : lb.noLabel}</td>
        <td>${l.registeredAt ? new Date(l.registeredAt).toLocaleDateString(lb.locale) : "—"}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html>
<html lang="${lb.lang}" dir="${lb.dir}">
<head>
  <meta charset="UTF-8"/>
  <title>${lb.title}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction:${lb.dir}; background:#fff; color:#111; padding:24px; font-size:11px; }
    .header { display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:3px solid #3bcac4; padding-bottom:14px; }
    .header h1 { font-size:20px; font-weight:700; color:#005476; }
    .header .meta { font-size:10px; color:#888; text-align:${metaAlign}; }
    .stats { display:flex; gap:16px; margin-bottom:18px; }
    .stat { background:#f0fdfc; border:1px solid #3bcac4; border-radius:8px; padding:10px 18px; text-align:center; flex:1; }
    .stat .num { font-size:22px; font-weight:700; color:#005476; }
    .stat .lbl { font-size:10px; color:#555; margin-top:2px; }
    table { width:100%; border-collapse:collapse; }
    thead tr { background:linear-gradient(90deg,#3bcac4,#005476); color:#fff; }
    thead th { padding:8px 6px; font-size:10px; font-weight:600; text-align:${thAlign}; }
    tbody tr:nth-child(even) { background:#f8fffe; }
    tbody td { padding:7px 6px; border-bottom:1px solid #e5e7eb; text-align:${thAlign}; }
    .footer { margin-top:18px; text-align:center; font-size:9px; color:#aaa; border-top:1px solid #e5e7eb; padding-top:10px; }
    @media print {
      body { padding:10px; }
      @page { size: A4 landscape; margin:12mm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${lb.title}</h1>
      <p style="color:#888;font-size:10px;margin-top:4px;">${lb.exportDate}: ${date} · ${lb.reportTotal}: ${filtered.length}</p>
    </div>
    <div class="meta">
      <div style="color:#3bcac4;font-weight:700;font-size:14px;">KINGLIKE LUXURY</div>
      <div>Real Estate Platform</div>
    </div>
  </div>
  <div class="stats">
    <div class="stat"><div class="num">${leads.length}</div><div class="lbl">${lb.total}</div></div>
    <div class="stat"><div class="num">${sellers}</div><div class="lbl">${lb.sellers}</div></div>
    <div class="stat"><div class="num">${browsers}</div><div class="lbl">${lb.browsers}</div></div>
    <div class="stat"><div class="num">${filtered.length}</div><div class="lbl">${lb.reportTotal}</div></div>
  </div>
  <table>
    <thead>
      <tr>
        <th>${lb.num}</th><th>${lb.username}</th><th>${lb.phone}</th><th>${lb.email}</th>
        <th>${lb.whatsapp}</th><th>${lb.method}</th><th>${lb.type}</th>
        <th>${lb.properties}</th><th>${lb.verified}</th><th>${lb.regDate}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">${lb.footer} · ${date}</div>
  <script>window.onload = () => { window.print(); }</script>
</body>
</html>`;

    const win = window.open("", "_blank");
    if (win) {
      win.document.write(html);
      win.document.close();
    }
  };

  if (authLoading || isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-56 mb-6" />
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (!user?.isAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/admin/dashboard")}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900">قاعدة بيانات العملاء</h1>
              <p className="text-sm text-gray-500 mt-0.5">جميع المسجّلين في التطبيق — بياناتهم الكاملة</p>
            </div>
          </div>
          <div className="flex gap-2 self-start md:self-auto">
            <Button
              onClick={handleExportPDF}
              variant="outline"
              className="border-[#005476] text-[#005476] hover:bg-[#005476] hover:text-white gap-2"
            >
              <FileText className="h-4 w-4" />
              تصدير PDF
            </Button>
            <Button
              onClick={handleExport}
              className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white gap-2"
            >
              <Download className="h-4 w-4" />
              تصدير Excel
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-[#3bcac4]/10 flex items-center justify-center flex-shrink-0">
                <Users className="h-6 w-6 text-[#3bcac4]" />
              </div>
              <div>
                <p className="text-sm text-gray-500">إجمالي المسجّلين</p>
                <p className="text-3xl font-bold text-gray-900">{leads.length}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center flex-shrink-0">
                <ShoppingBag className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">رافعو عقارات</p>
                <p className="text-3xl font-bold text-gray-900">{sellers}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
                <Eye className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">متصفحون</p>
                <p className="text-3xl font-bold text-gray-900">{browsers}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Search + Filter */}
        <Card className="border-0 shadow-sm mb-6">
          <CardContent className="p-4 flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <Input
                placeholder="ابحث بالاسم أو الهاتف أو الإيميل..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pr-9 text-right"
              />
            </div>
            <div className="flex gap-2">
              {(["all", "seller", "browser"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                    filter === f
                      ? "bg-[#3bcac4] text-white border-[#3bcac4]"
                      : "bg-white text-gray-600 border-gray-200 hover:border-[#3bcac4]"
                  }`}
                >
                  {f === "all" ? "الكل" : f === "seller" ? "رافعو عقارات" : "متصفحون"}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">
              {filtered.length} عميل
            </CardTitle>
            <CardDescription>البيانات محفوظة دون انتهاء صلاحية</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/80">
                    <th className="text-right p-3 font-semibold text-gray-600">#</th>
                    <th className="text-right p-3 font-semibold text-gray-600">المستخدم</th>
                    <th className="text-right p-3 font-semibold text-gray-600">رقم الهاتف</th>
                    <th className="text-right p-3 font-semibold text-gray-600">الإيميل</th>
                    <th className="text-right p-3 font-semibold text-gray-600">طريقة التسجيل</th>
                    <th className="text-center p-3 font-semibold text-gray-600">العقارات</th>
                    <th className="text-center p-3 font-semibold text-gray-600">النوع</th>
                    <th className="text-right p-3 font-semibold text-gray-600">تاريخ التسجيل</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-12 text-gray-400">
                        <Users className="h-10 w-10 mx-auto mb-2 opacity-30" />
                        لا توجد نتائج
                      </td>
                    </tr>
                  ) : (
                    filtered.map((lead, idx) => (
                      <tr
                        key={lead.id}
                        className="border-b hover:bg-gray-50/60 transition-colors"
                      >
                        <td className="p-3 text-gray-400 text-xs">{idx + 1}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                              {lead.username.substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{lead.username}</p>
                              {lead.isAdmin && (
                                <span className="text-[10px] text-[#3bcac4] font-semibold">ADMIN</span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-3">
                          {lead.phoneNumber ? (
                            <a
                              href={`tel:${lead.phoneNumber}`}
                              className="flex items-center gap-1.5 text-[#005476] hover:underline"
                            >
                              <Phone className="h-3.5 w-3.5" />
                              <span dir="ltr">{lead.phoneNumber}</span>
                            </a>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          {lead.email ? (
                            <a
                              href={`mailto:${lead.email}`}
                              className="flex items-center gap-1.5 text-[#005476] hover:underline"
                            >
                              <Mail className="h-3.5 w-3.5" />
                              {lead.email}
                            </a>
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="p-3">
                          <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">
                            {METHOD_LABELS[lead.authMethod] || lead.authMethod}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          {lead.propertiesCount > 0 ? (
                            <span className="inline-flex items-center gap-1 text-green-700 font-semibold">
                              <Building2 className="h-3.5 w-3.5" />
                              {lead.propertiesCount}
                            </span>
                          ) : (
                            <span className="text-gray-300">0</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <Badge
                            className={
                              lead.leadType === "seller"
                                ? "bg-green-100 text-green-700 border-0"
                                : "bg-blue-50 text-blue-600 border-0"
                            }
                          >
                            {lead.leadType === "seller" ? "🏠 بائع" : "👁 متصفح"}
                          </Badge>
                        </td>
                        <td className="p-3 text-gray-500 text-xs whitespace-nowrap">
                          {lead.registeredAt
                            ? new Date(lead.registeredAt).toLocaleDateString("ar-EG", {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                              })
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
