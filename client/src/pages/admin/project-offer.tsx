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

const APARTMENT_TYPES = [
  { value: "studio", ar: "استوديو", en: "Studio", ru: "Студия", ka: "სტუდია", az: "Studiya", tr: "Stüdyo", zh: "工作室", pl: "Kawalerka", he: "סטודיו", it: "Monolocale" },
  { value: "1+1", ar: "غرفة وصالة", en: "1 Bedroom", ru: "1 спальня", ka: "1 საძინებელი", az: "1 yataqlı", tr: "1+1", zh: "一室一厅", pl: "1 sypialnia", he: "חדר שינה 1", it: "1 camera" },
  { value: "2+1", ar: "غرفتين وصالة", en: "2 Bedrooms", ru: "2 спальни", ka: "2 საძინებელი", az: "2 yataqlı", tr: "2+1", zh: "两室一厅", pl: "2 sypialnie", he: "2 חדרי שינה", it: "2 camere" },
  { value: "3+1", ar: "ثلاث غرف وصالة", en: "3 Bedrooms", ru: "3 спальни", ka: "3 საძინებელი", az: "3 yataqlı", tr: "3+1", zh: "三室一厅", pl: "3 sypialnie", he: "3 חדרי שינה", it: "3 camere" },
  { value: "4+1", ar: "أربع غرف وصالة", en: "4 Bedrooms", ru: "4 спальни", ka: "4 საძინებელი", az: "4 yataqlı", tr: "4+1", zh: "四室一厅", pl: "4 sypialnie", he: "4 חדרי שינה", it: "4 camere" },
  { value: "5+1", ar: "خمس غرف وصالة", en: "5 Bedrooms", ru: "5 спален", ka: "5 საძინებელი", az: "5 yataqlı", tr: "5+1", zh: "五室一厅", pl: "5 sypialni", he: "5 חדרי שינה", it: "5 camere" },
  { value: "villa", ar: "فيلا", en: "Villa", ru: "Вилла", ka: "ვილა", az: "Villa", tr: "Villa", zh: "别墅", pl: "Willa", he: "וילה", it: "Villa" },
  { value: "townhouse", ar: "تاون هاوس", en: "Townhouse", ru: "Таунхаус", ka: "ტაუნჰაუსი", az: "Taunhaus", tr: "Townhouse", zh: "联排别墅", pl: "Szeregowiec", he: "בית עירוני", it: "Villetta a schiera" },
];

const DELIVERY_TYPES = [
  { value: "black", ar: "تسليم على الأسود", en: "Shell & Core", ru: "Черновая отделка", ka: "შავი მოსაპირკეთებელი", az: "Qara", tr: "Ham Teslim", zh: "毛坯", pl: "Stan surowy", he: "גולמי", it: "Grezzo" },
  { value: "white", ar: "تسليم على الأبيض", en: "White Box", ru: "Белая отделка", ka: "თეთრი მოსაპირკეთებელი", az: "Ağ", tr: "Beyaz Teslim", zh: "白盒", pl: "Stan biały", he: "קופסה לבנה", it: "Scatola bianca" },
  { value: "half", ar: "تسليم بنصف تشطيب", en: "Half Finished", ru: "Полуотделка", ka: "ნახევარი მოსაპირკეთებელი", az: "Yarı bitmiş", tr: "Yarı Bitişli", zh: "半精装", pl: "Stan deweloperski", he: "חצי גמר", it: "Semi rifinito" },
  { value: "full", ar: "تسليم بتشطيب كامل", en: "Fully Finished", ru: "Полная отделка", ka: "სრული მოსაპირკეთებელი", az: "Tam bitmiş", tr: "Tam Bitişli", zh: "精装", pl: "Wykończony", he: "גמר מלא", it: "Completamente rifinito" },
  { value: "furnished", ar: "تسليم على المفتاح مع المفروشات", en: "Fully Furnished", ru: "С мебелью", ka: "ავეჯით", az: "Mebelli", tr: "Eşyalı", zh: "全装带家具", pl: "Umeblowany", he: "מרוהט", it: "Arredato" },
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
  const dates: { value: string; label: string }[] = [{ value: "ready", label: { ar: "جاهز للتسليم", en: "Ready for Delivery", ru: "Готов к сдаче", ka: "მზადაა", az: "Çatdırılmağa hazır", tr: "Teslime Hazır", zh: "可交付", pl: "Gotowy do odbioru", he: "מוכן למסירה", it: "Pronto per la consegna" } as any }];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const arMonths = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];
  for (let y = 2026; y <= 2035; y++) {
    const startMonth = y === 2026 ? 5 : 0;
    const endMonth = y === 2035 ? 11 : 11;
    for (let m = startMonth; m <= endMonth; m++) {
      dates.push({ value: `${y}-${m+1}`, label: `${months[m]} ${y}` as any });
    }
  }
  return dates;
}

