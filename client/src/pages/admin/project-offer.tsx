import { useState, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
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
import {
  ONE_PENINSULA_IMAGE_HEIGHT,
  ONE_PENINSULA_IMAGE_PATH,
  ONE_PENINSULA_IMAGE_WIDTH,
  ONE_PENINSULA_PROPERTY_ID,
  ONE_PENINSULA_UNIT_POLYGONS,
} from "@/lib/floorPlans/onePeninsula";

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

const VIEW_TYPES = [
  { value: "city_batumi",    ar: "اطلالة على مدينة باتومي",                                              en: "City View – Batumi",                          ru: "Вид на город Батуми",                      ka: "ბათუმის ქალაქის ხედი",            az: "Batumi şəhər mənzərəsi",         tr: "Batum Şehir Manzarası",                zh: "巴统城市景观",           pl: "Widok na miasto Batumi",             he: "נוף לעיר באטומי",             it: "Vista sulla città di Batumi" },
  { value: "city_tbilisi",   ar: "اطلالة على مدينة تبليسي",                                              en: "City View – Tbilisi",                         ru: "Вид на город Тбилиси",                     ka: "თბილისის ქალაქის ხედი",           az: "Tbilisi şəhər mənzərəsi",        tr: "Tiflis Şehir Manzarası",               zh: "第比利斯城市景观",        pl: "Widok na miasto Tbilisi",            he: "נוף לעיר טביליסי",            it: "Vista sulla città di Tbilisi" },
  { value: "sea_partial",    ar: "إطلالة بحرية جزئية",                                                   en: "Partial Sea View",                            ru: "Частичный вид на море",                    ka: "ნაწილობრივი ზღვის ხედი",          az: "Qismən dəniz mənzərəsi",         tr: "Kısmi Deniz Manzarası",                zh: "部分海景",               pl: "Częściowy widok na morze",           he: "נוף ים חלקי",                 it: "Vista mare parziale" },
  { value: "sea_full",       ar: "إطلالة بحرية كاملة",                                                   en: "Full Sea View",                               ru: "Полный вид на море",                       ka: "სრული ზღვის ხედი",                az: "Tam dəniz mənzərəsi",            tr: "Tam Deniz Manzarası",                  zh: "全海景",                 pl: "Pełny widok na morze",               he: "נוף ים מלא",                  it: "Vista mare completa" },
  { value: "panoramic_sea_batumi", ar: "إطلالة بانورامية على البحر وعلى مدينة باتومي",                  en: "Panoramic Sea & Batumi City View",            ru: "Панорамный вид на море и Батуми",          ka: "პანორამული ზღვისა და ბათუმის ხედი", az: "Dəniz və Batumi panoramik mənzərəsi", tr: "Panoramik Deniz ve Batum Manzarası",  zh: "海景与巴统全景",          pl: "Panoramiczny widok na morze i Batumi", he: "נוף פנורמי ים ובאטומי",      it: "Vista panoramica mare e Batumi" },
  { value: "panoramic_ali_nino", ar: "اطلالة بانورامية على البحر وعلى تمثال علي ونينو وبرج الحروف الأبجدية", en: "Panoramic Sea, Ali & Nino Statue & Alphabet Tower View", ru: "Панорамный вид на море, Али и Нино, Башня алфавита", ka: "პანორამული ხედი — ზღვა, ალი და ნინო, ანბანის კოშკი", az: "Dəniz, Əli və Nino, Əlifba Qülləsi panoramik mənzərəsi", tr: "Panoramik Deniz, Ali ve Nino Heykeli ve Alfabe Kulesi Manzarası", zh: "海景、阿里尼诺雕像及字母塔全景", pl: "Panoramiczny widok na morze, pomnik Ali i Nino oraz Wieżę Alfabetu", he: "נוף פנורמי — ים, פסל עלי ונינו ומגדל האלפבית", it: "Vista panoramica mare, statua Ali & Nino e Torre dell'Alfabeto" },
  { value: "sea_batumi_city", ar: "اطلالة على البحر وعلى مدينة باتومي",                                  en: "Sea & Batumi City View",                      ru: "Вид на море и город Батуми",               ka: "ზღვისა და ბათუმის ხედი",          az: "Dəniz və Batumi şəhər mənzərəsi", tr: "Deniz ve Batum Şehir Manzarası",      zh: "海景与巴统城市景观",      pl: "Widok na morze i miasto Batumi",     he: "נוף ים ועיר באטומי",          it: "Vista mare e città di Batumi" },
  { value: "panoramic_palm_island", ar: "اطلالة بانورامية على البحر وعلى جزيرة النخيل",                 en: "Panoramic Sea & Palm Island View",            ru: "Панорамный вид на море и Пальмовый остров", ka: "პანორამული ხედი — ზღვა და პალმების კუნძული", az: "Dəniz və Xurma adası panoramik mənzərəsi", tr: "Panoramik Deniz ve Palm Adası Manzarası", zh: "海景与棕榈岛全景",        pl: "Panoramiczny widok na morze i Wyspę Palm", he: "נוף פנורמי — ים ואי הדקלים", it: "Vista panoramica mare e Isola delle Palme" },
  { value: "mountain",       ar: "اطلالة جبلية",                                                         en: "Mountain View",                               ru: "Вид на горы",                              ka: "მთის ხედი",                       az: "Dağ mənzərəsi",                  tr: "Dağ Manzarası",                        zh: "山景",                   pl: "Widok na góry",                      he: "נוף הרים",                    it: "Vista sulla montagna" },
  { value: "city_river_tbilisi", ar: "اطلالة على المدينة وعلى النهر بتبليسي",                            en: "City & River View – Tbilisi",                 ru: "Вид на город и реку в Тбилиси",            ka: "ქალაქისა და მდინარის ხედი — თბილისი", az: "Tbilisidə şəhər və çay mənzərəsi", tr: "Şehir ve Nehir Manzarası – Tiflis",   zh: "第比利斯城市与河流景观",    pl: "Widok na miasto i rzekę – Tbilisi",  he: "נוף עיר ונהר — טביליסי",     it: "Vista città e fiume – Tbilisi" },
];

const DELIVERY_TYPES = [
  { value: "black",       ar: "هيكل خام (على الأسود)", en: "Shell & Core", ru: "Черновая отделка", ka: "შავი კარკასი", az: "Qara karkasla", tr: "Ham Teslim (Sıfır)", zh: "毛坯交付", pl: "Stan surowy", he: "גלם (קירות חשופים)", it: "Grezzo" },
  { value: "white",       ar: "تشطيب أبيض (جدران ناعمة)", en: "White Box (Plastered)", ru: "Белая отделка", ka: "თეთრი მოსაპირკეთებელი", az: "Ağ çərçivə", tr: "Beyaz Teslim (Sıva Dahil)", zh: "白盒交付", pl: "Stan deweloperski", he: "קופסה לבנה", it: "Scatola bianca" },
  { value: "green_frame", ar: "تسليم على الأخضر", en: "Green Frame", ru: "Зелёный каркас", ka: "მწვანე კარკასი", az: "Yaşıl karkasla", tr: "Yeşil Çerçeve", zh: "绿框交付", pl: "Stan surowy zielony", he: "מסגרת ירוקה", it: "Struttura verde" },
  { value: "half",        ar: "تشطيب نصف جاهز", en: "Semi-Finished", ru: "Полуотделка", ka: "ნახევარი გათავება", az: "Yarı bitmiş", tr: "Yarı Bitişli", zh: "半精装", pl: "Pół-gotowy", he: "גמר חלקי", it: "Semi-rifinito" },
  { value: "full",        ar: "تشطيب كامل (جاهز للسكن والاستثمار)", en: "Fully Finished (Move-in & Investment Ready)", ru: "Полная отделка (под ключ)", ka: "სრული გათავება", az: "Tam bitmiş", tr: "Tam Bitişli (Hazır)", zh: "精装交付", pl: "Pełne wykończenie", he: "גמר מלא (מוכן למגורים)", it: "Completamente rifinito" },
  { value: "full_nofurn", ar: "تشطيب كامل (بدون مفروشات)", en: "Fully Finished (Unfurnished)", ru: "Полная отделка (без مبلمان)", ka: "სრული გათავება (ავეჯის გარეშე)", az: "Tam bitmiş (mebelssiz)", tr: "Tam Bitişli (Mobilyasız)", zh: "精装交付（无家具）", pl: "Pełne wykończenie (bez mebli)", he: "גמר מלא (ללא ריהוט)", it: "Completamente rifinito (non arredato)" },
  { value: "furnished",   ar: "تشطيب كامل مع الفرش والكهربائيات (تسليم على المفتاح)", en: "Fully Finished with Furniture & Appliances (Turnkey)", ru: "Полностью меблирован (под ключ)", ka: "სრულად ავეჯით", az: "Tam mebelli (açar təhvil)", tr: "Tam Eşyalı (Anahtar Teslim)", zh: "全装带家具交付", pl: "W pełni umeblowany (pod klucz)", he: "מרוהט במלואו (מפתח ביד)", it: "Arredato (chiavi in mano)" },
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

const SECOND_PAYMENT_DATES = Array.from({ length: 48 }, (_, index) => String(index + 1));

function getSecondPaymentDateLabel(value: string, lang: LangCode): string {
  const months = Number(value);
  if (!Number.isFinite(months) || months < 1) return "";

  if (lang === "ar") {
    const monthLabel = (count: number) =>
      count === 1 ? "شهر" : count === 2 ? "شهرين" : `${count} أشهر`;
    const yearLabel = (count: number) =>
      count === 1 ? "سنة" : count === 2 ? "سنتين" : `${count} سنوات`;
    if (months < 12) return `بعد ${monthLabel(months)}`;
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    return remainingMonths === 0
      ? `بعد ${yearLabel(years)}`
      : `بعد ${yearLabel(years)} و${monthLabel(remainingMonths)}`;
  }

  const monthLabel = (count: number) => `${count} ${count === 1 ? "month" : "months"}`;
  const yearLabel = (count: number) => `${count} ${count === 1 ? "year" : "years"}`;
  if (months < 12) return `After ${monthLabel(months)}`;
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  return remainingMonths === 0
    ? `After ${yearLabel(years)}`
    : `After ${yearLabel(years)} and ${monthLabel(remainingMonths)}`;
}

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
  aptNumber:      { ar:"رقم الشقة", en:"Apartment No.", ru:"№ квартиры", ka:"ბინის №", az:"Mənzil №", tr:"Daire No.", zh:"公寓编号", pl:"Nr mieszkania", he:"מס' דירה", it:"N° appartamento" },
  area:           { ar:"المساحة الإجمالية", en:"Total Area", ru:"Общая площадь", ka:"სრული ფართობი", az:"Ümumi sahə", tr:"Toplam Alan", zh:"建筑面积", pl:"Powierzchnia całkowita", he:"שטח כולל", it:"Superficie totale" },
  pricePerMeter:  { ar:"سعر المتر المربع يبدأ من", en:"Price per m² starts from", ru:"Цена за 1 м² от", ka:"ფასი 1 მ²-ზე იწყება", az:"1 m² qiyməti başlayır", tr:"m² Başlangıç Fiyatı", zh:"每平米起价", pl:"Cena za 1 m² od", he:"מחיר למ\"ר החל מ-", it:"Prezzo al m² a partire da" },
  totalPrice:     { ar:"السعر الإجمالي", en:"Total Price", ru:"Итоговая цена", ka:"სრული ღირებულება", az:"Ümumi qiymət", tr:"Toplam Fiyat", zh:"总价", pl:"Cena całkowita", he:"מחיר כולל", it:"Prezzo totale" },
  discount:       { ar:"نسبة الخصم", en:"Discount", ru:"Скидка", ka:"ფასდაკლება", az:"Endirim", tr:"İndirim", zh:"折扣", pl:"Zniżka", he:"הנחה", it:"Sconto" },
  priceAfterDiscount: { ar:"السعر بعد الخصم", en:"Price After Discount", ru:"Цена со скидкой", ka:"ფასი ფასდაკლებით", az:"Endirimdən sonra qiymət", tr:"İndirimli Fiyat", zh:"折后价格", pl:"Cena po zniżce", he:"מחיר לאחר הנחה", it:"Prezzo scontato" },
  downPayment:    { ar:"الدفعة الأولى", en:"Down Payment", ru:"Первоначальный взнос", ka:"პირველადი შენატანი", az:"İlkin ödəniş", tr:"Peşinat", zh:"首付款", pl:"Wpłata własna", he:"מקדמה", it:"Acconto iniziale" },
  finalPayment:   { ar:"الدفعة الأخيرة عند التسليم", en:"Final Payment on Delivery", ru:"Последний платёж при сдаче", ka:"საბოლოო გადახდა ჩაბარებისას", az:"Təhvil zamanı son ödəniş", tr:"Teslimde Son Ödeme", zh:"交付时尾款", pl:"Płatność końcowa przy odbiorze", he:"תשלום אחרון במסירה", it:"Pagamento finale alla consegna" },
  remaining:      { ar:"المبلغ المتبقي (التقسيط)", en:"Remaining (Installment)", ru:"Остаток (рассрочка)", ka:"დარჩენილი (განვადება)", az:"Qalan məbləğ (taksit)", tr:"Kalan Tutar (Taksit)", zh:"余款（分期）", pl:"Pozostało (rata)", he:"יתרה (תשלומים)", it:"Saldo a rate" },
  installments:   { ar:"عدد الأقساط الشهرية", en:"No. of Monthly Installments", ru:"Количество месяцев рассрочки", ka:"ყოველთვიური განვადების რაოდენობა", az:"Aylıq taksit sayı", tr:"Aylık Taksit Adedi", zh:"分期期数（月）", pl:"Liczba rat miesięcznych", he:"מספר תשלומים חודשיים", it:"N. rate mensili" },
  monthlyPayment: { ar:"قيمة القسط الشهري", en:"Monthly Installment", ru:"Ежемесячный платёж", ka:"ყოველთვიური გადასახადი", az:"Aylıq taksit məbləği", tr:"Aylık Taksit Tutarı", zh:"月供金额", pl:"Wysokość raty miesięcznej", he:"תשלום חודשי", it:"Rata mensile" },
  deliveryType:   { ar:"نوع التشطيب", en:"Finishing Type", ru:"Тип отделки", ka:"მოსაპირკეთებლის ტიპი", az:"Bitirmə növü", tr:"Teslim ve Bitişlik Tipi", zh:"装修交付标准", pl:"Standard wykończenia", he:"סוג הגמר", it:"Tipologia di finitura" },
  deliveryDate:   { ar:"موعد تسليم المشروع", en:"Project Delivery Date", ru:"Дата сдачи проекта", ka:"პროექტის ჩაბარების თარიღი", az:"Proyektin çatdırılma tarixi", tr:"Proje Teslim Tarihi", zh:"项目交付日期", pl:"Termin oddania projektu", he:"תאריך מסירת הפרויקט", it:"Data consegna progetto" },
  readyNow:       { ar:"جاهز للتسليم الفوري", en:"Ready for Immediate Delivery", ru:"Готов к немедленной сдаче", ka:"მზადაა — შეიძლება ახლავე ჩაბარება", az:"Dərhal çatdırılmağa hazır", tr:"Hemen Teslime Hazır", zh:"现房可立即交付", pl:"Gotowy — odbiór natychmiastowy", he:"מוכן למסירה מיידית", it:"Pronto per consegna immediata" },
  viewType:       { ar:"الإطلالة", en:"View", ru:"Вид", ka:"ხედი", az:"Mənzərə", tr:"Manzara", zh:"景观", pl:"Widok", he:"נוף", it:"Vista" },
  contact:        { ar:"للتواصل والاستفسار", en:"Contact & Inquiries", ru:"Связь и вопросы", ka:"კონტაქტი", az:"Əlaqə", tr:"İletişim ve Bilgi", zh:"联系与咨询", pl:"Kontakt i zapytania", he:"צור קשר", it:"Contatti e informazioni" },
  exclusiveOffer: { ar:"عرض حصري من شركة", en:"Exclusive offer presented by", ru:"Эксклюзивное предложение от", ka:"ექსკლუზიური შეთავაზება", az:"Eksklüziv təklif:", tr:"Özel Teklif — ", zh:"独家报价由", pl:"Oferta ekskluzywna od", he:"הצעה בלעדית מאת", it:"Offerta esclusiva di" },
  secondPayment: { ar:"الدفعة الثانية", en:"Second Payment", ru:"Второй платёж", ka:"მეორე გადახდა", az:"İkinci ödəniş", tr:"İkinci Ödeme", zh:"第二笔付款", pl:"Druga wpłata", he:"תשלום שני", it:"Secondo pagamento" },
  secondPaymentDate: { ar:"تاريخ الدفعة الثانية", en:"Second Payment Date", ru:"Дата второго платежа", ka:"მეორე გადახდის თარიღი", az:"İkinci ödəniş tarixi", tr:"İkinci Ödeme Tarihi", zh:"第二笔付款日期", pl:"Termin drugiej wpłaty", he:"מועד התשלום השני", it:"Data del secondo pagamento" },
};

function t(key: string, lang: LangCode): string {
  return T[key]?.[lang] ?? T[key]?.en ?? key;
}

/* ─── Silk Towers floor-plan highlight helpers ──────────────────────────── */

const SILK_TOWERS_FLOOR_PLAN_URL = "/silk-towers-floor-plan.jpg";

// Normalized coordinates [x1, y1, x2, y2] (0–1 fractions of image 1304×870 px)
// Calibrated via pixel-grid overlay on actual image:
//   APT_W = 0.033 per apartment column
//   X0    = 0.214 (left edge of apt 18 / apt 14)
//   Top row   y = [0.41, 0.55]   (City View side,  apts 17-32 L→R)
//   Bottom row y = [0.59, 0.75]  (Park View side,   apts 15-00 L→R, numbers decrease)
const SILK_APT_COORDS: Record<string, [number, number, number, number]> = {
  // ── Top row — City View (north side), left → right ────────────────
  "17": [0.170, 0.41, 0.214, 0.55], // corner left (Mountain View)
  "18": [0.214, 0.41, 0.247, 0.55],
  "19": [0.247, 0.41, 0.280, 0.55],
  "20": [0.280, 0.41, 0.313, 0.55],
  "21": [0.313, 0.41, 0.347, 0.55],
  "22": [0.347, 0.41, 0.380, 0.55],
  "23": [0.380, 0.41, 0.413, 0.55],
  "24": [0.413, 0.41, 0.447, 0.55],
  "25": [0.447, 0.41, 0.480, 0.55],
  "26": [0.480, 0.41, 0.513, 0.55],
  "27": [0.513, 0.41, 0.547, 0.55],
  "28": [0.547, 0.41, 0.580, 0.55],
  "29": [0.580, 0.41, 0.613, 0.55],
  "30": [0.613, 0.41, 0.647, 0.55],
  "31": [0.647, 0.41, 0.680, 0.55],
  "32": [0.680, 0.41, 0.750, 0.55], // corner right (Sea View top)
  // ── Bottom row — Park View (south side), left → right, numbers decrease ──
  "15": [0.170, 0.59, 0.214, 0.75], // corner left
  "14": [0.214, 0.59, 0.247, 0.75],
  "13": [0.247, 0.59, 0.280, 0.75],
  "12": [0.280, 0.59, 0.313, 0.75],
  "11": [0.313, 0.59, 0.347, 0.75],
  "10": [0.347, 0.59, 0.380, 0.75],
  "09": [0.380, 0.59, 0.413, 0.75],
  "08": [0.413, 0.59, 0.447, 0.75],
  "07": [0.447, 0.59, 0.480, 0.75],
  "06": [0.480, 0.59, 0.513, 0.75],
  "05": [0.513, 0.59, 0.547, 0.75],
  "04": [0.547, 0.59, 0.580, 0.75],
  "03": [0.580, 0.59, 0.613, 0.75],
  "02": [0.613, 0.59, 0.647, 0.75],
  "01": [0.647, 0.59, 0.680, 0.75],
  "00": [0.680, 0.59, 0.750, 0.75], // corner right (Sea View bottom)
  // ── Side studios (corridor level, between rows) ────────────────────
  "16": [0.170, 0.55, 0.214, 0.59], // Mountain View studio (left)
  "33": [0.680, 0.55, 0.750, 0.59], // Sea View studio (right)
};

const buildSilkTowersHighlight = async (aptNum: string): Promise<string> => {
  const key = aptNum.trim().padStart(2, "0");
  const coords = SILK_APT_COORDS[key] ?? SILK_APT_COORDS[aptNum.trim()];

  const dataUrl = await imgToBase64(SILK_TOWERS_FLOOR_PLAN_URL);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload  = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  if (coords) {
    const W = canvas.width, H = canvas.height;
    const [x1r, y1r, x2r, y2r] = coords;
    const x1 = x1r * W, y1 = y1r * H;
    const bw  = (x2r - x1r) * W, bh = (y2r - y1r) * H;

    // Semi-transparent teal fill
    ctx.fillStyle = "rgba(59,202,196,0.38)";
    ctx.fillRect(x1, y1, bw, bh);

    // Bold red border
    ctx.strokeStyle = "#e53e3e";
    ctx.lineWidth   = Math.max(4, W * 0.004);
    ctx.strokeRect(x1, y1, bw, bh);

    // Apartment number label
    const fontSize = Math.round(Math.min(bw, bh) * 0.45);
    ctx.font      = `bold ${fontSize}px Arial`;
    ctx.fillStyle = "#e53e3e";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(aptNum.trim(), x1 + bw / 2, y1 + bh / 2);
  }

  return canvas.toDataURL("image/jpeg", 0.93);
};

/* ─── Petra Sea Resort floor-plan highlight helpers ─────────────────────── */

const PETRA_SEA_RESORT_FLOOR_PLAN_URL = "/petra-sea-resort-floor-plan.jpg";

// Image: 1394 × 970 px
// Building footprint: x 0.022–0.979 , y 0.162–0.897
// Room 1801 = left-side unit (full building height)
// North row (sea/top):    odd  1803,1805…1831
// South row (garden/bot): even 1802,1804…1832
// Elevator/stairwell core: x 0.667–0.742
// Keys = last 2 digits of the room number  ("01" → 1801/2801/etc.)
// Coordinate format: [x1, y1, x2, y2] as fractions of image dimensions (1394×970 px)
// Pixel-calibrated via ImageMagick sampling:
//   Building left wall:  x ≈ 105px  → 0.075
//   Building top wall:   y ≈ 320px  → 0.330
//   Building bottom:     y ≈ 679px  → 0.700
//   North room bottom:   y ≈ 470px  → 0.484
//   South room top:      y ≈ 530px  → 0.546
const PETRA_APT_COORDS: Record<string, [number, number, number, number]> = {
  // ── Left side unit (full building height, x from left wall to col-1 start) ──
  "01": [0.078, 0.335, 0.107, 0.700],
  // ── North row (sea-facing, top)  y: 0.335 – 0.484 ────────────────────
  // 11 rooms before elevator core: x start=0.107, width per room=0.051
  "03": [0.107, 0.335, 0.158, 0.484],
  "05": [0.158, 0.335, 0.209, 0.484],
  "07": [0.209, 0.335, 0.260, 0.484],
  "09": [0.260, 0.335, 0.311, 0.484],
  "11": [0.311, 0.335, 0.362, 0.484],
  "13": [0.362, 0.335, 0.413, 0.484],
  "15": [0.413, 0.335, 0.464, 0.484],
  "17": [0.464, 0.335, 0.515, 0.484],
  "19": [0.515, 0.335, 0.566, 0.484],
  "21": [0.566, 0.335, 0.617, 0.484],
  "23": [0.617, 0.335, 0.667, 0.484],
  // elevator core x 0.667–0.742
  "25": [0.742, 0.335, 0.801, 0.484],
  "27": [0.801, 0.335, 0.860, 0.484],
  "29": [0.860, 0.335, 0.919, 0.484],
  "31": [0.919, 0.335, 0.979, 0.484],
  // ── South row (garden-facing, bottom)  y: 0.546 – 0.700 ──────────────
  "02": [0.107, 0.546, 0.158, 0.700],
  "04": [0.158, 0.546, 0.209, 0.700],
  "06": [0.209, 0.546, 0.260, 0.700],
  "08": [0.260, 0.546, 0.311, 0.700],
  "10": [0.311, 0.546, 0.362, 0.700],
  "12": [0.362, 0.546, 0.413, 0.700],
  "14": [0.413, 0.546, 0.464, 0.700],
  "16": [0.464, 0.546, 0.515, 0.700],
  "18": [0.515, 0.546, 0.566, 0.700],
  "20": [0.566, 0.546, 0.617, 0.700],
  "22": [0.617, 0.546, 0.667, 0.700],
  // elevator core x 0.667–0.742
  "24": [0.742, 0.546, 0.789, 0.700],
  "26": [0.789, 0.546, 0.836, 0.700],
  "28": [0.836, 0.546, 0.883, 0.700],
  "30": [0.883, 0.546, 0.930, 0.700],
  "32": [0.930, 0.546, 0.979, 0.700],
};

const buildPetraHighlight = async (aptNum: string): Promise<string> => {
  const raw = aptNum.trim();
  // Accept full room number ("1823") or 2-digit suffix ("23"); empty = no highlight
  const suffix = raw.length >= 3 ? raw.slice(-2).padStart(2, "0") : raw.length > 0 ? raw.padStart(2, "0") : "";
  const coords = suffix ? (PETRA_APT_COORDS[suffix] ?? PETRA_APT_COORDS[raw]) : undefined;

  const dataUrl = await imgToBase64(PETRA_SEA_RESORT_FLOOR_PLAN_URL);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload  = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  if (coords) {
    const W = canvas.width, H = canvas.height;
    const [x1r, y1r, x2r, y2r] = coords;
    const x1 = x1r * W, y1 = y1r * H;
    const bw  = (x2r - x1r) * W, bh = (y2r - y1r) * H;

    ctx.fillStyle = "rgba(59,202,196,0.38)";
    ctx.fillRect(x1, y1, bw, bh);

    ctx.strokeStyle = "#e53e3e";
    ctx.lineWidth   = Math.max(4, W * 0.004);
    ctx.strokeRect(x1, y1, bw, bh);

    const fontSize = Math.round(Math.min(bw, bh) * 0.30);
    ctx.font      = `bold ${fontSize}px Arial`;
    ctx.fillStyle = "#e53e3e";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(raw, x1 + bw / 2, y1 + bh / 2);
  }

  return canvas.toDataURL("image/jpeg", 0.93);
};

/* ─── Ambassadori Batumi Island floor-plan highlight helpers ────────────── */

const AMBASSADORI_FLOOR_PLAN_URL = "/ambassadori-floor-plan.jpg";

// Image: 1600 × 621 px
// Building footprint: x 0.044–0.956, y 0.161–0.935
// Elevator/stair core: x ~0.509–0.581 (top row), x ~0.481–0.494 (bottom row)
// Horizontal corridor: y 0.532
// Top row (even):   02(wide),04,06,08,10 | [elev] | 12,14,16,18,20,22
// Bottom row (odd): 01(wide),03,05,07,09,11 | [elev] | 13,15,17,19,21,23 + corner 25,24
// NOTE: apt 02 & 01 are large corner units (~109 m²), wider than normal apartments.
// All coordinates recalibrated from the actual floor plan image.
const AMBASSADORI_APT_COORDS: Record<string, [number, number, number, number]> = {
  // ── Top row (y: 0.161 → 0.532) ───────────────────────────────────────────
  "02": [0.044, 0.161, 0.163, 0.532],  // large corner unit (109 m²)
  "04": [0.163, 0.161, 0.260, 0.532],
  "06": [0.260, 0.161, 0.348, 0.532],
  "08": [0.348, 0.161, 0.428, 0.532],
  "10": [0.428, 0.161, 0.509, 0.532],
  // elevator/stair core x 0.509–0.577
  // Right section: 12(medium) + 14,16,18,20(regular) + 22(wide corner, mirrors apt 02)
  "12": [0.509, 0.161, 0.577, 0.532],
  "14": [0.577, 0.161, 0.645, 0.532],
  "16": [0.645, 0.161, 0.713, 0.532],
  "18": [0.713, 0.161, 0.781, 0.532],
  "20": [0.781, 0.161, 0.840, 0.532],
  "22": [0.840, 0.161, 0.953, 0.532],  // wide corner unit (mirrors apt 02 on left)
  // ── Bottom row (y: 0.532 → 0.935) ────────────────────────────────────────
  "01": [0.044, 0.532, 0.150, 0.935],  // large corner unit (108 m²)
  "03": [0.150, 0.532, 0.227, 0.935],
  "05": [0.227, 0.532, 0.283, 0.935],
  "07": [0.283, 0.532, 0.350, 0.935],
  "09": [0.350, 0.532, 0.416, 0.935],
  "11": [0.416, 0.532, 0.481, 0.935],
  // elevator/stair core x 0.481–0.494
  "13": [0.494, 0.532, 0.552, 0.935],
  "15": [0.552, 0.532, 0.610, 0.935],
  "17": [0.610, 0.532, 0.668, 0.935],
  "19": [0.668, 0.532, 0.726, 0.935],
  "21": [0.726, 0.532, 0.784, 0.935],
  "23": [0.784, 0.532, 0.840, 0.935],
  "25": [0.840, 0.532, 0.898, 0.735],  // corner top-right
  "24": [0.840, 0.735, 0.956, 0.935],  // corner bottom-right
};

const buildAmbassadoriHighlight = async (aptNum: string): Promise<string> => {
  const raw = aptNum.trim();
  const key = raw.padStart(2, "0");
  const coords = AMBASSADORI_APT_COORDS[key] ?? AMBASSADORI_APT_COORDS[raw];

  const dataUrl = await imgToBase64(AMBASSADORI_FLOOR_PLAN_URL);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload  = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  if (coords) {
    const W = canvas.width, H = canvas.height;
    const [x1r, y1r, x2r, y2r] = coords;
    const x1 = x1r * W, y1 = y1r * H;
    const bw  = (x2r - x1r) * W, bh = (y2r - y1r) * H;

    ctx.fillStyle = "rgba(59,202,196,0.38)";
    ctx.fillRect(x1, y1, bw, bh);

    ctx.strokeStyle = "#e53e3e";
    ctx.lineWidth   = Math.max(4, W * 0.004);
    ctx.strokeRect(x1, y1, bw, bh);

    const fontSize = Math.round(Math.min(bw, bh) * 0.35);
    ctx.font      = `bold ${fontSize}px Arial`;
    ctx.fillStyle = "#e53e3e";
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(raw, x1 + bw / 2, y1 + bh / 2);
  }

  return canvas.toDataURL("image/jpeg", 0.93);
};

/* ─── Crown Plaza Batumi floor-plan highlight helpers ───────────────────── */

const CROWN_PLAZA_FLOOR_PLAN_URL = "/crown-plaza-batumi-floor-plan.jpg";

// Image: 1438 × 759 px. Points are normalized [x, y] pairs traced from the
// supplied floor plan. Unit keys omit the visible "N" prefix so both "901"
// and "N901" map to the same apartment. Common corridors and cores are omitted.
type FloorPlanPoint = [number, number];
const CROWN_PLAZA_APT_POLYGONS: Record<string, FloorPlanPoint[]> = {
  "901": [[0.0470,0.3920],[0.0940,0.3480],[0.1510,0.3860],[0.1840,0.4480],[0.1640,0.5010],[0.1260,0.5480],[0.0730,0.5200],[0.0370,0.4670]],
  "902": [[0.0737,0.4158],[0.1356,0.3382],[0.1718,0.4513],[0.1697,0.4961],[0.1161,0.4961],[0.1057,0.4421],[0.0960,0.4329],[0.0862,0.4434]],
  "903": [[0.1439,0.3263],[0.1801,0.2921],[0.2253,0.4289],[0.2330,0.5000],[0.1808,0.4987],[0.1815,0.4434]],
  "904": [[0.1878,0.2750],[0.2163,0.2474],[0.2295,0.2500],[0.2677,0.4132],[0.2552,0.4961],[0.2406,0.4961],[0.2330,0.4211],[0.2107,0.3711]],
  "905": [[0.2378,0.2342],[0.2587,0.2289],[0.2698,0.2092],[0.2900,0.2474],[0.2990,0.3145],[0.3143,0.3289],[0.3074,0.3987],[0.2726,0.3868]],
  "906": [[0.2830,0.2039],[0.3004,0.1934],[0.2935,0.1658],[0.2976,0.1553],[0.3157,0.1513],[0.3199,0.1789],[0.3373,0.1724],[0.3526,0.3013],[0.3644,0.3197],[0.3602,0.4053],[0.3185,0.3987],[0.3213,0.3118],[0.3011,0.2211],[0.2851,0.2211]],
  "907": [[0.3505,0.2000],[0.4256,0.1711],[0.4214,0.3737],[0.3985,0.3697],[0.3922,0.3974],[0.3755,0.3934],[0.3783,0.2961],[0.3651,0.2934]],
  "908": [[0.4319,0.2342],[0.4353,0.1592],[0.4875,0.1461],[0.4854,0.3711],[0.4437,0.3658],[0.4471,0.3079],[0.4332,0.2908]],
  "909": [[0.4979,0.1908],[0.5007,0.1474],[0.5522,0.1553],[0.5438,0.3697],[0.4986,0.3697]],
  "910": [[0.5542,0.3513],[0.5612,0.1553],[0.5994,0.1684],[0.5862,0.2974],[0.6099,0.3263],[0.6001,0.3829],[0.5556,0.3711]],
  "911": [[0.5981,0.2842],[0.6127,0.1750],[0.6773,0.2132],[0.6752,0.2289],[0.6606,0.2289],[0.6384,0.3237],[0.6391,0.3342],[0.6711,0.3461],[0.6558,0.4184],[0.6106,0.3947],[0.6245,0.3132]],
  "912": [[0.6516,0.2053],[0.6940,0.2197],[0.7246,0.2303],[0.7246,0.2461],[0.7135,0.2868],[0.7031,0.3355],[0.7163,0.3566],[0.7093,0.3790],[0.6718,0.3645],[0.6586,0.3461],[0.6676,0.3184],[0.6551,0.3000],[0.6662,0.2605],[0.6752,0.2263]],
  "913": [[0.7024,0.3618],[0.7364,0.2158],[0.7997,0.2711],[0.7441,0.4763],[0.7142,0.4605],[0.7281,0.3868]],
  "914": [[0.7580,0.4842],[0.8102,0.2842],[0.8442,0.3263],[0.8157,0.4158],[0.8039,0.4237],[0.8046,0.4961]],
  "915": [[0.8185,0.4697],[0.8192,0.4447],[0.8554,0.3368],[0.9207,0.4263],[0.9006,0.4671],[0.9026,0.4934],[0.8255,0.5000]],
  "916": [[0.8150,0.4870],[0.8530,0.4720],[0.8850,0.5020],[0.9250,0.5590],[0.8920,0.6260],[0.8500,0.6980],[0.8080,0.6560],[0.7780,0.5910]],
  "917": [[0.8185,0.6013],[0.8206,0.5697],[0.8755,0.5592],[0.8762,0.5908],[0.8929,0.6237],[0.9047,0.6171],[0.9152,0.6421],[0.8560,0.7224]],
  "918": [[0.7719,0.6171],[0.7733,0.5605],[0.8122,0.5579],[0.8108,0.6197],[0.8463,0.7289],[0.8136,0.7684]],
  "919": [[0.7232,0.6421],[0.7399,0.5579],[0.7601,0.5632],[0.7545,0.6250],[0.7705,0.6447],[0.8060,0.7776],[0.7656,0.8158]],
  "920": [[0.6787,0.7329],[0.6808,0.6658],[0.7170,0.6553],[0.7566,0.8237],[0.7149,0.8579],[0.7093,0.8289],[0.6968,0.8158]],
  "921": [[0.6252,0.6921],[0.6293,0.6632],[0.6690,0.6671],[0.6745,0.7697],[0.6912,0.8447],[0.7086,0.8592],[0.6947,0.8776],[0.7010,0.9053],[0.6780,0.9158],[0.6711,0.8921],[0.6565,0.8987],[0.6412,0.7816],[0.6259,0.7316]],
  "922": [[0.5549,0.6947],[0.6147,0.6934],[0.6147,0.7500],[0.6259,0.7658],[0.6370,0.8605],[0.5661,0.8974],[0.5675,0.7605],[0.5556,0.7395]],
  "923": [[0.4986,0.7066],[0.5000,0.6895],[0.5459,0.6895],[0.5466,0.7513],[0.5542,0.7645],[0.5522,0.8974],[0.5007,0.9092]],
  "924": [[0.4374,0.8961],[0.4458,0.6921],[0.4903,0.6895],[0.4910,0.9145],[0.4381,0.9118]],
  "925": [[0.3818,0.7276],[0.3908,0.6763],[0.4124,0.6934],[0.4367,0.6868],[0.4284,0.9039],[0.3880,0.8895],[0.4033,0.7618]],
  "926": [[0.3129,0.8461],[0.3185,0.8289],[0.3303,0.8263],[0.3449,0.7513],[0.3428,0.7316],[0.3185,0.7158],[0.3338,0.6461],[0.3804,0.6697],[0.3658,0.7342],[0.3929,0.7763],[0.3783,0.8908],[0.3560,0.8882],[0.3477,0.8671],[0.3234,0.8632]],
  "927": [[0.2719,0.8145],[0.3004,0.6974],[0.2976,0.6724],[0.2802,0.6605],[0.2921,0.6079],[0.3268,0.6395],[0.3074,0.7250],[0.3310,0.7592],[0.3192,0.8105],[0.3074,0.8079],[0.3011,0.8513]],
  "928": [[0.1892,0.7789],[0.2392,0.5908],[0.2483,0.5816],[0.2747,0.5961],[0.2601,0.6750],[0.2865,0.7013],[0.2559,0.8408]],
  "929": [[0.1502,0.7263],[0.1905,0.5632],[0.2086,0.5579],[0.2302,0.5789],[0.1787,0.7671]],
  "930": [[0.0751,0.6329],[0.0974,0.5434],[0.1766,0.5645],[0.1356,0.7329]],
};

const buildCrownPlazaHighlight = async (aptNum: string): Promise<string> => {
  const raw = aptNum.trim();
  const key = raw.replace(/^N/i, "");
  const points = CROWN_PLAZA_APT_POLYGONS[key] ?? CROWN_PLAZA_APT_POLYGONS[raw];

  const dataUrl = await imgToBase64(CROWN_PLAZA_FLOOR_PLAN_URL);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  if (points) {
    const W = canvas.width, H = canvas.height;
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      const px = x * W, py = y * H;
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();

    ctx.fillStyle = "rgba(59,202,196,0.27)";
    ctx.fill();

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = Math.max(7, W * 0.0055);
    ctx.stroke();

    ctx.strokeStyle = "#e53e3e";
    ctx.lineWidth = Math.max(3, W * 0.0028);
    ctx.stroke();

    const centerX = points.reduce((sum, [x]) => sum + x, 0) / points.length * W;
    const centerY = points.reduce((sum, [, y]) => sum + y, 0) / points.length * H;
    ctx.font = `bold ${Math.round(W * 0.022)}px Arial`;
    ctx.fillStyle = "#e53e3e";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = Math.max(4, W * 0.0025);
    ctx.strokeText(raw, centerX, centerY);
    ctx.fillStyle = "#e53e3e";
    ctx.fillText(raw, centerX, centerY);
  }

  return canvas.toDataURL("image/jpeg", 0.93);
};

/* ─── One Peninsula floor-plan highlight helper ───────────────────────────── */

const normalizeOnePeninsulaUnitNumber = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/^N[-_\s]?/i, "");

  const digitGroups = normalized.match(/\d+/g) ?? [];

  for (const digits of digitGroups) {
    const number = Number(digits);
    if (number >= 101 && number <= 126) return String(number);

    const unitSuffix = Number(digits.slice(-2));
    if (unitSuffix >= 1 && unitSuffix <= 26) {
      return String(100 + unitSuffix);
    }
  }

  return normalized.replace(/\s+/g, "");
};

