import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useTranslation } from "react-i18next";
import { FileDown, X, Building2, ChevronDown } from "lucide-react";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import logoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";

/* ─── Static Data ─────────────────────────────────────────────────────────── */

const APARTMENT_TYPES = [
  { value: "studio", ar: "استوديو", en: "Studio", ru: "Студия", ka: "სტუდია", az: "Studiya", tr: "Stüdyo", zh: "工作室", pl: "Kawalerka", he: "סטודיו", it: "Monolocale" },
  { value: "1+1",    ar: "1 غرفة نوم + صالة", en: "1 Bedroom + Living", ru: "1 спальня + гостиная", ka: "1 საძინებელი", az: "1 yataqlı", tr: "1+1", zh: "一居室", pl: "1 sypialnia", he: "1 חדר שינה", it: "1 camera da letto" },
  { value: "2+1",    ar: "2 غرفة نوم + صالة", en: "2 Bedrooms + Living", ru: "2 спальни + гостиная", ka: "2 საძინებელი", az: "2 yataqlı", tr: "2+1", zh: "两居室", pl: "2 sypialnie", he: "2 חדרי שינה", it: "2 camere da letto" },
  { value: "3+1",    ar: "3 غرف نوم + صالة", en: "3 Bedrooms + Living", ru: "3 спальни + гостиная", ka: "3 საძინებელი", az: "3 yataqlı", tr: "3+1", zh: "三居室", pl: "3 sypialnie", he: "3 חדרי שינה", it: "3 camere da letto" },
  { value: "4+1",    ar: "4 غرف نوم + صالة", en: "4 Bedrooms + Living", ru: "4 спальни + гостиная", ka: "4 საძინებელი", az: "4 yataqlı", tr: "4+1", zh: "四居室", pl: "4 sypialnie", he: "4 חדרי שינה", it: "4 camere da letto" },
  { value: "5+1",    ar: "5 غرف نوم + صالة", en: "5 Bedrooms + Living", ru: "5 спален + гостиная", ka: "5 საძინებელი", az: "5 yataqlı", tr: "5+1", zh: "五居室", pl: "5 sypialni", he: "5 חדרי שינה", it: "5 camere da letto" },
  { value: "villa",  ar: "فيلا مستقلة", en: "Standalone Villa", ru: "Отдельная вилла", ka: "ვილა", az: "Ayrıca Villa", tr: "Müstakil Villa", zh: "独立别墅", pl: "Willa wolnostojąca", he: "וילה עצמאית", it: "Villa indipendente" },
  { value: "townhouse", ar: "تاون هاوس", en: "Townhouse", ru: "Таунхаус", ka: "ტაუნჰაუსი", az: "Taunhaus", tr: "Townhouse", zh: "联排别墅", pl: "Dom szeregowy", he: "בית עירוני", it: "Villetta a schiera" },
];

const DELIVERY_TYPES = [
  { value: "black",     ar: "هيكل خام (على الأسود)", en: "Shell & Core", ru: "Черновая отделка", ka: "შავი კარკასი", az: "Qara karkasla", tr: "Ham Teslim (Sıfır)", zh: "毛坯交付", pl: "Stan surowy", he: "גלם (קירות חשופים)", it: "Grezzo" },
  { value: "white",     ar: "تشطيب أبيض (جدران ناعمة)", en: "White Box (Plastered)", ru: "Белая отделка", ka: "თეთრი მოსაპირკეთებელი", az: "Ağ çərçivə", tr: "Beyaz Teslim (Sıva Dahil)", zh: "白盒交付", pl: "Stan deweloperski", he: "קופסה לבנה", it: "Scatola bianca" },
  { value: "half",      ar: "تشطيب نصف جاهز", en: "Semi-Finished", ru: "Полуотделка", ka: "ნახევარი გათავება", az: "Yarı bitmiş", tr: "Yarı Bitişli", zh: "半精装", pl: "Pół-gotowy", he: "גמר חלקי", it: "Semi-rifinito" },
  { value: "full",      ar: "تشطيب كامل (جاهز للسكن)", en: "Fully Finished (Move-in Ready)", ru: "Полная отделка (под ключ)", ka: "სრული გათავება", az: "Tam bitmiş", tr: "Tam Bitişli (Hazır)", zh: "精装交付", pl: "Pełne wykończenie", he: "גמר מלא (מוכן למגורים)", it: "Completamente rifinito" },
  { value: "furnished", ar: "مفروش بالكامل (تسليم المفتاح)", en: "Fully Furnished (Turnkey)", ru: "Полностью меблирован (под ключ)", ka: "სრულად ავეჯით", az: "Tam mebelli (açar təhvil)", tr: "Tam Eşyalı (Anahtar Teslim)", zh: "全装带家具交付", pl: "W pełni umeblowany (pod klucz)", he: "מרוהט במלואו (מפתח ביד)", it: "Arredato (chiavi in mano)" },
];

