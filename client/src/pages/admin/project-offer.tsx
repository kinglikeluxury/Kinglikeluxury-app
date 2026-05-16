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
import { toPng } from "html-to-image";
import logoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";
import fp1 from "@assets/Untitled_design_20260515_130154_0000_1778839490182.png";
import fp2 from "@assets/20260515_125957_0000_1778839490183.png";
import fp3 from "@assets/20260515_125940_0000_1778839490192.png";
import fp4 from "@assets/20260515_125858_0000_1778839490192.png";
import fp5 from "@assets/20260515_125830_0000_1778839490193.png";

const FLOOR_PLANS = [
  { id: "fp1", src: fp1, label: "4 غرف" },
  { id: "fp2", src: fp2, label: "استوديو" },
  { id: "fp3", src: fp3, label: "1+1 (أ)" },
  { id: "fp4", src: fp4, label: "2+1 (أ)" },
  { id: "fp5", src: fp5, label: "2+1 (ب)" },
];

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

/* ─── Image → base64 helper ──────────────────────────────────────────────── */
async function imgToBase64(url: string): Promise<string> {
  try {
    const resp = await fetch(url, { mode: "cors", cache: "force-cache" });
    const blob = await resp.blob();
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload  = () => res(reader.result as string);
      reader.onerror = () => rej(new Error("read error"));
      reader.readAsDataURL(blob);
    });
  } catch {
    return url; // fallback to original if CORS blocked
  }
}

/* ─── Label Maps ──────────────────────────────────────────────────────────── */

type LangCode = "ar"|"en"|"ru"|"ka"|"az"|"tr"|"zh"|"pl"|"he"|"it";