const buildOnePeninsulaHighlight = async (aptNum: string): Promise<string> => {
  const dataUrl = await imgToBase64(ONE_PENINSULA_IMAGE_PATH);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const raw = aptNum.trim();
  const key = normalizeOnePeninsulaUnitNumber(raw);
  const points = ONE_PENINSULA_UNIT_POLYGONS[
    key as keyof typeof ONE_PENINSULA_UNIT_POLYGONS
  ];

  if (points) {
    const W = canvas.width;
    const H = canvas.height;
    ctx.beginPath();
    points.forEach(([x, y], index) => {
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();

    ctx.fillStyle = "rgba(59,202,196,0.30)";
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = Math.max(7, W * 0.0055);
    ctx.stroke();
    ctx.strokeStyle = "#e53e3e";
    ctx.lineWidth = Math.max(3, W * 0.0028);
    ctx.stroke();

    const centerX = points.reduce((sum, [x]) => sum + x, 0) / points.length;
    const centerY = points.reduce((sum, [, y]) => sum + y, 0) / points.length;
    ctx.font = `bold ${Math.round(W * 0.022)}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = Math.max(4, W * 0.0025);
    ctx.strokeText(raw, centerX, centerY);
    ctx.fillStyle = "#e53e3e";
    ctx.fillText(key, centerX, centerY);
  }

  return canvas.toDataURL("image/jpeg", 0.93);
};

/* ─── Component ───────────────────────────────────────────────────────────── */

export default function ProjectOfferPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const pdfRef = useRef<HTMLDivElement>(null);

  const [selectedCountry, setSelectedCountry]   = useState("");
  const [selectedCity, setSelectedCity]         = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [apartmentType, setApartmentType]       = useState("");
  const [viewType, setViewType]                 = useState("");
  const [selectedBlock, setSelectedBlock]       = useState("");
  const [selectedFloors, setSelectedFloors]     = useState<number[]>([]);
  const [floorOpen, setFloorOpen]               = useState(false);
  const [apartmentNumber, setApartmentNumber]   = useState("");
  const [finalPaymentPercent, setFinalPaymentPercent] = useState<number | null>(null);
  const [totalArea, setTotalArea]               = useState("");
  const [pricePerMeter, setPricePerMeter]       = useState("");
  const [paymentPercent, setPaymentPercent]     = useState<number | null>(null);
  const [secondPaymentPercent, setSecondPaymentPercent] = useState<number | null>(null);
  const [secondPaymentDate, setSecondPaymentDate] = useState("");
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
  const [silkHighlightB64, setSilkHighlightB64] = useState<string>("");
  const [petraHighlightB64, setPetraHighlightB64] = useState<string>("");
  const [ambassadoriHighlightB64, setAmbassadoriHighlightB64] = useState<string>("");
  const [crownPlazaHighlightB64, setCrownPlazaHighlightB64] = useState<string>("");

  useEffect(() => {
    if (!authLoading && (!user || (!user.isAdmin && ![24, 29, 31].includes(user.id)))) navigate("/");
  }, [user, authLoading, navigate]);

  const { data: projects = [] } = useQuery<any[]>({ queryKey: ["/api/projects"] });

  const allProjects = projects.map((p: any) => ({
    id: p.propertyId || p.id,
    title: p.property?.title || p.title || "",
    location: p.property?.location || p.location || "",
    images: p.property?.images || p.images || [],
    developer: p.developer || "",
  }));

  // These options are also used to recognize cities embedded in full street
  // addresses, e.g. "Odysseas Dimitriadis Street, Tamari, Batumi".
  // Hardcoded countries and cities — not dependent on existing project data
  const COUNTRY_CITY_MAP: Record<string, string[]> = {
    "Georgia": ["Tbilisi", "Batumi", "Kutaisi", "Rustavi", "Zugdidi", "Gori", "Poti", "Telavi", "Mtskheta", "Kobuleti", "Borjomi", "Akhaltsikhe", "Senaki", "Anaklia", "Sighnaghi", "Ambrolauri", "Khashuri", "Samtredia", "Zestafoni", "Chiatura"],
    "UAE": ["Dubai", "Sharjah", "Ras Al Khaimah", "Abu Dhabi", "Ajman", "Fujairah", "Umm Al Quwain"],
    "Northern Cyprus (TRNC)": ["Lefkoşa (Nicosia)", "Gazimağusa (Famagusta)", "Girne (Kyrenia)", "İskele", "Güzelyurt", "Esentepe"],
    "Turkey": ["İstanbul", "Trabzon", "Ankara", "İzmir", "Antalya", "Bursa", "Alanya", "Mersin"],
  };

  const normalizeLocationPart = (value: string) => value.trim().toLocaleLowerCase();
  const locationCities = Object.entries(COUNTRY_CITY_MAP).flatMap(([country, cityList]) =>
    cityList.map((city) => ({ country, city, normalized: normalizeLocationPart(city) })),
  );

  const locParts = (loc: string) => {
    const parts = loc.split(",").map((s: string) => s.trim()).filter(Boolean);
    const normalizedParts = parts.map(normalizeLocationPart);
    const cityMatch = [...normalizedParts]
      .reverse()
      .map((part) => locationCities.find((entry) => entry.normalized === part))
      .find(Boolean);
    const countryMatch = [...normalizedParts]
      .reverse()
      .map((part) => Object.keys(COUNTRY_CITY_MAP).find(
        (country) => normalizeLocationPart(country) === part,
      ))
      .find(Boolean);

    return {
      city: cityMatch?.city || parts[0] || "",
      country: countryMatch || cityMatch?.country || parts[parts.length - 1] || "",
    };
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
  const downPayment         = paymentPercent ? (discountedPrice * paymentPercent) / 100 : 0;
  const secondPaymentAmount = secondPaymentPercent ? (discountedPrice * secondPaymentPercent) / 100 : 0;
  const finalPaymentAmount  = finalPaymentPercent ? (discountedPrice * finalPaymentPercent) / 100 : 0;
  const remainingBalance    = Math.max(0, discountedPrice - downPayment - secondPaymentAmount - finalPaymentAmount);
  const monthlyInstall      = installments && parseInt(installments) > 0 ? remainingBalance / parseInt(installments) : 0;

  const toggleFloor = (f: number) =>
    setSelectedFloors((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f].sort((a, b) => a - b));

  const getLangVal = (obj: any, lang: string): string => {
    if (typeof obj === "string") return obj;
    return obj?.[lang] || obj?.en || "";
  };

  const getAptLabel     = (val: string) => getLangVal(APARTMENT_TYPES.find((t) => t.value === val), pdfLang);
  const getDelivLabel   = (val: string) => getLangVal(DELIVERY_TYPES.find((t) => t.value === val), pdfLang);
  const getViewLabel    = (val: string) => getLangVal(VIEW_TYPES.find((t) => t.value === val), pdfLang);

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
    console.log("[PDF] generatePDF started", {
      projectId: selectedProject.id,
      projectTitle: selectedProject.title,
      selectedLanguage: pdfLang,
      imageUrls: selectedProject.images?.slice(0, 2),
    });
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
      console.log("[PDF] raw image URLs to convert:", rawUrls);
      const isSilk        = /silk/i.test(selectedProject.title ?? "")         || /سيلك/i.test(selectedProject.title ?? "");
      const isPetra       = /petra\s*sea/i.test(selectedProject.title ?? "")  || /بترا\s*سي/i.test(selectedProject.title ?? "");
      const isAmbassadori = /ambassadori/i.test(selectedProject.title ?? "")  || /أمباسادوري/i.test(selectedProject.title ?? "");
      const isCrownPlaza  = /crown\s*plaza/i.test(selectedProject.title ?? "") || /كراون\s*بلازا/i.test(selectedProject.title ?? "");
      const isOnePeninsula = selectedProject.id === ONE_PENINSULA_PROPERTY_ID
        || /one\s*peninsula/i.test(selectedProject.title ?? "");

      const [loaded, fpB64, silkB64, petraB64, ambB64, crownPlazaB64] = await Promise.all([
        Promise.all(rawUrls.map((u: string) => imgToBase64(u))),
        isOnePeninsula
          ? buildOnePeninsulaHighlight(apartmentNumber).catch((e) => { console.error("One Peninsula floor plan error:", e); return ""; })
          : selectedFloorPlan ? imgToBase64(selectedFloorPlan) : Promise.resolve(""),
        isSilk && apartmentNumber.trim()
          ? buildSilkTowersHighlight(apartmentNumber).catch(() => "")
          : Promise.resolve(""),
        isPetra
          ? buildPetraHighlight(apartmentNumber).catch((e) => { console.error("Petra highlight error:", e); return ""; })
          : Promise.resolve(""),
        isAmbassadori
          ? buildAmbassadoriHighlight(apartmentNumber).catch((e) => { console.error("Ambassadori highlight error:", e); return ""; })
          : Promise.resolve(""),
        isCrownPlaza
          ? buildCrownPlazaHighlight(apartmentNumber).catch((e) => { console.error("Crown Plaza highlight error:", e); return ""; })
          : Promise.resolve(""),
      ]);

      // Force-sync all state updates into the DOM in one shot before capture
      flushSync(() => {
        setB64Images(loaded);
        setFloorPlanB64(fpB64);
        setFlagB64(makeGeorgiaFlagB64());
        setSilkHighlightB64(silkB64);
        setPetraHighlightB64(petraB64);
        setAmbassadoriHighlightB64(ambB64);
        setCrownPlazaHighlightB64(crownPlazaB64);
      });

      const el = pdfRef.current;
      if (!el) return;
      el.style.display = "block";
      // Give the browser time to decode and paint all images (especially floor plan)
      await new Promise((r) => setTimeout(r, 800));

      // 4. Capture via html-to-image (SVG foreignObject → proper Arabic shaping)
      console.log("[PDF] starting toPng capture...");
      const dataUrl = await toPng(el, {
        pixelRatio: 3,
        backgroundColor: "#ffffff",
        cacheBust: true,
        // Embed fonts so SVG renderer can shape Arabic correctly
        fontEmbedCSS: `
          @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;900&family=Tajawal:wght@400;500;700;900&family=Noto+Sans+Arabic:wght@400;600;700&display=swap');
        `,
      });
      console.log("[PDF] toPng captured, dataUrl length:", dataUrl?.length, "prefix:", dataUrl?.slice(0, 30));
      el.style.display = "none";

      // 5. Build filename: ProjectName - Block(optional) - Floor - AptNumber - Area - Price
      const blockStr    = selectedBlock.trim() ? `Block_${selectedBlock.trim()}` : "";
      const floorStr    = selectedFloors.length > 0 ? `Floor_${floorsLabel(selectedFloors).replace(/\s/g, "_")}` : "";
      const aptStr      = apartmentNumber.trim() ? `Apt_${apartmentNumber.trim()}` : "";
      const areaStr     = totalArea ? `${totalArea}m2` : "";
      const finalAmt    = discountedPrice > 0 ? discountedPrice : totalPrice;
      const priceStr    = finalAmt > 0 ? `$${fmt(finalAmt)}` : "";
      const parts = [
        selectedProject.title || "offer",
        blockStr,
        floorStr,
        aptStr,
        areaStr,
        priceStr,
      ].filter(Boolean).map((s) => s.replace(/\s+/g, "_").replace(/[^\w$.\-]/g, ""));
      const filename = `${parts.join(" - ")}.pdf`;

      // 6. Create PDF and trigger direct download
      const img  = new Image();
      img.src    = dataUrl;
      await new Promise((r) => { img.onload = r; });
      const pw     = 210;
      const totalMm = Math.round((img.naturalHeight / img.naturalWidth) * pw);
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [pw, totalMm] });
      pdf.addImage(dataUrl, "PNG", 0, 0, pw, totalMm, undefined, "FAST");
      console.log("[PDF] saving file:", filename, "| dims:", pw, "×", totalMm, "mm");
      pdf.save(filename);
      console.log("[PDF] download triggered successfully");
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
  if (!user?.isAdmin && ![24, 29, 31].includes(user?.id ?? -1)) return null;

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

            <div>
              <Label className="text-xs text-gray-500 mb-1 block">الإطلالة <span className="text-gray-400">(اختياري)</span></Label>
              <Select value={viewType} onValueChange={setViewType}>
                <SelectTrigger className="h-9"><SelectValue placeholder="اختر نوع الإطلالة" /></SelectTrigger>
                <SelectContent>
                  {VIEW_TYPES.map((vt) => <SelectItem key={vt.value} value={vt.value}>{vt.ar}</SelectItem>)}
                </SelectContent>
              </Select>
              {viewType && (
                <button type="button" onClick={() => setViewType("")} className="mt-1 text-xs text-gray-400 hover:text-red-500">✕ إزالة الإطلالة</button>
              )}
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
                {["D1","D2","D3","D4","K1","K2","K3","K4","K5","K6"].map((b) => (
                  <option key={b} value={b}>{b}</option>
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
            {/* Apartment Number */}
            <div>
              <Label className="text-xs text-gray-500 mb-1 block">رقم الشقة</Label>
              <input
                type="text"
                value={apartmentNumber}
                onChange={(e) => setApartmentNumber(e.target.value)}
                placeholder="مثال: 301"
                className="w-full h-9 border border-input rounded-md px-3 text-sm bg-white text-right placeholder:text-gray-400"
              />
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

            {/* Second payment */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-500 mb-1.5 block">الدفعة الثانية (%)</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {PAYMENT_PERCENTAGES.map((p) => (
                    <button
                      key={p} type="button"
                      onClick={() => setSecondPaymentPercent(secondPaymentPercent === p ? null : p)}
                      className={`py-1.5 rounded-md text-xs font-semibold border transition-all ${secondPaymentPercent === p ? "bg-[#3bcac4] text-white border-[#3bcac4] shadow-sm" : "bg-white text-gray-600 border-gray-200 hover:border-[#3bcac4]"}`}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
                {secondPaymentPercent && discountedPrice > 0 && (
                  <div className="mt-2 rounded-lg border border-[#3bcac4]/30 bg-[#3bcac4]/5 p-2 text-center">
                    <div className="text-xs text-gray-500 mb-0.5">مبلغ الدفعة الثانية</div>
                    <div className="font-bold text-[#005476]">${fmt(secondPaymentAmount)}</div>
                  </div>
                )}
              </div>
              <div>
                <Label className="text-xs text-gray-500 mb-1.5 block">تاريخ الدفعة الثانية</Label>
                <Select value={secondPaymentDate} onValueChange={setSecondPaymentDate}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="اختر موعد الدفعة الثانية" /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {SECOND_PAYMENT_DATES.map((months) => (
                      <SelectItem key={months} value={months}>
                        {getSecondPaymentDateLabel(months, "ar")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {secondPaymentDate && (
                  <button
                    type="button"
                    onClick={() => setSecondPaymentDate("")}
                    className="mt-1 text-xs text-gray-400 hover:text-red-500"
                  >
                    ✕ إزالة التاريخ
                  </button>
                )}
              </div>
            </div>

            {/* Final Payment on Delivery */}
            <div>
              <Label className="text-xs text-gray-500 mb-1.5 block">الدفعة الأخيرة عند التسليم (%)</Label>
              <div className="grid grid-cols-5 gap-1.5">
                {[5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95].map((p) => (
                  <button
                    key={p} type="button"
                    onClick={() => setFinalPaymentPercent(finalPaymentPercent === p ? null : p)}
                    className={`py-1.5 rounded-md text-xs font-semibold border transition-all ${finalPaymentPercent === p ? "bg-[#005476] text-white border-[#005476] shadow-sm" : "bg-white text-gray-600 border-gray-200 hover:border-[#005476]"}`}
                  >
                    {p}%
                  </button>
                ))}
              </div>
              {finalPaymentPercent && discountedPrice > 0 && (
                <div className="mt-2 rounded-lg border border-[#005476]/30 bg-[#005476]/5 p-3 flex justify-between items-center">
                  <div className="text-right">
                    <div className="text-xs text-gray-500">نسبة الدفعة الأخيرة</div>
                    <div className="text-xs font-semibold text-[#005476]">{finalPaymentPercent}%</div>
                  </div>
                  <div className="text-left">
                    <div className="text-xs text-gray-500 mb-0.5">مبلغ الدفعة الأخيرة</div>
                    <div className="text-lg font-bold text-[#005476]">${fmt(finalPaymentAmount)}</div>
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
            apartmentNumber={apartmentNumber}
            totalArea={totalArea}
            pricePerMeter={pricePerMeter}
            totalPrice={totalPrice}
            discountVal={discountVal}
            discountedPrice={discountedPrice}
            paymentPercent={paymentPercent}
            downPayment={downPayment}
            secondPaymentPercent={secondPaymentPercent}
            secondPaymentAmount={secondPaymentAmount}
            secondPaymentDate={secondPaymentDate}
            finalPaymentPercent={finalPaymentPercent}
            finalPaymentAmount={finalPaymentAmount}
            remainingBalance={remainingBalance}
            installments={installments}
            monthlyInstall={monthlyInstall}
            deliveryType={deliveryType}
            deliveryDate={deliveryDate}
            getAptLabel={getAptLabel}
            getDelivLabel={getDelivLabel}
            getViewLabel={getViewLabel}
            getDateLabel={getDateLabel}
            getSecondPaymentDateLabel={getSecondPaymentDateLabel}
            floorsLabel={floorsLabel}
            fmt={fmt}
            viewType={viewType}
            silkHighlightB64={silkHighlightB64}
            petraHighlightB64={petraHighlightB64}
            ambassadoriHighlightB64={ambassadoriHighlightB64}
            crownPlazaHighlightB64={crownPlazaHighlightB64}
          />
        )}
      </div>
    </div>
  );
}

/* ─── PDF Template Component ──────────────────────────────────────────────── */

function PDFTemplate({
  project, b64Images, floorPlanB64, flagB64, lang, isRTL,
  apartmentType, selectedBlock, selectedFloors, apartmentNumber, totalArea, pricePerMeter,
  totalPrice, discountVal, discountedPrice, paymentPercent, downPayment,
  secondPaymentPercent, secondPaymentAmount, secondPaymentDate,
  finalPaymentPercent, finalPaymentAmount, remainingBalance,
  installments, monthlyInstall, deliveryType, deliveryDate,
  getAptLabel, getDelivLabel, getViewLabel, getDateLabel, getSecondPaymentDateLabel, floorsLabel, fmt,
  viewType, silkHighlightB64, petraHighlightB64, ambassadoriHighlightB64, crownPlazaHighlightB64
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
  const isOnePeninsula = project.id === ONE_PENINSULA_PROPERTY_ID
    || /one\s*peninsula/i.test(project.title ?? "");
  const onePeninsulaUnitKey = isOnePeninsula
    ? normalizeOnePeninsulaUnitNumber(apartmentNumber ?? "")
    : "";
  const onePeninsulaPoints = ONE_PENINSULA_UNIT_POLYGONS[
    onePeninsulaUnitKey as keyof typeof ONE_PENINSULA_UNIT_POLYGONS
  ];

  // Build detail rows — only non-empty fields
  const rows: { label: string; value: string; accent?: boolean; group?: "secondPayment" }[] = [];
  if (apartmentType)          rows.push({ label: t("aptType",lang),      value: getAptLabel(apartmentType) });
  if (viewType)               rows.push({ label: t("viewType",lang),     value: getViewLabel(viewType) });
  if (selectedBlock)          rows.push({ label: t("block",lang),         value: selectedBlock });
  if (selectedFloors?.length) rows.push({ label: t("floor",lang),        value: floorsLabel(selectedFloors) });
  if (apartmentNumber)        rows.push({ label: t("aptNumber",lang),     value: apartmentNumber });
  if (totalArea)              rows.push({ label: t("area",lang),          value: `${totalArea} m²` });
  if (pricePerMeter)          rows.push({ label: t("pricePerMeter",lang), value: `$${fmt(parseFloat(pricePerMeter))} / m²` });
  if (discountVal > 0 && totalPrice > 0) {
    rows.push({ label: `${t("discount",lang)} — ${discountVal}%`, value: `$${fmt(totalPrice)} ← $${fmt(discountedPrice)}` });
    rows.push({ label: t("priceAfterDiscount",lang), value: `$${fmt(discountedPrice)}`, accent: true });
  }
  if (paymentPercent && discountedPrice > 0)
    rows.push({ label: `${t("downPayment",lang)} — ${paymentPercent}%`,  value: `$${fmt(downPayment)}` });
  if (secondPaymentPercent && discountedPrice > 0)
    rows.push({ label: `${t("secondPayment",lang)} — ${secondPaymentPercent}%`, value: `$${fmt(secondPaymentAmount)}`, group: "secondPayment" });
  if (secondPaymentDate)
    rows.push({ label: t("secondPaymentDate",lang), value: getSecondPaymentDateLabel(secondPaymentDate, lang), group: "secondPayment" });
  if (finalPaymentPercent && discountedPrice > 0)
    rows.push({ label: `${t("finalPayment",lang)} — ${finalPaymentPercent}%`, value: `$${fmt(finalPaymentAmount)}` });
  if ((paymentPercent || finalPaymentPercent) && discountedPrice > 0)
    rows.push({ label: t("remaining",lang),    value: `$${fmt(remainingBalance)}` });
  if (installments)           rows.push({ label: t("installments",lang),  value: installments });
  if (monthlyInstall > 0)     rows.push({ label: t("monthlyPayment",lang), value: `$${fmt(monthlyInstall)}`, accent: true });
  if (deliveryType)           rows.push({ label: t("deliveryType",lang),  value: getDelivLabel(deliveryType) });
  if (deliveryDate)           rows.push({ label: t("deliveryDate",lang),  value: getDateLabel(deliveryDate) });
  const secondPaymentRows = rows.filter((row) => row.group === "secondPayment");

  // ── Helpers for inline RTL on text nodes only (avoids html2canvas RTL canvas-flip bug)
  const txt  = (extra?: object) => ({ direction: dir, unicodeBidi: "embed" as const, ...(extra ?? {}) });
  const ta: "right" | "left" = isRTL ? "right" : "left";

  const S = {
    // IMPORTANT: page is always LTR — RTL applied per-text-element only
    page:       { width: W, backgroundColor: "#fff", fontFamily: ff, direction: "ltr" as const, overflow: "hidden" as const },
    header:     { background: "#ffffff", padding: "22px 40px 30px", position: "relative" as const, height: 273, boxSizing: "border-box" as const },
    hLogo:      { flexShrink: 0 },
    hCenter:    { position: "absolute" as const, top: 22, left: "50%", transform: "translateX(-50%)", textAlign: "center" as const, width: "max-content", maxWidth: 430 },
    hTagline:   { fontSize: 17, color: "#3bcac4", letterSpacing: 3, marginBottom: 6, fontWeight: 600 as const },
    hTitle:     { fontSize: 40, fontWeight: 900 as const, color: "#005476", lineHeight: 1.25, marginTop: 10, direction: dir, unicodeBidi: "embed" as const },
    hRight:     { position: "absolute" as const, top: "50%", right: 40, transform: "translateY(-50%)", textAlign: "right" as const },
    hLocation:  { fontSize: 22, color: "#3bcac4", fontWeight: 700 as const, marginTop: 4, textAlign: "right" as const, direction: dir, unicodeBidi: "embed" as const, whiteSpace: "nowrap" as const },
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
    fRight:     { textAlign: "right" as const, minWidth: 290, flexShrink: 0 },
    fPhoneLbl:  { fontSize: 16, color: "#94a3b8", marginBottom: 3, letterSpacing: 1, whiteSpace: "nowrap" as const },
    fPhone:     { color: "#005476", fontWeight: 900 as const, fontSize: 24, letterSpacing: 0.5, whiteSpace: "nowrap" as const },
    fLabel:     { fontSize: 18, color: "#94a3b8", ...txt() },
  };

  return (
    <div style={S.page}>

      {/* ── Header — logo CENTER · location RIGHT (always, all langs) ── */}
      <div style={{ ...S.header, direction: "ltr" }}>
        {/* Center: original-color logo + project title */}
        <div style={S.hCenter}>
          <img
            src={logoPath}
            alt="Kinglike"
            style={{ height: 160, width: "auto", objectFit: "contain", display: "inline-block", marginBottom: 8 }}
          />
          <div style={{ ...S.hTitle, fontSize: 34, whiteSpace: "nowrap" as const, overflow: "visible" as const }}>{project.title}</div>
        </div>

        {/* Right: city / country */}
        <div style={S.hRight}>
          <div style={{ ...S.hLocation, display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
            {flagB64 && (
              <img
                src={flagB64}
                alt="GE"
                style={{ width: 34, height: 23, objectFit: "fill", border: "1px solid #e2e8f0", borderRadius: 2, flexShrink: 0 }}
              />
            )}
            <span>باتومي - جورجيا</span>
          </div>
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
        {rows.map((row, i) => {
          if (row.group === "secondPayment") {
            if (rows[i - 1]?.group === "secondPayment") return null;
            return (
              <div
                key="second-payment-pair"
                style={{
                  gridColumn: "1 / -1",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 14,
                  direction: dir,
                }}
              >
                {secondPaymentRows.map((paymentRow) => (
                  <div key={paymentRow.label} style={S.cell}>
                    <div dir={dir} style={S.cellLbl}>{paymentRow.label}</div>
                    <div dir={dir} style={S.cellVal}>{paymentRow.value}</div>
                  </div>
                ))}
              </div>
            );
          }

          return (
            <div key={i} style={row.accent ? S.cellAccent : S.cell}>
              <div dir={dir} style={row.accent ? S.cellLblA : S.cellLbl}>{row.label}</div>
              <div dir={dir} style={row.accent ? S.cellValA : S.cellVal}>{row.value}</div>
            </div>
          );
        })}
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
              <div dir={dir} style={{ fontSize: 21, fontWeight: 700, color: "#fff", fontFamily: ff, direction: dir, unicodeBidi: "embed" as const, whiteSpace: "nowrap" as const }}>
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
            <div style={{ background: "#f8f9fa", textAlign: "center" as const, padding: "16px" }}>
              <div style={{ position: "relative" as const, display: "inline-block", maxWidth: "100%", lineHeight: 0 }}>
                <img
                  src={floorPlanB64}
                  style={{
                    maxWidth: "100%",
                    maxHeight: 400,
                    objectFit: "contain",
                    display: "block",
                  }}
                />
                {onePeninsulaPoints && (
                  <svg
                    viewBox={`0 0 ${ONE_PENINSULA_IMAGE_WIDTH} ${ONE_PENINSULA_IMAGE_HEIGHT}`}
                    preserveAspectRatio="none"
                    aria-label={`Selected apartment ${onePeninsulaUnitKey}`}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
                  >
                    <polygon
                      points={onePeninsulaPoints.map(([x, y]) => `${x},${y}`).join(" ")}
                      fill="rgba(59,202,196,0.38)"
                      stroke="rgba(255,255,255,0.95)"
                      strokeWidth="10"
                      strokeLinejoin="round"
                    />
                    <polygon
                      points={onePeninsulaPoints.map(([x, y]) => `${x},${y}`).join(" ")}
                      fill="none"
                      stroke="#e53e3e"
                      strokeWidth="5"
                      strokeLinejoin="round"
                    />
                    <text
                      x={onePeninsulaPoints.reduce((sum, [x]) => sum + x, 0) / onePeninsulaPoints.length}
                      y={onePeninsulaPoints.reduce((sum, [, y]) => sum + y, 0) / onePeninsulaPoints.length}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#e53e3e"
                      stroke="#ffffff"
                      strokeWidth="3"
                      paintOrder="stroke"
                      fontSize="32"
                      fontWeight="700"
                    >
                      {onePeninsulaUnitKey}
                    </text>
                  </svg>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Silk Towers highlighted floor plan ── */}
      {silkHighlightB64 && (
        <div style={{ padding: "0 40px 20px" }}>
          <div style={{
            borderRadius: 14,
            overflow: "hidden",
            border: "2.5px solid #005476",
            boxShadow: "0 4px 20px rgba(0,84,118,0.15)",
          }}>
            {/* Section label bar */}
            <div style={{
              background: "#005476",
              padding: "10px 20px",
              display: "flex",
              flexDirection: isRTL ? "row-reverse" : "row",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{ fontSize: 18 }}>🗺️</div>
              <div dir={dir} style={{ fontSize: 21, fontWeight: 700, color: "#fff", fontFamily: ff, direction: dir, unicodeBidi: "embed" as const, whiteSpace: "nowrap" as const }}>
                {lang === "ar" ? `مخطط الطابق — الشقة رقم ${apartmentNumber}` :
                 lang === "he" ? `תוכנית הקומה — דירה ${apartmentNumber}` :
                 lang === "ru" ? `План этажа — квартира ${apartmentNumber}` :
                 lang === "ka" ? `სართულის გეგმა — ბინა ${apartmentNumber}` :
                 lang === "az" ? `Mərtəbə planı — mənzil ${apartmentNumber}` :
                 lang === "tr" ? `Kat Planı — Daire ${apartmentNumber}` :
                 lang === "zh" ? `楼层平面图 — ${apartmentNumber} 号公寓` :
                 lang === "pl" ? `Plan piętra — mieszkanie ${apartmentNumber}` :
                 lang === "it" ? `Planimetria — Appartamento ${apartmentNumber}` :
                 `Floor Plan — Apartment ${apartmentNumber}`}
              </div>
            </div>
            {/* Highlighted floor plan image */}
            <div style={{ background: "#f8f9fa", textAlign: "center" as const, padding: "16px" }}>
              <img
                src={silkHighlightB64}
                style={{ maxWidth: "100%", height: "auto", display: "inline-block", borderRadius: 8 }}
              />
            </div>
            {/* Legend */}
            <div style={{
              background: "#f0f4f8",
              padding: "10px 20px",
              display: "flex",
              flexDirection: isRTL ? "row-reverse" : "row",
              alignItems: "center",
              gap: 12,
              borderTop: "1px solid #dde3ea",
            }}>
              <div style={{ width: 20, height: 20, background: "rgba(59,202,196,0.38)", border: "2px solid #e53e3e", borderRadius: 3, flexShrink: 0 }} />
              <div dir={dir} style={{ fontSize: 15, color: "#475569", fontFamily: ff, direction: dir, unicodeBidi: "embed" as const, whiteSpace: "nowrap" as const }}>
                {lang === "ar" ? `الشقة المحددة: رقم ${apartmentNumber}` :
                 lang === "he" ? `הדירה הנבחרת: מס' ${apartmentNumber}` :
                 lang === "ru" ? `Выбранная квартира: № ${apartmentNumber}` :
                 lang === "ka" ? `არჩეული ბინა: № ${apartmentNumber}` :
                 lang === "az" ? `Seçilmiş mənzil: № ${apartmentNumber}` :
                 lang === "tr" ? `Seçilen Daire: No. ${apartmentNumber}` :
                 lang === "zh" ? `所选公寓：${apartmentNumber} 号` :
                 lang === "pl" ? `Wybrane mieszkanie: nr ${apartmentNumber}` :
                 lang === "it" ? `Appartamento selezionato: n° ${apartmentNumber}` :
                 `Selected Apartment: No. ${apartmentNumber}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Petra Sea Resort highlighted floor plan ── */}
      {petraHighlightB64 && (
        <div style={{ padding: "0 40px 20px" }}>
          <div style={{
            borderRadius: 14,
            overflow: "hidden",
            border: "2.5px solid #005476",
            boxShadow: "0 4px 20px rgba(0,84,118,0.15)",
          }}>
            {/* Section label bar */}
            <div style={{
              background: "#005476",
              padding: "10px 20px",
              display: "flex",
              flexDirection: isRTL ? "row-reverse" : "row",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{ fontSize: 18 }}>🗺️</div>
              <div dir={dir} style={{ fontSize: 21, fontWeight: 700, color: "#fff", fontFamily: ff, direction: dir, unicodeBidi: "embed" as const, whiteSpace: "nowrap" as const }}>
                {lang === "ar" ? `مخطط الطابق — الغرفة رقم ${apartmentNumber}` :
                 lang === "he" ? `תוכנית הקומה — חדר ${apartmentNumber}` :
                 lang === "ru" ? `План этажа — номер ${apartmentNumber}` :
                 lang === "ka" ? `სართულის გეგმა — ოთახი ${apartmentNumber}` :
                 lang === "az" ? `Mərtəbə planı — otaq ${apartmentNumber}` :
                 lang === "tr" ? `Kat Planı — Oda ${apartmentNumber}` :
                 lang === "zh" ? `楼层平面图 — ${apartmentNumber} 号房` :
                 lang === "pl" ? `Plan piętra — pokój ${apartmentNumber}` :
                 lang === "it" ? `Planimetria — Appartamento ${apartmentNumber}` :
                 `Floor Plan — Unit ${apartmentNumber}`}
              </div>
            </div>
            {/* Highlighted floor plan image */}
            <div style={{ background: "#f8f9fa", textAlign: "center" as const, padding: "16px" }}>
              <img
                src={petraHighlightB64}
                style={{ maxWidth: "100%", height: "auto", display: "inline-block", borderRadius: 8 }}
              />
            </div>
            {/* Legend */}
            <div style={{
              background: "#f0f4f8",
              padding: "10px 20px",
              display: "flex",
              flexDirection: isRTL ? "row-reverse" : "row",
              alignItems: "center",
              gap: 12,
              borderTop: "1px solid #dde3ea",
            }}>
              <div style={{ width: 20, height: 20, background: "rgba(59,202,196,0.38)", border: "2px solid #e53e3e", borderRadius: 3, flexShrink: 0 }} />
              <div dir={dir} style={{ fontSize: 15, color: "#475569", fontFamily: ff, direction: dir, unicodeBidi: "embed" as const, whiteSpace: "nowrap" as const }}>
                {lang === "ar" ? `الغرفة المحددة: رقم ${apartmentNumber}` :
                 lang === "he" ? `החדר הנבחר: מס' ${apartmentNumber}` :
                 lang === "ru" ? `Выбранный номер: ${apartmentNumber}` :
                 lang === "ka" ? `არჩეული ოთახი: ${apartmentNumber}` :
                 lang === "az" ? `Seçilmiş otaq: ${apartmentNumber}` :
                 lang === "tr" ? `Seçilen Oda: ${apartmentNumber}` :
                 lang === "zh" ? `所选房间：${apartmentNumber}` :
                 lang === "pl" ? `Wybrany pokój: ${apartmentNumber}` :
                 lang === "it" ? `Unità selezionata: ${apartmentNumber}` :
                 `Selected Unit: ${apartmentNumber}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {ambassadoriHighlightB64 && (
        <div style={{ padding: "0 40px 20px" }}>
          <div style={{
            borderRadius: 14,
            overflow: "hidden",
            border: "2.5px solid #005476",
            boxShadow: "0 4px 20px rgba(0,84,118,0.15)",
          }}>
            <div style={{
              background: "#005476",
              padding: "10px 20px",
              display: "flex",
              flexDirection: isRTL ? "row-reverse" : "row",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{ fontSize: 18 }}>🗺️</div>
              <div dir={dir} style={{ fontSize: 21, fontWeight: 700, color: "#fff", fontFamily: ff, direction: dir, unicodeBidi: "embed" as const, whiteSpace: "nowrap" as const }}>
                {lang === "ar" ? `مخطط الطابق — الشقة رقم ${apartmentNumber}` :
                 lang === "he" ? `תוכנית הקומה — דירה ${apartmentNumber}` :
                 lang === "ru" ? `План этажа — квартира ${apartmentNumber}` :
                 lang === "ka" ? `სართულის გეგმა — ბინა ${apartmentNumber}` :
                 lang === "az" ? `Mərtəbə planı — mənzil ${apartmentNumber}` :
                 lang === "tr" ? `Kat Planı — Daire ${apartmentNumber}` :
                 lang === "zh" ? `楼层平面图 — ${apartmentNumber} 号公寓` :
                 lang === "pl" ? `Plan piętra — mieszkanie ${apartmentNumber}` :
                 lang === "it" ? `Planimetria — Appartamento ${apartmentNumber}` :
                 `Floor Plan — Unit ${apartmentNumber}`}
              </div>
            </div>
            <div style={{ background: "#f8f9fa", textAlign: "center" as const, padding: "16px" }}>
              <img
                src={ambassadoriHighlightB64}
                style={{ maxWidth: "100%", height: "auto", display: "inline-block", borderRadius: 8 }}
              />
            </div>
            <div style={{
              background: "#f0f4f8",
              padding: "10px 20px",
              display: "flex",
              flexDirection: isRTL ? "row-reverse" : "row",
              alignItems: "center",
              gap: 12,
              borderTop: "1px solid #dde3ea",
            }}>
              <div style={{ width: 20, height: 20, background: "rgba(59,202,196,0.38)", border: "2px solid #e53e3e", borderRadius: 3, flexShrink: 0 }} />
              <div dir={dir} style={{ fontSize: 15, color: "#475569", fontFamily: ff, direction: dir, unicodeBidi: "embed" as const, whiteSpace: "nowrap" as const }}>
                {lang === "ar" ? `الشقة المحددة: رقم ${apartmentNumber}` :
                 lang === "he" ? `הדירה הנבחרת: מס' ${apartmentNumber}` :
                 lang === "ru" ? `Выбранная квартира: ${apartmentNumber}` :
                 lang === "ka" ? `არჩეული ბინა: ${apartmentNumber}` :
                 lang === "az" ? `Seçilmiş mənzil: ${apartmentNumber}` :
                 lang === "tr" ? `Seçilen Daire: ${apartmentNumber}` :
                 lang === "zh" ? `所选公寓：${apartmentNumber}` :
                 lang === "pl" ? `Wybrane mieszkanie: ${apartmentNumber}` :
                 lang === "it" ? `Unità selezionata: ${apartmentNumber}` :
                 `Selected Unit: ${apartmentNumber}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {crownPlazaHighlightB64 && (
        <div style={{ padding: "0 40px 20px" }}>
          <div style={{
            borderRadius: 14,
            overflow: "hidden",
            border: "2.5px solid #005476",
            boxShadow: "0 4px 20px rgba(0,84,118,0.15)",
          }}>
            <div style={{
              background: "#005476",
              padding: "10px 20px",
              display: "flex",
              flexDirection: isRTL ? "row-reverse" : "row",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{ fontSize: 18 }}>🗺️</div>
              <div dir={dir} style={{ fontSize: 21, fontWeight: 700, color: "#fff", fontFamily: ff, direction: dir, unicodeBidi: "embed" as const, whiteSpace: "nowrap" as const }}>
                {lang === "ar" ? `مخطط الطابق — الشقة رقم ${apartmentNumber}` :
                 lang === "he" ? `תוכנית הקומה — דירה ${apartmentNumber}` :
                 lang === "ru" ? `План этажа — квартира ${apartmentNumber}` :
                 lang === "ka" ? `სართულის გეგმა — ბინა ${apartmentNumber}` :
                 lang === "az" ? `Mərtəbə planı — mənzil ${apartmentNumber}` :
                 lang === "tr" ? `Kat Planı — Daire ${apartmentNumber}` :
                 lang === "zh" ? `楼层平面图 — ${apartmentNumber} 号公寓` :
                 lang === "pl" ? `Plan piętra — mieszkanie ${apartmentNumber}` :
                 lang === "it" ? `Planimetria — Appartamento ${apartmentNumber}` :
                 `Floor Plan — Unit ${apartmentNumber}`}
              </div>
            </div>
            <div style={{ background: "#f8f9fa", textAlign: "center" as const, padding: "16px" }}>
              <img
                src={crownPlazaHighlightB64}
                style={{ maxWidth: "100%", height: "auto", display: "inline-block", borderRadius: 8 }}
              />
            </div>
            <div style={{
              background: "#f0f4f8",
              padding: "10px 20px",
              display: "flex",
              flexDirection: isRTL ? "row-reverse" : "row",
              alignItems: "center",
              gap: 12,
              borderTop: "1px solid #dde3ea",
            }}>
              <div style={{ width: 20, height: 20, background: "rgba(59,202,196,0.38)", border: "2px solid #e53e3e", borderRadius: 3, flexShrink: 0 }} />
              <div dir={dir} style={{ fontSize: 15, color: "#475569", fontFamily: ff, direction: dir, unicodeBidi: "embed" as const, whiteSpace: "nowrap" as const }}>
                {lang === "ar" ? `الشقة المحددة: رقم ${apartmentNumber}` :
                 lang === "he" ? `הדירה הנבחרת: מס' ${apartmentNumber}` :
                 lang === "ru" ? `Выбранная квартира: ${apartmentNumber}` :
                 lang === "ka" ? `არჩეული ბინა: № ${apartmentNumber}` :
                 lang === "az" ? `Seçilmiş mənzil: № ${apartmentNumber}` :
                 lang === "tr" ? `Seçilen Daire: No. ${apartmentNumber}` :
                 lang === "zh" ? `所选公寓：${apartmentNumber}` :
                 lang === "pl" ? `Wybrane mieszkanie: nr ${apartmentNumber}` :
                 lang === "it" ? `Unità selezionata: ${apartmentNumber}` :
                 `Selected Unit: ${apartmentNumber}`}
              </div>
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