const LANGUAGES = [
  { code: "ar", label: "العربية", dir: "rtl" },
  { code: "en", label: "English", dir: "ltr" },
  { code: "ru", label: "Русский", dir: "ltr" },
  { code: "ka", label: "ქართული", dir: "ltr" },
  { code: "az", label: "Azərbaycan", dir: "ltr" },
  { code: "tr", label: "Türkçe", dir: "ltr" },
  { code: "zh", label: "中文", dir: "ltr" },
  { code: "pl", label: "Polski", dir: "ltr" },
  { code: "he", label: "עברית", dir: "rtl" },
  { code: "it", label: "Italiano", dir: "ltr" },
];

const PAYMENT_PERCENTAGES = [5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100];

function generateDeliveryDates() {
  const items: { value: string; label: string }[] = [];
  const months: Record<string, string[]> = {
    ar: ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"],
    en: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],
    ru: ["Янв","Фев","Мар","Апр","Май","Июн","Июл","Авг","Сен","Окт","Ноя","Дек"],
    ka: ["იანვ","თებ","მარ","აპრ","მაი","ივნ","ივლ","აგვ","სექ","ოქტ","ნოე","დეკ"],
    az: ["Yan","Fev","Mar","Apr","May","İyn","İyl","Avq","Sen","Okt","Noy","Dek"],
    tr: ["Oca","Şub","Mar","Nis","May","Haz","Tem","Ağu","Eyl","Eki","Kas","Ara"],
    zh: ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"],
    pl: ["Sty","Lut","Mar","Kwi","Maj","Cze","Lip","Sie","Wrz","Paź","Lis","Gru"],
    he: ["ינו","פבר","מרץ","אפר","מאי","יוני","יולי","אוג","ספט","אוק","נוב","דצמ"],
    it: ["Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"],
  };
  for (let y = 2026; y <= 2035; y++) {
    const startM = y === 2026 ? 5 : 0;
    for (let m = startM; m <= 11; m++) {
      items.push({ value: `${y}-${m}`, label: `${months.en[m]} ${y}` });
    }
  }
  return { items, months };
}

const { items: DELIVERY_DATES, months: MONTH_NAMES } = generateDeliveryDates();

/* ─── Label Maps ──────────────────────────────────────────────────────────── */

type LangCode = "ar"|"en"|"ru"|"ka"|"az"|"tr"|"zh"|"pl"|"he"|"it";