const T: Record<string, Record<LangCode, string>> = {
  offerTitle:     { ar:"عرض عقاري حصري", en:"Exclusive Property Offer", ru:"Эксклюзивное предложение", ka:"ექსკლუზიური შეთავაზება", az:"Eksklüziv Əmlak Təklifi", tr:"Özel Gayrimenkul Teklifi", zh:"独家房产报价单", pl:"Ekskluzywna Oferta Nieruchomości", he:"הצעת נדל\"ן בלעדית", it:"Offerta Immobiliare Esclusiva" },
  aptType:        { ar:"نوع الوحدة السكنية", en:"Unit Type", ru:"Тип объекта", ka:"ბინის ტიპი", az:"Mənzil növü", tr:"Daire Tipi", zh:"户型", pl:"Typ mieszkania", he:"סוג הדירה", it:"Tipologia unità" },
  block:          { ar:"البلوك", en:"Block", ru:"Блок", ka:"ბლოკი", az:"Blok", tr:"Blok", zh:"楼栋", pl:"Blok", he:"בלוק", it:"Blocco" },
  floor:          { ar:"الطابق", en:"Floor", ru:"Этаж", ka:"სართული", az:"Mərtəbə", tr:"Kat", zh:"所在楼层", pl:"Piętro", he:"קומה", it:"Piano" },
  area:           { ar:"المساحة الإجمالية", en:"Total Area", ru:"Общая площадь", ka:"სრული ფართობი", az:"Ümumi sahə", tr:"Toplam Alan", zh:"建筑面积", pl:"Powierzchnia całkowita", he:"שטח כולל", it:"Superficie totale" },
  pricePerMeter:  { ar:"سعر المتر المربع", en:"Price per m²", ru:"Цена за 1 м²", ka:"ფასი 1 მ²-ზე", az:"1 m² qiyməti", tr:"m² Birim Fiyatı", zh:"每平米单价", pl:"Cena za 1 m²", he:"מחיר למ\"ר", it:"Prezzo al m²" },
  totalPrice:     { ar:"السعر الإجمالي", en:"Total Price", ru:"Итоговая цена", ka:"სრული ღირებულება", az:"Ümumi qiymət", tr:"Toplam Fiyat", zh:"总价", pl:"Cena całkowita", he:"מחיר כולל", it:"Prezzo totale" },
  discount:       { ar:"نسبة الخصم", en:"Discount", ru:"Скидка", ka:"ფასდაკლება", az:"Endirim", tr:"İndirim", zh:"折扣", pl:"Zniżka", he:"הנחה", it:"Sconto" },
  priceAfterDiscount: { ar:"السعر بعد الخصم", en:"Price After Discount", ru:"Цена со скидкой", ka:"ფასი ფასდაკლებით", az:"Endirimdən sonra qiymət", tr:"İndirimli Fiyat", zh:"折后价格", pl:"Cena po zniżce", he:"מחיר לאחר הנחה", it:"Prezzo scontato" },
  downPayment:    { ar:"الدفعة الأولى", en:"Down Payment", ru:"Первоначальный взнос", ka:"პირველადი შენატანი", az:"İlkin ödəniş", tr:"Peşinat", zh:"首付款", pl:"Wpłata własna", he:"מקדמה", it:"Acconto iniziale" },
  remaining:      { ar:"المبلغ المتبقي (التقسيط)", en:"Remaining (Installment)", ru:"Остаток (рассрочка)", ka:"დარჩენილი (განვადება)", az:"Qalan məbləğ (taksit)", tr:"Kalan Tutar (Taksit)", zh:"余款（分期）", pl:"Pozostało (rata)", he:"יתרה (תשלומים)", it:"Saldo a rate" },
  installments:   { ar:"عدد الأقساط الشهرية", en:"No. of Monthly Installments", ru:"Количество месяцев рассрочки", ka:"ყოველთვიური განვადების რაოდენობა", az:"Aylıq taksit sayı", tr:"Aylık Taksit Adedi", zh:"分期期数（月）", pl:"Liczba rat miesięcznych", he:"מספר תשלומים חודשיים", it:"N. rate mensili" },
  monthlyPayment: { ar:"قيمة القسط الشهري", en:"Monthly Installment", ru:"Ежемесячный платёж", ka:"ყოველთვიური გადასახადი", az:"Aylıq taksit məbləği", tr:"Aylık Taksit Tutarı", zh:"月供金额", pl:"Wysokość raty miesięcznej", he:"תשלום חודשי", it:"Rata mensile" },
  deliveryType:   { ar:"نوع التشطيب", en:"Finishing Type", ru:"Тип отделки", ka:"მოსაპირკეთებლის ტიპი", az:"Bitirmə növü", tr:"Teslim ve Bitişlik Tipi", zh:"装修交付标准", pl:"Standard wykończenia", he:"סוג הגמר", it:"Tipologia di finitura" },
  deliveryDate:   { ar:"موعد تسليم المشروع", en:"Project Delivery Date", ru:"Дата сдачи проекта", ka:"პროექტის ჩაბარების თარიღი", az:"Proyektin çatdırılma tarixi", tr:"Proje Teslim Tarihi", zh:"项目交付日期", pl:"Termin oddania projektu", he:"תאריך מסירת הפרויקט", it:"Data consegna progetto" },
  readyNow:       { ar:"جاهز للتسليم الفوري", en:"Ready for Immediate Delivery", ru:"Готов к немедленной сдаче", ka:"მზადაა — შეიძლება ახლავე ჩაბარება", az:"Dərhal çatdırılmağa hazır", tr:"Hemen Teslime Hazır", zh:"现房可立即交付", pl:"Gotowy — odbiór natychmiastowy", he:"מוכן למסירה מיידית", it:"Pronto per consegna immediata" },
  contact:        { ar:"للتواصل والاستفسار", en:"Contact & Inquiries", ru:"Связь и вопросы", ka:"კონტაქტი", az:"Əlaqə", tr:"İletişim ve Bilgi", zh:"联系与咨询", pl:"Kontakt i zapytania", he:"צור קשר", it:"Contatti e informazioni" },
  exclusiveOffer: { ar:"عرض حصري من شركة", en:"Exclusive offer presented by", ru:"Эксклюзивное предложение от", ka:"ექსკლუზიური შეთავაზება", az:"Eksklüziv təklif:", tr:"Özel Teklif — ", zh:"独家报价由", pl:"Oferta ekskluzywna od", he:"הצעה בלעדית מאת", it:"Offerta esclusiva di" },
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
  const [selectedBlock, setSelectedBlock]       = useState("");
  const [selectedFloors, setSelectedFloors]     = useState<number[]>([]);
  const [floorOpen, setFloorOpen]               = useState(false);
  const [totalArea, setTotalArea]               = useState("");
  const [pricePerMeter, setPricePerMeter]       = useState("");
  const [paymentPercent, setPaymentPercent]     = useState<number | null>(null);
  const [installments, setInstallments]         = useState("");
  const [deliveryType, setDeliveryType]         = useState("");
  const [deliveryDate, setDeliveryDate]         = useState("");
  const [selectedFloorPlan, setSelectedFloorPlan] = useState<string>("");
  const [discountPercent, setDiscountPercent]   = useState("");
  const [pdfLang, setPdfLang]                   = useState<LangCode>("ar");
  const [generating, setGenerating]             = useState(false);
  const [b64Images, setB64Images]               = useState<string[]>([]);
  const [floorPlanB64, setFloorPlanB64]         = useState<string>("");
  const [flagB64, setFlagB64]                   = useState<string>("");

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

  // Hardcoded countries and cities — not dependent on existing project data
  const COUNTRY_CITY_MAP: Record<string, string[]> = {
    "Georgia": ["Tbilisi", "Batumi", "Kutaisi", "Rustavi", "Zugdidi", "Gori", "Poti", "Telavi", "Mtskheta", "Kobuleti", "Borjomi", "Akhaltsikhe", "Senaki", "Anaklia", "Sighnaghi", "Ambrolauri", "Khashuri", "Samtredia", "Zestafoni", "Chiatura"],
    "UAE": ["Dubai", "Sharjah", "Ras Al Khaimah", "Abu Dhabi", "Ajman", "Fujairah", "Umm Al Quwain"],
    "Northern Cyprus (TRNC)": ["Lefkoşa (Nicosia)", "Gazimağusa (Famagusta)", "Girne (Kyrenia)", "İskele", "Güzelyurt", "Esentepe"],
    "Turkey": ["İstanbul", "Trabzon", "Ankara", "İzmir", "Antalya", "Bursa", "Alanya", "Mersin"],
  };

  const countries = Object.keys(COUNTRY_CITY_MAP);
  const cities    = selectedCountry ? (COUNTRY_CITY_MAP[selectedCountry] || []) : [];

  const filteredProjects = allProjects.filter((p) => {
    const lp = locParts(p.location);
    return (!selectedCountry || lp.country === selectedCountry) && (!selectedCity || lp.city === selectedCity);
  });

  const selectedProject = allProjects.find((p) => p.id === selectedProjectId);

  const totalPrice       = totalArea && pricePerMeter ? parseFloat(totalArea) * parseFloat(pricePerMeter) : 0;
  const discountVal      = discountPercent && parseFloat(discountPercent) > 0 ? parseFloat(discountPercent) : 0;
  const discountedPrice  = discountVal > 0 ? totalPrice * (1 - discountVal / 100) : totalPrice;
  const downPayment      = paymentPercent ? (discountedPrice * paymentPercent) / 100 : 0;
  const remainingBalance = discountedPrice - downPayment;
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

  /* ── Draw Georgia flag on a canvas → base64 PNG ── */
  const makeGeorgiaFlagB64 = (): string => {
    const c = document.createElement("canvas");
    c.width = 90; c.height = 60;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 90, 60);
    ctx.fillStyle = "#FF0000";
    ctx.fillRect(37, 0, 16, 60);   // vertical bar
    ctx.fillRect(0, 22, 90, 16);   // horizontal bar
    // four small crosses
    const cross = (x: number, y: number) => {
      ctx.fillRect(x + 5, y, 6, 15); ctx.fillRect(x, y + 5, 16, 5);
    };
    cross(4, 2); cross(52, 2); cross(4, 43); cross(52, 43);
    return c.toDataURL("image/png");
  };

  /* ── PDF generation — html-to-image (SVG renderer = perfect Arabic) ────── */
  const generatePDF = async () => {
    if (!selectedProject) return;
    setGenerating(true);
    try {
      // 1. Load Arabic fonts into this document before capture
      if (!document.getElementById("arabic-fonts-pdf")) {
        const link = document.createElement("link");
        link.id   = "arabic-fonts-pdf";
        link.rel  = "stylesheet";
        link.href = "https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&family=Tajawal:wght@400;500;700;900&family=Noto+Sans+Arabic:wght@400;600;700&display=swap";
        document.head.appendChild(link);
      }
      await document.fonts.ready;

      // 2. Pre-load all images as base64 (required for html-to-image cross-origin)
      const rawUrls: string[] = selectedProject.images?.slice(0, 2) ?? [];
      const [loaded, fpB64] = await Promise.all([
        Promise.all(rawUrls.map((u: string) => imgToBase64(u))),
        selectedFloorPlan ? imgToBase64(selectedFloorPlan) : Promise.resolve(""),
      ]);
      setB64Images(loaded);
      setFloorPlanB64(fpB64);
      setFlagB64(makeGeorgiaFlagB64());

      // 3. Wait for React to re-render with base64 images
      await new Promise((r) => setTimeout(r, 500));

      const el = pdfRef.current;
      if (!el) return;
      el.style.display = "block";
      // Let browser lay out the element before capture
      await new Promise((r) => setTimeout(r, 300));

      // 4. Capture via html-to-image (SVG foreignObject → proper Arabic shaping)
      const dataUrl = await toPng(el, {
        pixelRatio: 3,
        backgroundColor: "#ffffff",
        cacheBust: true,
        // Embed fonts so SVG renderer can shape Arabic correctly
        fontEmbedCSS: `
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&family=Tajawal:wght@400;500;700;900&family=Noto+Sans+Arabic:wght@400;600;700&display=swap');
        `,
      });
      el.style.display = "none";

      // 5. Build filename
      const floorStr = selectedFloors.length > 0 ? `Floor${floorsLabel(selectedFloors).replace(/\s/g, "")}` : "";
      const parts = [
        selectedProject.title || "offer",
        apartmentType || "",
        floorStr,
        totalPrice > 0 ? `$${fmt(totalPrice)}` : "",
      ].filter(Boolean).map((s) => s.replace(/\s+/g, "_").replace(/[^\w$.\-]/g, ""));
      const filename = `${parts.join("_")}.pdf`;

      // 6. Create PDF and trigger direct download
      const img  = new Image();
      img.src    = dataUrl;
      await new Promise((r) => { img.onload = r; });
      const pw     = 210;
      const totalMm = Math.round((img.naturalHeight / img.naturalWidth) * pw);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [pw, totalMm] });
      pdf.addImage(dataUrl, "PNG", 0, 0, pw, totalMm, undefined, "FAST");
      pdf.save(filename);
    } finally {
      setGenerating(false);
      setB64Images([]);
      setFloorPlanB64("");
      setFlagB64("");
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

            {/* ── Floor plan picker ── */}
            <div>
              <Label className="text-xs text-gray-500 mb-2 block">المخطط الداخلي للشقة <span className="text-gray-400">(اختياري)</span></Label>
              <div className="grid grid-cols-5 gap-2">
                {FLOOR_PLANS.map((fp) => (
                  <button
                    key={fp.id}
                    type="button"
                    onClick={() => setSelectedFloorPlan(selectedFloorPlan === fp.src ? "" : fp.src)}
                    className={`relative rounded-xl overflow-hidden border-2 transition-all group ${
                      selectedFloorPlan === fp.src
                        ? "border-[#3bcac4] shadow-lg shadow-[#3bcac4]/20 scale-[1.04]"
                        : "border-gray-200 hover:border-[#3bcac4]/50"
                    }`}
                  >
                    <img
                      src={fp.src}
                      alt={fp.label}
                      className="w-full aspect-square object-cover"
                    />
                    {selectedFloorPlan === fp.src && (
                      <div className="absolute inset-0 bg-[#3bcac4]/15 flex items-center justify-center">
                        <div className="w-6 h-6 rounded-full bg-[#3bcac4] flex items-center justify-center shadow">
                          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentWidth"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        </div>
                      </div>
                    )}
                    <div className={`absolute bottom-0 inset-x-0 py-0.5 text-center text-[10px] font-medium ${selectedFloorPlan === fp.src ? "bg-[#3bcac4] text-white" : "bg-black/50 text-white"}`}>
                      {fp.label}
                    </div>
                  </button>
                ))}
              </div>
              {selectedFloorPlan && (
                <button
                  type="button"
                  onClick={() => setSelectedFloorPlan("")}
                  className="mt-1.5 text-xs text-gray-400 hover:text-red-500 flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> إلغاء الاختيار
                </button>
              )}
            </div>
            {/* Block select */}
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">البلوك</Label>
              <select
                value={selectedBlock}
                onChange={(e) => setSelectedBlock(e.target.value)}
                className="w-full h-9 border border-input rounded-md px-3 text-sm bg-white text-right"
              >
                <option value="">اختر البلوك</option>
                {Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)).map((letter) => (
                  <option key={letter} value={letter}>{letter}</option>
                ))}
              </select>
              {selectedBlock && (
                <button
                  type="button"
                  onClick={() => setSelectedBlock("")}
                  className="mt-1 text-xs text-gray-400 hover:text-red-500 flex items-center gap-1"
                >
                  <X className="w-3 h-3" /> إلغاء الاختيار
                </button>
              )}
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

            {/* Discount */}
            {totalPrice > 0 && (
              <div>
                <Label className="text-xs text-gray-500 mb-1 block">الخصم (%)</Label>
                <Input
                  type="number" min="0" max="99" placeholder="مثال: 10"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                  className="h-9 text-right" dir="ltr"
                />
                {discountVal > 0 && (
                  <div className="mt-2 rounded-lg border border-[#3bcac4]/40 bg-[#3bcac4]/8 p-3 flex justify-between items-center">
                    <div className="text-right">
                      <div className="text-xs text-gray-400 line-through">${fmt(totalPrice)}</div>
                      <div className="text-xs text-gray-500">خصم {discountVal}%</div>
                    </div>
                    <div className="text-left">
                      <div className="text-xs text-gray-500 mb-0.5">السعر بعد الخصم</div>
                      <div className="text-xl font-bold text-[#3bcac4]">${fmt(discountedPrice)}</div>
                    </div>
                  </div>
                )}
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
              {generating ? "جارٍ التحضير..." : "تحميل العرض PDF"}
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
            b64Images={b64Images}
            floorPlanB64={floorPlanB64}
            flagB64={flagB64}
            lang={pdfLang}
            isRTL={isRTL}
            apartmentType={apartmentType}
            selectedBlock={selectedBlock}
            selectedFloors={selectedFloors}
            totalArea={totalArea}
            pricePerMeter={pricePerMeter}
            totalPrice={totalPrice}
            discountVal={discountVal}
            discountedPrice={discountedPrice}
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
  project, b64Images, floorPlanB64, flagB64, lang, isRTL,
  apartmentType, selectedBlock, selectedFloors, totalArea, pricePerMeter,
  totalPrice, discountVal, discountedPrice, paymentPercent, downPayment, remainingBalance,
  installments, monthlyInstall, deliveryType, deliveryDate,
  getAptLabel, getDelivLabel, getDateLabel, floorsLabel, fmt
}: any) {

  const W   = 794;
  const dir: "rtl" | "ltr" = isRTL ? "rtl" : "ltr";
  const ff  = isRTL
    ? '"Cairo","Tajawal","Noto Sans Arabic","Tahoma","Arial","sans-serif"'
    : '"Cairo","Arial","Helvetica Neue","sans-serif"';

  // Use preloaded base64 images when available, else fallback to raw URLs
  const imgs: string[] = b64Images?.length
    ? b64Images
    : (project.images ?? []);
  const hero   = imgs[0] ?? null;
  const thumb1 = imgs[1] ?? null;
  const thumb2 = imgs[2] ?? null;

  // Build detail rows — only non-empty fields
  const rows: { label: string; value: string; accent?: boolean }[] = [];
  if (apartmentType)          rows.push({ label: t("aptType",lang),      value: getAptLabel(apartmentType) });
  if (selectedBlock)          rows.push({ label: t("block",lang),         value: selectedBlock });
  if (selectedFloors?.length) rows.push({ label: t("floor",lang),        value: floorsLabel(selectedFloors) });
  if (totalArea)              rows.push({ label: t("area",lang),          value: `${totalArea} m²` });
  if (pricePerMeter)          rows.push({ label: t("pricePerMeter",lang), value: `$${fmt(parseFloat(pricePerMeter))} / m²` });
  if (discountVal > 0 && totalPrice > 0) {
    rows.push({ label: `${t("discount",lang)} — ${discountVal}%`, value: `$${fmt(totalPrice)} ← $${fmt(discountedPrice)}` });
    rows.push({ label: t("priceAfterDiscount",lang), value: `$${fmt(discountedPrice)}`, accent: true });
  }
  if (paymentPercent && discountedPrice > 0)
    rows.push({ label: `${t("downPayment",lang)} — ${paymentPercent}%`,  value: `$${fmt(downPayment)}` });
  if (paymentPercent && discountedPrice > 0)
    rows.push({ label: t("remaining",lang),    value: `$${fmt(remainingBalance)}` });
  if (installments)           rows.push({ label: t("installments",lang),  value: installments });
  if (monthlyInstall > 0)     rows.push({ label: t("monthlyPayment",lang), value: `$${fmt(monthlyInstall)}`, accent: true });
  if (deliveryType)           rows.push({ label: t("deliveryType",lang),  value: getDelivLabel(deliveryType) });
  if (deliveryDate)           rows.push({ label: t("deliveryDate",lang),  value: getDateLabel(deliveryDate) });

  // ── Helpers for inline RTL on text nodes only (avoids html2canvas RTL canvas-flip bug)
  const txt  = (extra?: object) => ({ direction: dir, unicodeBidi: "embed" as const, ...(extra ?? {}) });
  const ta: "right" | "left" = isRTL ? "right" : "left";

  const S = {
    // IMPORTANT: page is always LTR — RTL applied per-text-element only
    page:       { width: W, backgroundColor: "#fff", fontFamily: ff, direction: "ltr" as const, overflow: "hidden" as const },
    header:     { background: "#ffffff", padding: "22px 40px 30px", display: "flex", justifyContent: "space-between", alignItems: "center" },
    hLogo:      { flexShrink: 0 },
    hCenter:    { flex: 1, textAlign: "center" as const, padding: "0 24px" },
    hTagline:   { fontSize: 17, color: "#3bcac4", letterSpacing: 3, marginBottom: 6, fontWeight: 600 as const },
    hTitle:     { fontSize: 40, fontWeight: 900 as const, color: "#005476", lineHeight: 1.25, marginTop: 10, direction: dir, unicodeBidi: "embed" as const },
    hRight:     { flexShrink: 0, textAlign: "right" as const, minWidth: 120 },
    hLocation:  { fontSize: 22, color: "#3bcac4", fontWeight: 700 as const, marginTop: 4, textAlign: "right" as const, direction: dir, unicodeBidi: "embed" as const },
    logo:       { height: 160, width: "auto", objectFit: "contain" as const, flexShrink: 0 },
    imgWrap1:   { width: "100%", background: "#fff", textAlign: "center" as const, lineHeight: 0 },
    imgWrap2:   { width: "100%", background: "#fff", textAlign: "center" as const, lineHeight: 0, marginTop: 4 },
    imgFill:    { maxWidth: "100%", maxHeight: 420, height: "auto", display: "inline-block" as const, verticalAlign: "bottom" as const },
    titleBar:   { background: "#f0f4f8", padding: "16px 40px", display: "flex", flexDirection: (isRTL ? "row-reverse" : "row") as "row" | "row-reverse", justifyContent: "space-between", alignItems: "center" },
    titleText:  { fontSize: 30, fontWeight: 800 as const, color: "#005476", ...txt() },
    pricePill:  { background: "#3bcac4", borderRadius: 10, padding: "10px 24px", textAlign: "center" as const, minWidth: 160 },
    priceLbl:   { fontSize: 16, color: "rgba(255,255,255,0.8)", marginBottom: 3, letterSpacing: 1, ...txt() },
    priceVal:   { fontSize: 36, fontWeight: 900 as const, color: "#fff" },
    grid:       { padding: "22px 40px 18px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
    cell:       { borderRadius: 10, padding: "15px 20px", background: "#f1f5f9", border: "1px solid #dde3ea" },
    cellAccent: { borderRadius: 10, padding: "15px 20px", background: "#3bcac4", border: "none" },
    cellLbl:    { fontSize: 17, color: "#64748b", marginBottom: 6, fontWeight: 500 as const, textAlign: ta, ...txt() },
    cellLblA:   { fontSize: 17, color: "rgba(255,255,255,0.75)", marginBottom: 6, fontWeight: 500 as const, textAlign: ta, ...txt() },
    cellVal:    { fontSize: 25, fontWeight: 700 as const, color: "#0f172a", lineHeight: 1.3, textAlign: ta, ...txt() },
    cellValA:   { fontSize: 25, fontWeight: 700 as const, color: "#fff", lineHeight: 1.3, textAlign: ta, ...txt() },
    footer:     { background: "#ffffff", marginTop: 6, borderTop: "1px solid #e2e8f0" },
    fInner:     { padding: "24px 40px", display: "flex", flexDirection: "row" as const, justifyContent: "space-between", alignItems: "center" },
    fLogo:      { height: 320, width: "auto", objectFit: "contain" as const, display: "block" as const, margin: "0 auto", marginTop: -40 },
    fCenter:    { flex: 1, display: "flex" as const, justifyContent: "center" as const, alignItems: "center" as const },
    fWebsite:   { color: "#3bcac4", fontWeight: 800 as const, fontSize: 22, letterSpacing: 0.5, display: "block" as const },
    fRight:     { textAlign: "right" as const, minWidth: 220, flexShrink: 0 },
    fPhoneLbl:  { fontSize: 16, color: "#94a3b8", marginBottom: 3, letterSpacing: 1, whiteSpace: "nowrap" as const },
    fPhone:     { color: "#005476", fontWeight: 900 as const, fontSize: 30, letterSpacing: 1, whiteSpace: "nowrap" as const },
    fLabel:     { fontSize: 18, color: "#94a3b8", ...txt() },
  };

  return (
    <div style={S.page}>

      {/* ── Header — logo CENTER · location RIGHT (always, all langs) ── */}
      <div style={{ ...S.header, direction: "ltr" }}>
        {/* Left: spacer to balance the right column */}
        <div style={{ minWidth: 120 }} />

        {/* Center: original-color logo + project title */}
        <div style={S.hCenter}>
          <img
            src={logoPath}
            alt="Kinglike"
            style={{ height: 320, width: "auto", objectFit: "contain", display: "inline-block", marginBottom: 8 }}
          />
          <div style={S.hTitle}>{project.title}</div>
        </div>

        {/* Right: city / country */}
        <div style={S.hRight}>
          {project.location && (
            <div style={{ ...S.hLocation, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
              {flagB64 && (
                <img
                  src={flagB64}
                  alt="GE"
                  style={{ width: 34, height: 23, objectFit: "fill", border: "1px solid #e2e8f0", borderRadius: 2, flexShrink: 0 }}
                />
              )}
              <span>{project.location}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Images — stacked vertically, each full width, no stretch ── */}
      {hero   && <div style={S.imgWrap1}><img src={hero}   style={S.imgFill} /></div>}
      {thumb1 && <div style={S.imgWrap2}><img src={thumb1} style={S.imgFill} /></div>}

      {/* ── Title bar with total price ── */}
      <div style={S.titleBar}>
        <div dir={dir} style={S.titleText}>{t("offerTitle", lang)}</div>
        {totalPrice > 0 && (
          <div style={S.pricePill}>
            {discountVal > 0 ? (
              <>
                <div style={{ ...S.priceLbl, textDecoration: "line-through", opacity: 0.55, fontSize: 16 }}>${fmt(totalPrice)}</div>
                <div style={{ fontSize: 16, color: "#3bcac4", fontWeight: 600, marginBottom: 1 }}>{t("discount", lang)} {discountVal}%</div>
                <div style={S.priceVal}>${fmt(discountedPrice)}</div>
              </>
            ) : (
              <>
                <div style={S.priceLbl}>{t("totalPrice", lang)}</div>
                <div style={S.priceVal}>${fmt(totalPrice)}</div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Details grid ── */}
      <div style={S.grid}>
        {rows.map((row, i) => (
          <div key={i} style={row.accent ? S.cellAccent : S.cell}>
            <div dir={dir} style={row.accent ? S.cellLblA : S.cellLbl}>{row.label}</div>
            <div dir={dir} style={row.accent ? S.cellValA : S.cellVal}>{row.value}</div>
          </div>
        ))}
      </div>

      {/* ── Floor plan section (only if selected) ── */}
      {floorPlanB64 && (
        <div style={{ padding: "0 40px 20px" }}>
          <div style={{
            borderRadius: 14,
            overflow: "hidden",
            border: "2px solid #3bcac4",
            boxShadow: "0 4px 20px rgba(59,202,196,0.15)",
          }}>
            {/* Section label bar */}
            <div style={{
              background: "#3bcac4",
              padding: "10px 20px",
              display: "flex",
              flexDirection: isRTL ? "row-reverse" : "row",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{ fontSize: 18 }}>🏗️</div>
              <div dir={dir} style={{ fontSize: 21, fontWeight: 700, color: "#fff", fontFamily: ff, direction: dir, unicodeBidi: "embed" as const }}>
                {lang === "ar" ? "المخطط الداخلي للشقة" :
                 lang === "he" ? "תוכנית הדירה" :
                 lang === "ru" ? "Планировка квартиры" :
                 lang === "ka" ? "ბინის გეგმა" :
                 lang === "az" ? "Mənzil planı" :
                 lang === "tr" ? "Daire Planı" :
                 lang === "zh" ? "户型平面图" :
                 lang === "pl" ? "Rzut mieszkania" :
                 lang === "it" ? "Planimetria dell'appartamento" :
                 "Apartment Floor Plan"}
              </div>
            </div>
            {/* Plan image — full width, natural ratio */}
            <div style={{ background: "#f8f9fa", textAlign: "center" as const }}>
              <img
                src={floorPlanB64}
                style={{
                  maxWidth: "100%",
                  maxHeight: 400,
                  objectFit: "contain",
                  display: "inline-block",
                  padding: "16px",
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div style={S.footer}>
        <div style={S.fInner}>
          {/* Left: website */}
          <div style={{ minWidth: 160 }}>
            <span style={S.fWebsite}>www.kinglikeluxury.app</span>
          </div>
          {/* Center: Logo (original colors) */}
          <div style={S.fCenter}>
            <img src={logoPath} alt="Kinglike" style={S.fLogo} />
          </div>
          {/* Right: phone */}
          <div style={S.fRight}>
            <div style={S.fPhoneLbl}>CONTACT</div>
            <div style={S.fPhone}>+995 591 00 00 58</div>
          </div>
        </div>
      </div>

    </div>
  );
}
