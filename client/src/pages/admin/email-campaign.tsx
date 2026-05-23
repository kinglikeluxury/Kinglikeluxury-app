import { useState, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, Send, Upload, X, Image, Link2, Users,
  CheckCircle2, AlertCircle, Loader2, Trash2, Plus, FileText
} from "lucide-react";

type Recipient = { email: string; name?: string };
type SendResult = { email: string; status: "sent" | "failed"; error?: string };

export default function EmailCampaignPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [appLink, setAppLink] = useState("https://kinglikeluxury.app");
  const [imageUrl, setImageUrl] = useState("");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [csvText, setCsvText] = useState("");
  const [results, setResults] = useState<SendResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) navigate("/");
  }, [user, authLoading, navigate]);

  const sendMutation = useMutation({
    mutationFn: (data: {
      recipients: Recipient[];
      subject: string;
      bodyText: string;
      imageUrl?: string;
      appLink?: string;
    }) => apiRequest("POST", "/api/admin/email-campaign", data),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setResults(data.results ?? []);
      setShowResults(true);
      const sent = (data.results ?? []).filter((r: SendResult) => r.status === "sent").length;
      const failed = (data.results ?? []).filter((r: SendResult) => r.status === "failed").length;
      toast({
        title: `تم الإرسال ✓`,
        description: `${sent} إيميل تم إرساله بنجاح${failed > 0 ? ` · ${failed} فشل` : ""}`,
      });
    },
    onError: () => {
      toast({ title: "خطأ في الإرسال", description: "تعذر الإرسال، تحقق من الإعدادات", variant: "destructive" });
    },
  });

  const addEmail = () => {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) {
      toast({ title: "إيميل غير صحيح", description: trimmed, variant: "destructive" });
      return;
    }
    if (recipients.some(r => r.email === trimmed)) {
      toast({ title: "مكرر", description: "هذا الإيميل موجود بالفعل" });
      return;
    }
    setRecipients(prev => [...prev, { email: trimmed }]);
    setEmailInput("");
  };

  const removeRecipient = (email: string) => {
    setRecipients(prev => prev.filter(r => r.email !== email));
  };

  const handleCsvParse = () => {
    if (!csvText.trim()) return;
    const lines = csvText.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const valid: Recipient[] = [];
    const invalid: string[] = [];
    for (const line of lines) {
      const email = line.toLowerCase();
      if (emailRegex.test(email)) {
        if (!recipients.some(r => r.email === email) && !valid.some(v => v.email === email)) {
          valid.push({ email });
        }
      } else if (line.length > 0) {
        invalid.push(line);
      }
    }
    setRecipients(prev => [...prev, ...valid]);
    setCsvText("");
    toast({
      title: `تمت الإضافة`,
      description: `${valid.length} إيميل أُضيف${invalid.length > 0 ? ` · ${invalid.length} غير صالح تم تجاهله` : ""}`,
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvText(text);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleSend = () => {
    if (!subject.trim()) {
      toast({ title: "مطلوب", description: "أدخل عنوان الإيميل", variant: "destructive" });
      return;
    }
    if (!bodyText.trim()) {
      toast({ title: "مطلوب", description: "أدخل نص الرسالة", variant: "destructive" });
      return;
    }
    if (recipients.length === 0) {
      toast({ title: "مطلوب", description: "أضف عنواناً واحداً على الأقل", variant: "destructive" });
      return;
    }
    setShowResults(false);
    sendMutation.mutate({
      recipients,
      subject: subject.trim(),
      bodyText: bodyText.trim(),
      imageUrl: imageUrl.trim() || undefined,
      appLink: appLink.trim() || undefined,
    });
  };

  if (authLoading) return null;
  if (!user?.isAdmin) return null;

  const sentCount = results.filter(r => r.status === "sent").length;
  const failedCount = results.filter(r => r.status === "failed").length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Mail className="w-7 h-7" />
            <h1 className="text-2xl font-bold">حملة إيميل</h1>
          </div>
          <p className="text-white/80 text-sm">أرسل رسائل مخصصة لعملائك السابقين</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

        {/* Recipients */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#005476]">
              <Users className="w-5 h-5" />
              قائمة المستلمين
            </CardTitle>
            <CardDescription>أضف الإيميلات يدوياً أو ارفع ملف CSV</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Manual add */}
            <div className="flex gap-2">
              <Input
                placeholder="example@email.com"
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addEmail()}
                className="flex-1 text-left"
                dir="ltr"
              />
              <Button onClick={addEmail} variant="outline" className="border-[#3bcac4] text-[#005476]">
                <Plus className="w-4 h-4" />
              </Button>
            </div>

            {/* CSV paste / upload */}
            <div className="space-y-2">
              <Textarea
                placeholder="أو الصق الإيميلات هنا مفصولة بفاصلة أو سطر جديد..."
                value={csvText}
                onChange={e => setCsvText(e.target.value)}
                rows={3}
                dir="ltr"
                className="text-sm text-left"
              />
              <div className="flex gap-2">
                <Button onClick={handleCsvParse} variant="outline" size="sm" disabled={!csvText.trim()} className="border-[#3bcac4] text-[#005476]">
                  <FileText className="w-4 h-4 mr-1" />
                  استيراد من النص
                </Button>
                <Button onClick={() => fileInputRef.current?.click()} variant="outline" size="sm" className="border-[#3bcac4] text-[#005476]">
                  <Upload className="w-4 h-4 mr-1" />
                  رفع ملف CSV/TXT
                </Button>
                <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
              </div>
            </div>

            {/* Recipient list */}
            {recipients.length > 0 && (
              <div className="border rounded-lg p-3 space-y-1 max-h-48 overflow-y-auto bg-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[#005476]">{recipients.length} مستلم</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRecipients([])}
                    className="text-red-500 hover:text-red-700 h-7 px-2"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    مسح الكل
                  </Button>
                </div>
                {recipients.map(r => (
                  <div key={r.email} className="flex items-center justify-between bg-white rounded px-2 py-1 text-sm">
                    <span dir="ltr" className="text-gray-700">{r.email}</span>
                    <button onClick={() => removeRecipient(r.email)} className="text-gray-400 hover:text-red-500 ml-2">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Message content */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[#005476]">
              <Mail className="w-5 h-5" />
              محتوى الرسالة
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="subject" className="text-sm font-medium">عنوان الإيميل *</Label>
              <Input
                id="subject"
                placeholder="مثال: عرض حصري — شقق فاخرة في باتومي"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="body" className="text-sm font-medium">نص الرسالة *</Label>
              <Textarea
                id="body"
                placeholder="اكتب رسالتك هنا... مثال: يسعدنا أن نقدم لك عرضاً حصرياً على أفضل الوحدات السكنية..."
                value={bodyText}
                onChange={e => setBodyText(e.target.value)}
                rows={6}
                className="mt-1"
              />
              <p className="text-xs text-gray-400 mt-1">{bodyText.length} حرف</p>
            </div>

            <div>
              <Label htmlFor="imageUrl" className="text-sm font-medium flex items-center gap-1">
                <Image className="w-4 h-4" />
                رابط الصورة (اختياري)
              </Label>
              <Input
                id="imageUrl"
                placeholder="https://... رابط صورة العرض أو المشروع"
                value={imageUrl}
                onChange={e => setImageUrl(e.target.value)}
                className="mt-1 text-left"
                dir="ltr"
              />
              <p className="text-xs text-gray-400 mt-1">ستظهر الصورة داخل الإيميل فوق النص</p>
            </div>

            <div>
              <Label htmlFor="appLink" className="text-sm font-medium flex items-center gap-1">
                <Link2 className="w-4 h-4" />
                رابط التطبيق
              </Label>
              <Input
                id="appLink"
                value={appLink}
                onChange={e => setAppLink(e.target.value)}
                className="mt-1 text-left"
                dir="ltr"
              />
              <p className="text-xs text-gray-400 mt-1">سيُضاف تلقائياً في نهاية كل إيميل كزر</p>
            </div>
          </CardContent>
        </Card>

        {/* Preview */}
        {(subject || bodyText) && (
          <Card className="border-[#3bcac4]/30">
            <CardHeader>
              <CardTitle className="text-sm text-[#005476]">معاينة الإيميل</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden text-sm">
                <div className="bg-gradient-to-r from-[#3bcac4] to-[#005476] px-6 py-4 text-center text-white">
                  <div className="font-bold text-lg">Kinglike Luxury</div>
                  <div className="text-white/80 text-xs">منصة العقارات الفاخرة</div>
                </div>
                {imageUrl && (
                  <div className="px-6 pt-4">
                    <img src={imageUrl} alt="offer" className="w-full rounded-lg object-cover max-h-48" />
                  </div>
                )}
                <div className="px-6 py-4 space-y-3">
                  {subject && <div className="font-bold text-[#005476]">{subject}</div>}
                  {bodyText && <div className="text-gray-600 whitespace-pre-wrap leading-relaxed">{bodyText}</div>}
                  {appLink && (
                    <div className="pt-2">
                      <span className="inline-block bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white px-5 py-2 rounded-lg text-xs font-bold">
                        استكشف العقارات →
                      </span>
                    </div>
                  )}
                </div>
                <div className="bg-gray-50 px-6 py-3 text-center text-gray-400 text-xs">
                  © Kinglike Luxury Real Estate
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Send button */}
        <div className="flex items-center justify-between bg-white rounded-xl border p-4">
          <div className="text-sm text-gray-500">
            {recipients.length > 0 ? (
              <span className="text-[#005476] font-medium">{recipients.length} مستلم جاهز للإرسال</span>
            ) : (
              <span>لم تُضف أي إيميلات بعد</span>
            )}
          </div>
          <Button
            onClick={handleSend}
            disabled={sendMutation.isPending || recipients.length === 0}
            className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white px-8 font-bold"
          >
            {sendMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                جاري الإرسال...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                إرسال الحملة
              </>
            )}
          </Button>
        </div>

        {/* Results */}
        {showResults && results.length > 0 && (
          <Card className={sentCount === results.length ? "border-green-300 bg-green-50" : "border-amber-300 bg-amber-50"}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                {sentCount === results.length ? (
                  <><CheckCircle2 className="w-5 h-5 text-green-600" /><span className="text-green-700">اكتمل الإرسال</span></>
                ) : (
                  <><AlertCircle className="w-5 h-5 text-amber-600" /><span className="text-amber-700">اكتمل مع بعض الأخطاء</span></>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-4 mb-4">
                <Badge className="bg-green-100 text-green-700 border-green-300">✓ {sentCount} تم الإرسال</Badge>
                {failedCount > 0 && <Badge className="bg-red-100 text-red-700 border-red-300">✗ {failedCount} فشل</Badge>}
              </div>
              {failedCount > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {results.filter(r => r.status === "failed").map(r => (
                    <div key={r.email} className="text-xs text-red-600 bg-white rounded px-2 py-1" dir="ltr">
                      {r.email}: {r.error ?? "فشل"}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