const T: Record<string, Record<LangCode, string>> = {
  offerTitle:      { ar:"عرض عقاري حصري", en:"Exclusive Real Estate Offer", ru:"Эксклюзивное предложение", ka:"ექსკლუზიური შეთავაზება", az:"Eksklüziv Təklif", tr:"Özel Gayrimenkul Teklifi", zh:"独家房产报价", pl:"Ekskluzywna Oferta Nieruchomości", he:"הצעת נדל\"ן בלעדית", it:"Offerta Immobiliare Esclusiva" },
  aptType:         { ar:"نوع الوحدة", en:"Unit Type", ru:"Тип квартиры", ka:"ბინის ტიპი", az:"Vahid növü", tr:"Daire Tipi", zh:"户型", pl:"Typ lokalu", he:"סוג היחידה", it:"Tipo unità" },
  floor:           { ar:"الطابق", en:"Floor", ru:"Этаж", ka:"სართული", az:"Mərtəbə", tr:"Kat", zh:"楼层", pl:"Piętro", he:"קומה", it:"Piano" },
  area:            { ar:"المساحة الإجمالية", en:"Total Area", ru:"Общая площадь", ka:"სრული ფართობი", az:"Ümumi Sahə", tr:"Toplam Alan", zh:"总面积", pl:"Powierzchnia całkowita", he:"שטח כולל", it:"Superficie totale" },
  pricePerMeter:   { ar:"سعر المتر المربع", en:"Price per m²", ru:"Цена за м²", ka:"ფასი მ²-ზე", az:"m² başına qiymət", tr:"m² Fiyatı", zh:"每平米价格", pl:"Cena za m²", he:"מחיר למ\"ר", it:"Prezzo per m²" },
  totalPrice:      { ar:"السعر الإجمالي", en:"Total Price", ru:"Общая цена", ka:"სრული ფასი", az:"Ümumi qiymət", tr:"Toplam Fiyat", zh:"总价", pl:"Cena całkowita", he:"מחיר כולל", it:"Prezzo totale" },
  downPayment:     { ar:"الدفعة الأولى", en:"Down Payment", ru:"Первоначальный взнос", ka:"პირველადი შენატანი", az:"İlkin ödəniş", tr:"Peşinat", zh:"首付款", pl:"Wpłata własna", he:"מקדמה", it:"Acconto" },
  remaining:       { ar:"المبلغ المتبقي", en:"Remaining Balance", ru:"Остаток", ka:"დარჩენილი თანხა", az:"Qalan məbləğ", tr:"Kalan Tutar", zh:"余款", pl:"Pozostała kwota", he:"יתרה", it:"Saldo rimanente" },
  installments:    { ar:"عدد الأقساط الشهرية", en:"Monthly Installments", ru:"Ежемесячные рассрочки", ka:"თვიური განვადება", az:"Aylıq taksit sayı", tr:"Aylık Taksit Sayısı", zh:"月付期数", pl:"Liczba rat miesięcznych", he:"מספר תשלומים חודשיים", it:"Rate mensili" },
  monthlyPayment:  { ar:"القسط الشهري", en:"Monthly Payment", ru:"Ежемесячный платёж", ka:"ყოველთვიური გადასახადი", az:"Aylıq ödəniş", tr:"Aylık Taksit", zh:"月供", pl:"Rata miesięczna", he:"תשלום חודשי", it:"Rata mensile" },
  deliveryType:    { ar:"نوع التشطيب والتسليم", en:"Finishing & Delivery", ru:"Отделка и тип сдачи", ka:"მოსაპირკეთებელი და ჩაბარება", az:"Bitirmə və çatdırılma növü", tr:"Bitişli ve Teslim Türü", zh:"精装交付类型", pl:"Wykończenie i odbiór", he:"סוג גמר ומסירה", it:"Finitura e consegna" },
  deliveryDate:    { ar:"موعد التسليم المتوقع", en:"Expected Delivery", ru:"Ожидаемая сдача", ka:"მოსალოდნელი ჩაბარება", az:"Gözlənilən çatdırılma", tr:"Tahmini Teslim", zh:"预计交付日期", pl:"Planowany odbiór", he:"מועד מסירה משוער", it:"Consegna prevista" },
  readyNow:        { ar:"جاهز للتسليم الفوري", en:"Ready for Immediate Delivery", ru:"Готов к немедленной сдаче", ka:"მზადაა დაუყოვნებლივ ჩაბარებისთვის", az:"Dərhal çatdırılmağa hazır", tr:"Hemen Teslime Hazır", zh:"可立即交付", pl:"Gotowy do natychmiastowego odbioru", he:"מוכן למסירה מיידית", it:"Pronto per la consegna immediata" },
  website:         { ar:"الموقع الإلكتروني", en:"Website", ru:"Сайт", ka:"ვებსაიტი", az:"Vebsayt", tr:"Web Sitesi", zh:"网站", pl:"Strona internetowa", he:"אתר", it:"Sito web" },
  contact:         { ar:"للتواصل والاستفسار", en:"Contact & Inquiries", ru:"Контакт и запросы", ka:"კონტაქტი", az:"Əlaqə", tr:"İletişim", zh:"联系我们", pl:"Kontakt", he:"צור קשר", it:"Contatti" },
  exclusiveOffer:  { ar:"عرض حصري من", en:"Exclusive Offer by", ru:"Эксклюзивное предложение от", ka:"ექსკლუზიური შეთავაზება", az:"Eksklüziv təklif", tr:"Özel Teklif:", zh:"独家报价", pl:"Oferta ekskluzywna od", he:"הצעה בלעדית של", it:"Offerta esclusiva di" },
};