const DELIVERY_DATES = generateDeliveryDates();

export default function ProjectOfferPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { i18n } = useTranslation();
  const pdfRef = useRef<HTMLDivElement>(null);

  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [apartmentType, setApartmentType] = useState("");
  const [selectedFloors, setSelectedFloors] = useState<number[]>([]);
  const [floorOpen, setFloorOpen] = useState(false);
  const [totalArea, setTotalArea] = useState("");
  const [pricePerMeter, setPricePerMeter] = useState("");
  const [paymentPercent, setPaymentPercent] = useState<number | null>(null);
  const [installments, setInstallments] = useState("");
  const [deliveryType, setDeliveryType] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [pdfLang, setPdfLang] = useState("ar");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) navigate("/");
  }, [user, authLoading, navigate]);

  const { data: projects = [] } = useQuery<any[]>({ queryKey: ["/api/projects"] });
  const { data: properties = [] } = useQuery<any[]>({ queryKey: ["/api/properties"] });

  const allProjects = projects.map((p: any) => ({
    id: p.propertyId || p.id,
    title: p.property?.title || p.title || "",
    location: p.property?.location || p.location || "",
    images: p.property?.images || p.images || [],
  }));

  const locationParts = (loc: string) => {
    const parts = loc.split(",").map((s: string) => s.trim());
    return { city: parts[0] || "", country: parts[parts.length - 1] || "" };
  };

  const countries = [...new Set(allProjects.map((p) => locationParts(p.location).country).filter(Boolean))];
  const cities = [...new Set(allProjects.filter((p) => !selectedCountry || locationParts(p.location).country === selectedCountry).map((p) => locationParts(p.location).city).filter(Boolean))];
  const filteredProjects = allProjects.filter((p) => {
    const lp = locationParts(p.location);
    return (!selectedCountry || lp.country === selectedCountry) && (!selectedCity || lp.city === selectedCity);
  });

  const selectedProject = allProjects.find((p) => p.id === selectedProjectId);

  const totalPrice = totalArea && pricePerMeter ? parseFloat(totalArea) * parseFloat(pricePerMeter) : 0;
  const downPayment = paymentPercent ? (totalPrice * paymentPercent) / 100 : 0;
  const remaining = totalPrice - downPayment;
  const monthlyInstallment = installments && parseInt(installments) > 0 ? remaining / parseInt(installments) : 0;

  const toggleFloor = (f: number) => {
    setSelectedFloors((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f].sort((a, b) => a - b));
  };

  const getLangVal = (obj: any, lang: string) => {
    if (typeof obj === "string") return obj;
    return obj?.[lang] || obj?.en || "";
  };

  const getApartmentLabel = (val: string, lang: string) => {
    const found = APARTMENT_TYPES.find((t) => t.value === val);
    return found ? getLangVal(found, lang) : val;
  };

  const getDeliveryLabel = (val: string, lang: string) => {
    const found = DELIVERY_TYPES.find((t) => t.value === val);
    return found ? getLangVal(found, lang) : val;
  };

  const getDeliveryDateLabel = (val: string) => {
    if (val === "ready") return getLangVal({ ar: "جاهز للتسليم", en: "Ready for Delivery", ru: "Готов к сдаче", ka: "მზადაა", az: "Çatdırılmağa hazır", tr: "Teslime Hazır", zh: "可交付", pl: "Gotowy do odbioru", he: "מוכן למסירה", it: "Pronto per la consegna" }, pdfLang);
    const found = DELIVERY_DATES.find((d) => d.value === val);
    return found ? String(found.label) : val;
  };

  const floorLabel = (f: number, lang: string) => {
    const ordinals: Record<string, (n: number) => string> = {
      ar: (n) => `الطابق ${["الأول","الثاني","الثالث","الرابع","الخامس","السادس","السابع","الثامن","التاسع","العاشر"][n-1] || n + ""}`,
      en: (n) => `Floor ${n}`,
      ru: (n) => `Этаж ${n}`,
      ka: (n) => `სართული ${n}`,
      az: (n) => `${n} mərtəbə`,
      tr: (n) => `${n}. Kat`,
      zh: (n) => `第${n}层`,
      pl: (n) => `Piętro ${n}`,
      he: (n) => `קומה ${n}`,
      it: (n) => `Piano ${n}`,
    };
    return (ordinals[lang] || ordinals.en)(f);
  };

  const isRTL = (lang: string) => lang === "ar" || lang === "he";

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat("en-US", { style: "decimal", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
  };

  const generatePDF = async () => {
    if (!selectedProject) return;
    setGenerating(true);
    try {
      const pdfEl = pdfRef.current;
      if (!pdfEl) return;
      pdfEl.style.display = "block";
      await new Promise((r) => setTimeout(r, 300));
      const canvas = await html2canvas(pdfEl, { scale: 2, useCORS: true, allowTaint: true, backgroundColor: "#fff" });
      pdfEl.style.display = "none";
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pdfWidth) / canvas.width;
      let y = 0;
      if (imgH <= pdfHeight) {
        pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, imgH);
      } else {
        let remaining = imgH;
        while (remaining > 0) {
          pdf.addImage(imgData, "JPEG", 0, y === 0 ? 0 : -y, pdfWidth, imgH);
          remaining -= pdfHeight;
          y += pdfHeight;
          if (remaining > 0) pdf.addPage();
        }
      }
      pdf.save(`${selectedProject.title || "offer"}-offer.pdf`);
    } finally {
      setGenerating(false);
    }
  };

  const labels: Record<string, Record<string, string>> = {
    ar: { title: "إنشاء عرض للمشاريع", country: "الدولة", city: "المدينة", project: "المشروع", aptType: "نوع الشقة", floor: "الطابق", area: "المساحة الإجمالية (م²)", pricePerM: "سعر المتر ($)", totalPrice: "السعر الإجمالي", payment: "طريقة الدفع", installNum: "عدد الأقساط", monthly: "القسط الشهري", delivery: "طريقة التسليم", deliveryDate: "تاريخ تسليم المشروع", downloadPdf: "تنزيل PDF", lang: "لغة PDF", selectCountry: "اختر الدولة", selectCity: "اختر المدينة", selectProject: "اختر المشروع", selectType: "اختر النوع", selectFloors: "اختر الطوابق", selectDelivery: "اختر طريقة التسليم", selectDate: "اختر التاريخ", downPayment: "الدفعة الأولى", sqm: "م²", priceUnit: "$", noProjects: "لا توجد مشاريع" },
    en: { title: "Create Project Offer", country: "Country", city: "City", project: "Project", aptType: "Apartment Type", floor: "Floor", area: "Total Area (m²)", pricePerM: "Price per m² ($)", totalPrice: "Total Price", payment: "Payment Method", installNum: "Number of Installments", monthly: "Monthly Installment", delivery: "Delivery Type", deliveryDate: "Project Delivery Date", downloadPdf: "Download PDF", lang: "PDF Language", selectCountry: "Select Country", selectCity: "Select City", selectProject: "Select Project", selectType: "Select Type", selectFloors: "Select Floors", selectDelivery: "Select Delivery Type", selectDate: "Select Date", downPayment: "Down Payment", sqm: "m²", priceUnit: "$", noProjects: "No projects" },
    ru: { title: "Создать предложение", country: "Страна", city: "Город", project: "Проект", aptType: "Тип квартиры", floor: "Этаж", area: "Общая площадь (м²)", pricePerM: "Цена за м² ($)", totalPrice: "Общая цена", payment: "Способ оплаты", installNum: "Количество рассрочек", monthly: "Ежемесячный платёж", delivery: "Тип сдачи", deliveryDate: "Дата сдачи", downloadPdf: "Скачать PDF", lang: "Язык PDF", selectCountry: "Выберите страну", selectCity: "Выберите город", selectProject: "Выберите проект", selectType: "Выберите тип", selectFloors: "Выберите этажи", selectDelivery: "Выберите тип сдачи", selectDate: "Выберите дату", downPayment: "Первоначальный взнос", sqm: "м²", priceUnit: "$", noProjects: "Нет проектов" },
  };

  const L = labels[pdfLang] || labels.en;
  const uiL = labels.ar;

  if (authLoading) return <div className="flex justify-center p-20"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#3bcac4]" /></div>;
  if (!user?.isAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50 pb-20" dir="rtl">
      <div className="max-w-3xl mx-auto px-4 pt-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-[#005476]">إنشاء عرض للمشاريع</h1>
            <p className="text-sm text-gray-500">أنشئ ملف PDF احترافي للعروض العقارية</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Location Row */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-[#005476]">📍 الموقع والمشروع</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-gray-600 mb-1 block">الدولة</Label>
                  <Select value={selectedCountry} onValueChange={(v) => { setSelectedCountry(v); setSelectedCity(""); setSelectedProjectId(null); }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="اختر الدولة" /></SelectTrigger>
                    <SelectContent>
                      {countries.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-600 mb-1 block">المدينة</Label>
                  <Select value={selectedCity} onValueChange={(v) => { setSelectedCity(v); setSelectedProjectId(null); }}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="اختر المدينة" /></SelectTrigger>
                    <SelectContent>
                      {cities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">المشروع</Label>
                <Select value={selectedProjectId?.toString() || ""} onValueChange={(v) => setSelectedProjectId(parseInt(v))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر المشروع" /></SelectTrigger>
                  <SelectContent>
                    {filteredProjects.length === 0
                      ? <SelectItem value="_none" disabled>لا توجد مشاريع</SelectItem>
                      : filteredProjects.map((p) => <SelectItem key={p.id} value={p.id.toString()}>{p.title}</SelectItem>)
                    }
                  </SelectContent>
                </Select>
                {selectedProject && (
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {selectedProject.images.slice(0, 2).map((img: string, i: number) => (
                      <img key={i} src={img} alt="" className="h-16 w-24 object-cover rounded-lg border" />
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Apartment Details */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-[#005476]">🏠 تفاصيل الشقة</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">نوع الشقة</Label>
                <Select value={apartmentType} onValueChange={setApartmentType}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر نوع الشقة" /></SelectTrigger>
                  <SelectContent>
                    {APARTMENT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.ar}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Floor multi-select */}
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">الطابق</Label>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setFloorOpen(!floorOpen)}
                    className="w-full h-9 border border-input rounded-md px-3 text-sm flex items-center justify-between bg-white text-right"
                  >
                    <span className={selectedFloors.length === 0 ? "text-gray-400" : "text-gray-900"}>
                      {selectedFloors.length === 0 ? "اختر الطوابق" : selectedFloors.map((f) => `طابق ${f}`).join("، ")}
                    </span>
                    <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  </button>
                  {floorOpen && (
                    <div className="absolute top-10 right-0 z-50 bg-white border rounded-md shadow-lg max-h-56 overflow-y-auto w-full">
                      <div className="grid grid-cols-5 gap-1 p-2">
                        {Array.from({ length: 65 }, (_, i) => i + 1).map((f) => (
                          <label key={f} className="flex items-center gap-1 p-1 rounded hover:bg-gray-50 cursor-pointer text-xs">
                            <Checkbox checked={selectedFloors.includes(f)} onCheckedChange={() => toggleFloor(f)} />
                            <span>{f}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {selectedFloors.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {selectedFloors.map((f) => (
                      <Badge key={f} variant="secondary" className="text-xs gap-1 bg-[#3bcac4]/10 text-[#005476]">
                        طابق {f}
                        <X className="h-3 w-3 cursor-pointer" onClick={() => toggleFloor(f)} />
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Pricing */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-[#005476]">💰 التسعير</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-gray-600 mb-1 block">المساحة الإجمالية (م²)</Label>
                  <Input type="number" placeholder="مثال: 85" value={totalArea} onChange={(e) => setTotalArea(e.target.value)} className="h-9 text-right" dir="rtl" />
                </div>
                <div>
                  <Label className="text-xs text-gray-600 mb-1 block">سعر المتر ($)</Label>
                  <Input type="number" placeholder="مثال: 1500" value={pricePerMeter} onChange={(e) => setPricePerMeter(e.target.value)} className="h-9 text-right" dir="rtl" />
                </div>
              </div>
              {totalPrice > 0 && (
                <div className="bg-gradient-to-r from-[#3bcac4]/10 to-[#005476]/10 rounded-lg p-3 border border-[#3bcac4]/30">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-[#005476]">السعر الإجمالي</span>
                    <span className="text-lg font-bold text-[#3bcac4]">${formatCurrency(totalPrice)}</span>
                  </div>
                </div>
              )}

              {/* Payment percentage */}
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">طريقة الدفع (الدفعة الأولى %)</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {PAYMENT_PERCENTAGES.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPaymentPercent(paymentPercent === p ? null : p)}
                      className={`py-1.5 px-2 rounded-md text-xs font-medium border transition-all ${paymentPercent === p ? "bg-[#3bcac4] text-white border-[#3bcac4]" : "bg-white text-gray-600 border-gray-200 hover:border-[#3bcac4]"}`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
                {paymentPercent && totalPrice > 0 && (
                  <div className="mt-2 text-sm text-[#005476] font-medium bg-[#005476]/5 rounded-lg p-2 text-center">
                    الدفعة الأولى ({paymentPercent}%) = <span className="text-[#3bcac4] font-bold">${formatCurrency(downPayment)}</span>
                  </div>
                )}
              </div>

              {/* Installments */}
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">عدد الأقساط الشهرية</Label>
                <Input type="number" placeholder="مثال: 36" value={installments} onChange={(e) => setInstallments(e.target.value)} className="h-9 text-right" dir="rtl" />
                {monthlyInstallment > 0 && (
                  <div className="mt-2 text-sm text-[#005476] font-medium bg-[#005476]/5 rounded-lg p-2 text-center">
                    القسط الشهري = <span className="text-[#3bcac4] font-bold">${formatCurrency(monthlyInstallment)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Delivery */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm text-[#005476]">🗓️ التسليم</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">طريقة التسليم</Label>
                <Select value={deliveryType} onValueChange={setDeliveryType}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر طريقة التسليم" /></SelectTrigger>
                  <SelectContent>
                    {DELIVERY_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.ar}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">تاريخ تسليم المشروع</Label>
                <Select value={deliveryDate} onValueChange={setDeliveryDate}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر تاريخ التسليم" /></SelectTrigger>
                  <SelectContent className="max-h-60">
                    <SelectItem value="ready">✅ جاهز للتسليم</SelectItem>
                    {DELIVERY_DATES.filter((d) => d.value !== "ready").map((d) => (
                      <SelectItem key={d.value} value={d.value}>{String(d.label)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* PDF Download */}
          <Card className="border-[#3bcac4]/40 bg-gradient-to-br from-[#3bcac4]/5 to-[#005476]/5">
            <CardHeader className="pb-3"><CardTitle className="text-sm text-[#005476]">📄 تنزيل العرض</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs text-gray-600 mb-1 block">لغة ملف PDF</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => setPdfLang(lang.code)}
                      className={`py-1.5 px-1 rounded-md text-xs font-medium border transition-all ${pdfLang === lang.code ? "bg-[#005476] text-white border-[#005476]" : "bg-white text-gray-600 border-gray-200 hover:border-[#005476]"}`}
                    >
                      {lang.label}
                    </button>
                  ))}
                </div>
              </div>
              <Button
                onClick={generatePDF}
                disabled={!selectedProject || generating}
                className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90 gap-2"
              >
                <FileDown className="h-4 w-4" />
                {generating ? "جارٍ إنشاء PDF..." : "تنزيل ملف PDF"}
              </Button>
              {!selectedProject && <p className="text-xs text-center text-gray-400">يرجى اختيار مشروع أولاً</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Hidden PDF Template */}
      <div ref={pdfRef} style={{ display: "none", position: "fixed", top: 0, left: 0, zIndex: -1, width: "794px", backgroundColor: "#fff" }}>
        {selectedProject && (
          <div
            dir={isRTL(pdfLang) ? "rtl" : "ltr"}
            style={{ fontFamily: isRTL(pdfLang) ? "'Arial', sans-serif" : "'Arial', sans-serif", padding: "40px", backgroundColor: "#fff", width: "794px", minHeight: "1123px", position: "relative", color: "#1a1a1a" }}
          >
            {/* Header with logo */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", borderBottom: "3px solid #3bcac4", paddingBottom: "20px" }}>
              {!isRTL(pdfLang) && <img src={logoPath} alt="Kinglike Luxury" style={{ height: "80px", width: "auto", objectFit: "contain" }} crossOrigin="anonymous" />}
              <div style={{ textAlign: "center", flex: 1 }}>
                <div style={{ fontSize: "24px", fontWeight: "bold", color: "#005476", marginBottom: "6px" }}>{selectedProject.title}</div>
                <div style={{ fontSize: "13px", color: "#3bcac4", letterSpacing: "1px" }}>KINGLIKE LUXURY REAL ESTATE</div>
              </div>
              {isRTL(pdfLang) && <img src={logoPath} alt="Kinglike Luxury" style={{ height: "80px", width: "auto", objectFit: "contain" }} crossOrigin="anonymous" />}
            </div>

            {/* Project Images */}
            {selectedProject.images.length > 0 && (
              <div style={{ display: "flex", gap: "12px", marginBottom: "24px" }}>
                {selectedProject.images.slice(0, 2).map((img: string, i: number) => (
                  <img key={i} src={img} alt="" crossOrigin="anonymous" style={{ flex: 1, height: "220px", objectFit: "cover", borderRadius: "12px", border: "1px solid #e5e7eb" }} />
                ))}
              </div>
            )}

            {/* Info Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "24px" }}>
              {apartmentType && (
                <InfoBox label={{ ar: "نوع الشقة", en: "Apartment Type", ru: "Тип квартиры", ka: "ბინის ტიპი", az: "Mənzil növü", tr: "Daire Tipi", zh: "户型", pl: "Typ mieszkania", he: "סוג דירה", it: "Tipo appartamento" }[pdfLang] || "Apartment Type"} value={getApartmentLabel(apartmentType, pdfLang)} />
              )}
              {selectedFloors.length > 0 && (
                <InfoBox label={{ ar: "الطابق", en: "Floor", ru: "Этаж", ka: "სართული", az: "Mərtəbə", tr: "Kat", zh: "楼层", pl: "Piętro", he: "קומה", it: "Piano" }[pdfLang] || "Floor"} value={selectedFloors.map((f) => floorLabel(f, pdfLang)).join("، ")} />
              )}
              {totalArea && (
                <InfoBox label={{ ar: "المساحة الإجمالية", en: "Total Area", ru: "Общая площадь", ka: "საერთო ფართობი", az: "Ümumi sahə", tr: "Toplam Alan", zh: "总面积", pl: "Całkowita powierzchnia", he: "שטח כולל", it: "Superficie totale" }[pdfLang] || "Total Area"} value={`${totalArea} م²`} />
              )}
              {pricePerMeter && (
                <InfoBox label={{ ar: "سعر المتر", en: "Price per m²", ru: "Цена за м²", ka: "ფასი მ²-ზე", az: "m² qiyməti", tr: "m² fiyatı", zh: "每平米价格", pl: "Cena za m²", he: "מחיר למ\"ר", it: "Prezzo per m²" }[pdfLang] || "Price per m²"} value={`$${formatCurrency(parseFloat(pricePerMeter))}`} accent />
              )}
              {totalPrice > 0 && (
                <InfoBox label={{ ar: "السعر الإجمالي", en: "Total Price", ru: "Общая цена", ka: "სრული ფასი", az: "Ümumi qiymət", tr: "Toplam Fiyat", zh: "总价格", pl: "Cena całkowita", he: "מחיר כולל", it: "Prezzo totale" }[pdfLang] || "Total Price"} value={`$${formatCurrency(totalPrice)}`} accent />
              )}
              {paymentPercent && totalPrice > 0 && (
                <InfoBox label={{ ar: "الدفعة الأولى", en: "Down Payment", ru: "Первоначальный взнос", ka: "პირველი შენატანი", az: "İlkin ödəniş", tr: "Peşinat", zh: "首付款", pl: "Wpłata własna", he: "מקדמה", it: "Acconto" }[pdfLang] || "Down Payment"} value={`${paymentPercent}% — $${formatCurrency(downPayment)}`} />
              )}
              {installments && monthlyInstallment > 0 && (
                <InfoBox label={{ ar: "القسط الشهري", en: "Monthly Installment", ru: "Ежемесячный платёж", ka: "ყოველთვიური გადასახადი", az: "Aylıq ödəniş", tr: "Aylık Taksit", zh: "月供", pl: "Rata miesięczna", he: "תשלום חודשי", it: "Rata mensile" }[pdfLang] || "Monthly Installment"} value={`$${formatCurrency(monthlyInstallment)} × ${installments}`} />
              )}
              {deliveryType && (
                <InfoBox label={{ ar: "طريقة التسليم", en: "Delivery Type", ru: "Тип сдачи", ka: "ჩაბარების ტიპი", az: "Çatdırılma növü", tr: "Teslim Tipi", zh: "交付方式", pl: "Typ odbioru", he: "סוג מסירה", it: "Tipo di consegna" }[pdfLang] || "Delivery Type"} value={getDeliveryLabel(deliveryType, pdfLang)} />
              )}
              {deliveryDate && (
                <InfoBox label={{ ar: "تاريخ التسليم", en: "Delivery Date", ru: "Дата сдачи", ka: "ჩაბარების თარიღი", az: "Çatdırılma tarixi", tr: "Teslim Tarihi", zh: "交付日期", pl: "Data odbioru", he: "תאריך מסירה", it: "Data di consegna" }[pdfLang] || "Delivery Date"} value={getDeliveryDateLabel(deliveryDate)} />
              )}
            </div>

            {/* Footer */}
            <div style={{ borderTop: "3px solid #3bcac4", paddingTop: "20px", textAlign: "center", marginTop: "auto" }}>
              <img src={logoPath} alt="Kinglike Luxury" crossOrigin="anonymous" style={{ height: "60px", width: "auto", objectFit: "contain", margin: "0 auto 12px", display: "block" }} />
              <a href="https://www.kinglikeluxury.app" style={{ color: "#005476", fontWeight: "bold", fontSize: "14px", textDecoration: "none", display: "block", marginBottom: "6px" }}>www.kinglikeluxury.app</a>
              <a href="tel:+995591000058" style={{ color: "#3bcac4", fontWeight: "bold", fontSize: "16px", textDecoration: "none" }}>+995 591 00 00 58</a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoBox({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ backgroundColor: accent ? "#005476" : "#f8fafc", borderRadius: "10px", padding: "14px 16px", border: `1px solid ${accent ? "#005476" : "#e5e7eb"}` }}>
      <div style={{ fontSize: "11px", color: accent ? "#3bcac4" : "#6b7280", marginBottom: "4px", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: "15px", fontWeight: "bold", color: accent ? "#ffffff" : "#005476" }}>{value}</div>
    </div>
  );
}