function t(key: string, lang: LangCode): string {
  return T[key]?.[lang] ?? T[key]?.en ?? key;
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function ProjectOfferPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const pdfRef = useRef<HTMLDivElement>(null);

  const [selectedCountry, setSelectedCountry]   = useState("");
  const [selectedCity, setSelectedCity]         = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [apartmentType, setApartmentType]       = useState("");
  const [selectedFloors, setSelectedFloors]     = useState<number[]>([]);
  const [floorOpen, setFloorOpen]               = useState(false);
  const [totalArea, setTotalArea]               = useState("");
  const [pricePerMeter, setPricePerMeter]       = useState("");
  const [paymentPercent, setPaymentPercent]     = useState<number | null>(null);
  const [installments, setInstallments]         = useState("");
  const [deliveryType, setDeliveryType]         = useState("");
  const [deliveryDate, setDeliveryDate]         = useState("");
  const [pdfLang, setPdfLang]                   = useState<LangCode>("ar");
  const [generating, setGenerating]             = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) navigate("/");
  }, [user, authLoading, navigate]);

  const { data: projects = [] } = useQuery<any[]>({ queryKey: ["/api/projects"] });

  const allProjects = projects.map((p: any) => ({
    id: p.propertyId || p.id,
    title: p.property?.title || p.title || "",
    location: p.property?.location || p.location || "",
    images: p.property?.images || p.images || [],
    developer: p.developer || "",
  }));

  const locParts = (loc: string) => {
    const parts = loc.split(",").map((s: string) => s.trim());
    return { city: parts[0] || "", country: parts[parts.length - 1] || "" };
  };

  const countries = [...new Set(allProjects.map((p) => locParts(p.location).country).filter(Boolean))];
  const cities    = [...new Set(
    allProjects
      .filter((p) => !selectedCountry || locParts(p.location).country === selectedCountry)
      .map((p) => locParts(p.location).city)
      .filter(Boolean)
  )];
  const filteredProjects = allProjects.filter((p) => {
    const lp = locParts(p.location);
    return (!selectedCountry || lp.country === selectedCountry) && (!selectedCity || lp.city === selectedCity);
  });

  const selectedProject = allProjects.find((p) => p.id === selectedProjectId);

  const totalPrice       = totalArea && pricePerMeter ? parseFloat(totalArea) * parseFloat(pricePerMeter) : 0;
  const downPayment      = paymentPercent ? (totalPrice * paymentPercent) / 100 : 0;
  const remainingBalance = totalPrice - downPayment;
  const monthlyInstall   = installments && parseInt(installments) > 0 ? remainingBalance / parseInt(installments) : 0;

  const toggleFloor = (f: number) =>
    setSelectedFloors((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f].sort((a, b) => a - b));

  const getLangVal = (obj: any, lang: string): string => {
    if (typeof obj === "string") return obj;
    return obj?.[lang] || obj?.en || "";
  };

  const getAptLabel     = (val: string) => getLangVal(APARTMENT_TYPES.find((t) => t.value === val), pdfLang);
  const getDelivLabel   = (val: string) => getLangVal(DELIVERY_TYPES.find((t) => t.value === val), pdfLang);

  const getDateLabel = (val: string): string => {
    if (val === "ready") return t("readyNow", pdfLang);
    const [y, m] = val.split("-").map(Number);
    const mNames = MONTH_NAMES[pdfLang] || MONTH_NAMES.en;
    return `${mNames[m]} ${y}`;
  };

  const floorsLabel = (floors: number[]): string => {
    if (floors.length === 0) return "";
    if (floors.length === 1) return `${floors[0]}`;
    const consecutive = floors.every((f, i) => i === 0 || f === floors[i - 1] + 1);
    if (consecutive && floors.length > 2) return `${floors[0]} – ${floors[floors.length - 1]}`;
    return floors.join(", ");
  };

  const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));
  const isRTL = pdfLang === "ar" || pdfLang === "he";

  /* ── PDF generation ────────────────────────────────────────────────────── */
  const generatePDF = async () => {
    if (!selectedProject) return;
    setGenerating(true);
    try {
      const el = pdfRef.current;
      if (!el) return;
      el.style.display = "block";
      await new Promise((r) => setTimeout(r, 500));
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: false,
      });
      el.style.display = "none";
      const imgData  = canvas.toDataURL("image/jpeg", 0.92);
      const pdf      = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pw       = pdf.internal.pageSize.getWidth();
      const ph       = pdf.internal.pageSize.getHeight();
      const imgRatio = canvas.height / canvas.width;
      const imgH     = pw * imgRatio;
      let rendered = 0;
      while (rendered < imgH) {
        if (rendered > 0) pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, -rendered, pw, imgH);
        rendered += ph;
      }
      const fileName = (selectedProject.title || "offer").replace(/\s+/g, "_");
      pdf.save(`${fileName}-offer.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  if (authLoading) return (
    <div className="flex justify-center items-center min-h-screen">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#3bcac4]" />
    </div>
  );
  if (!user?.isAdmin) return null;

  /* ── Images for preview in form ─ */
  const previewImages = selectedProject?.images?.slice(0, 3) ?? [];

  return (
    <div className="min-h-screen bg-gray-50 pb-24" dir="rtl">
      <div className="max-w-2xl mx-auto px-4 pt-6 space-y-4">

        {/* ── Page header ── */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#005476]">إنشاء عرض للمشاريع</h1>
            <p className="text-xs text-gray-500">أنشئ عرضاً احترافياً وقابلاً للتحميل بصيغة PDF</p>
          </div>
        </div>

        {/* ── Location & Project ── */}
        <Card>
          <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm text-[#005476]">📍 الموقع والمشروع</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500 mb-1 block">الدولة</Label>
                <Select value={selectedCountry} onValueChange={(v) => { setSelectedCountry(v); setSelectedCity(""); setSelectedProjectId(null); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>{countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-gray-500 mb-1 block">المدينة</Label>
                <Select value={selectedCity} onValueChange={(v) => { setSelectedCity(v); setSelectedProjectId(null); }}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر" /></SelectTrigger>
                  <SelectContent>{cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">المشروع</Label>
              <Select value={selectedProjectId?.toString() ?? ""} onValueChange={(v) => setSelectedProjectId(parseInt(v))}>
                <SelectTrigger className="h-9"><SelectValue placeholder="اختر المشروع" /></SelectTrigger>
                <SelectContent>
                  {filteredProjects.length === 0
                    ? <SelectItem value="_none" disabled>لا توجد مشاريع</SelectItem>
                    : filteredProjects.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {/* Image preview strip */}
            {previewImages.length > 0 && (
              <div className="flex gap-2">
                {previewImages.map((img, i) => (
                  <img key={i} src={img} className={`object-cover rounded-lg border border-gray-200 ${i === 0 ? "h-24 flex-1" : "h-24 w-28"}`} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Apartment details ── */}
        <Card>
          <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm text-[#005476]">🏠 تفاصيل الوحدة</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">نوع الوحدة</Label>
              <Select value={apartmentType} onValueChange={setApartmentType}>
                <SelectTrigger className="h-9"><SelectValue placeholder="اختر نوع الوحدة" /></SelectTrigger>
                <SelectContent>{APARTMENT_TYPES.map((tp) => <SelectItem key={tp.value} value={tp.value}>{tp.ar}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {/* Floor multi-select */}
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">الطابق</Label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setFloorOpen(!floorOpen)}
                  className="w-full h-9 border border-input rounded-md px-3 text-sm flex items-center justify-between bg-white text-right"
                >
                  <span className={selectedFloors.length === 0 ? "text-gray-400 text-sm" : "text-sm"}>
                    {selectedFloors.length === 0 ? "اختر الطوابق" : selectedFloors.map((f) => `${f}`).join("، ")}
                  </span>
                  <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                </button>
                {floorOpen && (
                  <div className="absolute top-10 right-0 z-50 bg-white border rounded-md shadow-lg max-h-52 overflow-y-auto w-full">
                    <div className="grid grid-cols-6 gap-1 p-2">
                      {Array.from({ length: 65 }, (_, i) => i + 1).map((f) => (
                        <label key={f} className="flex items-center gap-1 p-1 rounded hover:bg-gray-50 cursor-pointer text-xs justify-center">
                          <Checkbox checked={selectedFloors.includes(f)} onCheckedChange={() => toggleFloor(f)} />
                          <span>{f}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {selectedFloors.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {selectedFloors.map((f) => (
                    <Badge key={f} variant="secondary" className="text-xs gap-1 bg-[#3bcac4]/10 text-[#005476] border border-[#3bcac4]/20">
                      طابق {f} <X className="h-3 w-3 cursor-pointer" onClick={() => toggleFloor(f)} />
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Pricing ── */}
        <Card>
          <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm text-[#005476]">💰 التسعير والدفع</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500 mb-1 block">المساحة (م²)</Label>
                <Input type="number" placeholder="مثال: 85" value={totalArea} onChange={(e) => setTotalArea(e.target.value)} className="h-9 text-right" dir="ltr" />
              </div>
              <div>
                <Label className="text-xs text-gray-500 mb-1 block">سعر المتر ($)</Label>
                <Input type="number" placeholder="مثال: 1500" value={pricePerMeter} onChange={(e) => setPricePerMeter(e.target.value)} className="h-9 text-right" dir="ltr" />
              </div>
            </div>

            {totalPrice > 0 && (
              <div className="rounded-lg bg-gradient-to-l from-[#005476] to-[#3bcac4] p-3 text-white flex justify-between items-center">
                <span className="text-sm font-medium opacity-90">السعر الإجمالي</span>
                <span className="text-xl font-bold">${fmt(totalPrice)}</span>
              </div>
            )}

            {/* Down payment % */}
            <div>
              <Label className="text-xs text-gray-500 mb-1.5 block">الدفعة الأولى (%)</Label>
              <div className="grid grid-cols-5 gap-1.5">
                {PAYMENT_PERCENTAGES.map((p) => (
                  <button
                    key={p} type="button"
                    onClick={() => setPaymentPercent(paymentPercent === p ? null : p)}
                    className={`py-1.5 rounded-md text-xs font-semibold border transition-all ${paymentPercent === p ? "bg-[#3bcac4] text-white border-[#3bcac4] shadow-sm" : "bg-white text-gray-600 border-gray-200 hover:border-[#3bcac4]"}`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              {paymentPercent && totalPrice > 0 && (
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div className="bg-[#3bcac4]/10 rounded-lg p-2 text-center border border-[#3bcac4]/20">
                    <div className="text-xs text-gray-500 mb-0.5">الدفعة الأولى ({paymentPercent}%)</div>
                    <div className="font-bold text-[#005476]">${fmt(downPayment)}</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center border border-gray-200">
                    <div className="text-xs text-gray-500 mb-0.5">المبلغ المتبقي</div>
                    <div className="font-bold text-gray-700">${fmt(remainingBalance)}</div>
                  </div>
                </div>
              )}
            </div>

            {/* Installments */}
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">عدد الأقساط الشهرية</Label>
              <Input type="number" placeholder="مثال: 36 شهراً" value={installments} onChange={(e) => setInstallments(e.target.value)} className="h-9 text-right" dir="ltr" />
              {monthlyInstall > 0 && (
                <div className="mt-2 bg-[#005476]/5 rounded-lg p-2.5 text-center border border-[#005476]/15">
                  <span className="text-xs text-gray-500">القسط الشهري </span>
                  <span className="font-bold text-[#005476] text-base">${fmt(monthlyInstall)}</span>
                  <span className="text-xs text-gray-400"> × {installments} شهر</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Delivery ── */}
        <Card>
          <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm text-[#005476]">🔑 التشطيب والتسليم</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">نوع التشطيب</Label>
              <Select value={deliveryType} onValueChange={setDeliveryType}>
                <SelectTrigger className="h-9"><SelectValue placeholder="اختر نوع التشطيب" /></SelectTrigger>
                <SelectContent>{DELIVERY_TYPES.map((d) => <SelectItem key={d.value} value={d.value}>{d.ar}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">موعد تسليم المشروع</Label>
              <Select value={deliveryDate} onValueChange={setDeliveryDate}>
                <SelectTrigger className="h-9"><SelectValue placeholder="اختر الموعد" /></SelectTrigger>
                <SelectContent className="max-h-56">
                  <SelectItem value="ready">✅ جاهز للتسليم الفوري</SelectItem>
                  {DELIVERY_DATES.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* ── PDF Language + Generate ── */}
        <Card className="border-[#3bcac4]/30 bg-gradient-to-br from-white to-[#3bcac4]/5">
          <CardHeader className="pb-2 pt-4"><CardTitle className="text-sm text-[#005476]">📄 لغة وتحميل الـ PDF</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-5 gap-1.5">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code} type="button"
                  onClick={() => setPdfLang(lang.code as LangCode)}
                  className={`py-1.5 rounded-md text-xs font-medium border transition-all ${pdfLang === lang.code ? "bg-[#005476] text-white border-[#005476]" : "bg-white text-gray-600 border-gray-200 hover:border-[#005476]"}`}
                >
                  {lang.label}
                </button>
              ))}
            </div>
            <Button
              onClick={generatePDF}
              disabled={!selectedProject || generating}
              className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90 gap-2 h-11 text-base"
            >
              <FileDown className="h-5 w-5" />
              {generating ? "جارٍ إنشاء الملف..." : "تحميل العرض PDF"}
            </Button>
            {!selectedProject && <p className="text-xs text-center text-gray-400">يرجى اختيار مشروع أولاً</p>}
          </CardContent>
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          HIDDEN PDF TEMPLATE  —  A4 794px wide, rendered by html2canvas
      ══════════════════════════════════════════════════════════════════════ */}
      <div ref={pdfRef} style={{ display: "none", position: "fixed", top: 0, left: 0, zIndex: -999 }}>
        {selectedProject && (
          <PDFTemplate
            project={selectedProject}
            lang={pdfLang}
            isRTL={isRTL}
            apartmentType={apartmentType}
            selectedFloors={selectedFloors}
            totalArea={totalArea}
            pricePerMeter={pricePerMeter}
            totalPrice={totalPrice}
            paymentPercent={paymentPercent}
            downPayment={downPayment}
            remainingBalance={remainingBalance}
            installments={installments}
            monthlyInstall={monthlyInstall}
            deliveryType={deliveryType}
            deliveryDate={deliveryDate}
            getAptLabel={getAptLabel}
            getDelivLabel={getDelivLabel}
            getDateLabel={getDateLabel}
            floorsLabel={floorsLabel}
            fmt={fmt}
          />
        )}
      </div>
    </div>
  );
}

/* ─── PDF Template Component ──────────────────────────────────────────────── */

function PDFTemplate({
  project, lang, isRTL,
  apartmentType, selectedFloors, totalArea, pricePerMeter,
  totalPrice, paymentPercent, downPayment, remainingBalance,
  installments, monthlyInstall, deliveryType, deliveryDate,
  getAptLabel, getDelivLabel, getDateLabel, floorsLabel, fmt
}: any) {

  const W   = 794;   // A4 px @96dpi
  const dir = isRTL ? "rtl" : "ltr";
  const fontFamily = '"Arial", "Helvetica Neue", sans-serif';

  // Build rows array dynamically — only filled fields
  const rows: { label: string; value: string; highlight?: boolean }[] = [];
  if (apartmentType)       rows.push({ label: t("aptType", lang),       value: getAptLabel(apartmentType) });
  if (selectedFloors.length) rows.push({ label: t("floor", lang),       value: floorsLabel(selectedFloors) });
  if (totalArea)           rows.push({ label: t("area", lang),           value: `${totalArea} m²` });
  if (pricePerMeter)       rows.push({ label: t("pricePerMeter", lang), value: `$${fmt(parseFloat(pricePerMeter))} / m²` });
  if (totalPrice)          rows.push({ label: t("totalPrice", lang),    value: `$${fmt(totalPrice)}`, highlight: true });
  if (paymentPercent)      rows.push({ label: `${t("downPayment", lang)} (${paymentPercent}%)`, value: `$${fmt(downPayment)}` });
  if (paymentPercent)      rows.push({ label: t("remaining", lang),     value: `$${fmt(remainingBalance)}` });
  if (installments)        rows.push({ label: t("installments", lang),  value: `${installments}` });
  if (monthlyInstall > 0)  rows.push({ label: t("monthlyPayment", lang), value: `$${fmt(monthlyInstall)}`, highlight: true });
  if (deliveryType)        rows.push({ label: t("deliveryType", lang),  value: getDelivLabel(deliveryType) });
  if (deliveryDate)        rows.push({ label: t("deliveryDate", lang),  value: getDateLabel(deliveryDate) });

  // Images
  const imgs: string[] = project.images ?? [];
  const hero    = imgs[0] ?? null;
  const thumb1  = imgs[1] ?? null;
  const thumb2  = imgs[2] ?? null;

  return (
    <div style={{ width: W, backgroundColor: "#fff", fontFamily, direction: dir, overflow: "hidden" }}>

      {/* ── 1. Header gradient banner ────────────────────────────────────── */}
      <div style={{ background: "linear-gradient(135deg, #005476 0%, #3bcac4 100%)", padding: "28px 36px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.75)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>
            {t("exclusiveOffer", lang)} KINGLIKE LUXURY
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#fff", lineHeight: 1.2, maxWidth: 420 }}>
            {project.title}
          </div>
          {project.location && (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.8)", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
              📍 {project.location}
            </div>
          )}
        </div>
        <img src={logoPath} alt="Kinglike" crossOrigin="anonymous"
          style={{ height: 80, width: "auto", objectFit: "contain", filter: "brightness(0) invert(1)", flexShrink: 0 }} />
      </div>

      {/* ── 2. Image grid ────────────────────────────────────────────────── */}
      {hero && (
        <div style={{ padding: "0 0 0 0" }}>
          {/* Hero full-width */}
          <img src={hero} crossOrigin="anonymous"
            style={{ width: "100%", height: 300, objectFit: "cover", display: "block" }} />
          {/* Two thumbnails side by side */}
          {(thumb1 || thumb2) && (
            <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
              {thumb1 && <img src={thumb1} crossOrigin="anonymous"
                style={{ flex: 1, height: 160, objectFit: "cover" }} />}
              {thumb2 && <img src={thumb2} crossOrigin="anonymous"
                style={{ flex: 1, height: 160, objectFit: "cover" }} />}
            </div>
          )}
        </div>
      )}

      {/* ── 3. Offer title bar ───────────────────────────────────────────── */}
      <div style={{ background: "#f8f9fa", borderTop: "4px solid #3bcac4", padding: "14px 36px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#005476", letterSpacing: 0.5 }}>
          {t("offerTitle", lang)}
        </div>
        {totalPrice > 0 && (
          <div style={{ background: "linear-gradient(135deg, #3bcac4, #005476)", borderRadius: 8, padding: "8px 20px", textAlign: "center" }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.85)", letterSpacing: 1, marginBottom: 2 }}>{t("totalPrice", lang).toUpperCase()}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>${fmt(totalPrice)}</div>
          </div>
        )}
      </div>

      {/* ── 4. Details grid ──────────────────────────────────────────────── */}
      <div style={{ padding: "20px 36px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {rows.filter((r) => r.label !== t("totalPrice", lang)).map((row, i) => (
            <div key={i} style={{
              borderRadius: 10,
              padding: "12px 16px",
              background: row.highlight ? "linear-gradient(135deg, #005476, #3bcac4)" : "#f1f5f9",
              border: row.highlight ? "none" : "1px solid #e2e8f0",
              direction: dir,
            }}>
              <div style={{ fontSize: 10, color: row.highlight ? "rgba(255,255,255,0.8)" : "#64748b", marginBottom: 4, letterSpacing: 0.5, textTransform: "uppercase" }}>
                {row.label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: row.highlight ? "#fff" : "#1e293b", lineHeight: 1.3 }}>
                {row.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 5. Footer ────────────────────────────────────────────────────── */}
      <div style={{ background: "#005476", padding: "20px 36px", display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <div>
          <img src={logoPath} alt="Kinglike" crossOrigin="anonymous"
            style={{ height: 52, width: "auto", objectFit: "contain", filter: "brightness(0) invert(1)", display: "block", marginBottom: 8 }} />
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)" }}>
            {t("contact", lang)}
          </div>
        </div>
        <div style={{ textAlign: isRTL ? "left" : "right" }}>
          <div style={{ color: "#3bcac4", fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
            www.kinglikeluxury.app
          </div>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 18, letterSpacing: 1 }}>
            +995 591 00 00 58
          </div>
        </div>
      </div>

    </div>
  );
}
