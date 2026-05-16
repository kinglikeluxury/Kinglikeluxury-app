import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { queryClient } from "@/lib/queryClient";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Mail, MessageSquare, Send, Settings, Clock, CheckCircle2,
  XCircle, AlertCircle, Eye, Edit3, ChevronDown, ChevronUp,
  Users, BarChart3
} from "lucide-react";

type Template = {
  id: number;
  type: string;
  trigger: string;
  subject: string | null;
  bodyHtml: string | null;
  bodyText: string | null;
  isActive: boolean;
  updatedAt: string;
};

type NotificationLog = {
  id: number;
  userId: number | null;
  type: string;
  trigger: string;
  recipient: string | null;
  status: string;
  error: string | null;
  sentAt: string;
};

type Status = {
  emailConfigured: boolean;
  whatsappConfigured: boolean;
  gmailUser: string | null;
};

const TRIGGER_LABELS: Record<string, string> = {
  welcome: "رسالة الترحيب",
  weekly_update: "التحديث الأسبوعي",
  inactive_reminder: "تذكير الغائبين",
};

const TRIGGER_DESCRIPTIONS: Record<string, string> = {
  welcome: "تُرسل فور تسجيل مستخدم جديد",
  weekly_update: "تُرسل كل اثنين الساعة 9 صباحاً",
  inactive_reminder: "تُرسل يومياً للمستخدمين غير النشطين 30+ يوم",
};

function TemplateEditor({ template, onSave }: { template: Template; onSave: (t: Template) => void }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(template.subject ?? "");
  const [bodyHtml, setBodyHtml] = useState(template.bodyHtml ?? "");
  const [bodyText, setBodyText] = useState(template.bodyText ?? "");
  const [isActive, setIsActive] = useState(template.isActive);
  const [preview, setPreview] = useState(false);
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (data: Partial<Template>) =>
      apiRequest("PUT", `/api/admin/notification-templates/${template.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notification-templates"] });
      toast({ title: "تم الحفظ", description: "تم تحديث القالب بنجاح" });
      setEditing(false);
    },
    onError: () => toast({ title: "خطأ", description: "فشل الحفظ", variant: "destructive" }),
  });

  const handleSave = () => {
    mutation.mutate({ subject, bodyHtml, bodyText, isActive });
    onSave({ ...template, subject, bodyHtml, bodyText, isActive });
  };

  const isEmail = template.type === "email";
  const icon = isEmail
    ? <Mail className="h-4 w-4 text-[#3bcac4]" />
    : <MessageSquare className="h-4 w-4 text-[#005476]" />;

  return (
    <div className="border rounded-xl overflow-hidden bg-white shadow-sm">
      <div className="flex items-center justify-between p-4 bg-gray-50 border-b">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <p className="font-semibold text-sm text-gray-800">
              {isEmail ? "إيميل" : "واتساب"} — {TRIGGER_LABELS[template.trigger]}
            </p>
            <p className="text-xs text-gray-500">{TRIGGER_DESCRIPTIONS[template.trigger]}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={isActive}
              onCheckedChange={(v) => {
                setIsActive(v);
                mutation.mutate({ subject, bodyHtml, bodyText, isActive: v });
              }}
            />
            <span className="text-xs text-gray-600">{isActive ? "مفعّل" : "معطّل"}</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? <ChevronUp className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {editing && (
        <div className="p-4 space-y-4">
          {isEmail && (
            <div>
              <Label className="text-xs font-semibold">موضوع الإيميل (Subject)</Label>
              <Input value={subject} onChange={e => setSubject(e.target.value)} className="mt-1" placeholder="موضوع الإيميل..." />
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs font-semibold">
                {isEmail ? "النص العادي (Text)" : "نص الواتساب"}
              </Label>
              <span className="text-xs text-gray-400">متغيرات: {"{{username}}"}</span>
            </div>
            <Textarea
              value={bodyText}
              onChange={e => setBodyText(e.target.value)}
              rows={isEmail ? 3 : 6}
              placeholder="نص الرسالة..."
            />
          </div>

          {isEmail && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs font-semibold">كود HTML للإيميل</Label>
                <Button size="sm" variant="ghost" className="text-xs h-6" onClick={() => setPreview(!preview)}>
                  <Eye className="h-3 w-3 mr-1" /> {preview ? "إخفاء المعاينة" : "معاينة"}
                </Button>
              </div>
              {preview ? (
                <div
                  className="border rounded-lg p-4 max-h-80 overflow-y-auto bg-gray-50 text-sm"
                  dangerouslySetInnerHTML={{ __html: bodyHtml.replace(/\{\{username\}\}/g, "محمد") }}
                />
              ) : (
                <Textarea
                  value={bodyHtml}
                  onChange={e => setBodyHtml(e.target.value)}
                  rows={8}
                  className="font-mono text-xs"
                  placeholder="<html>...</html>"
                />
              )}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button
              className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white"
              onClick={handleSave}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "جاري الحفظ..." : "حفظ التغييرات"}
            </Button>
            <Button variant="outline" onClick={() => setEditing(false)}>إلغاء</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [sendLoading, setSendLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) navigate("/");
  }, [user, authLoading, navigate]);

  const { data: templates = [], isLoading: tplLoading } = useQuery<Template[]>({
    queryKey: ["/api/admin/notification-templates"],
    enabled: !!user?.isAdmin,
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<NotificationLog[]>({
    queryKey: ["/api/admin/notification-logs"],
    enabled: !!user?.isAdmin,
  });

  const { data: status } = useQuery<Status>({
    queryKey: ["/api/admin/notification-status"],
    enabled: !!user?.isAdmin,
  });

  const handleSend = async (trigger: string, channel: string) => {
    const key = `${trigger}-${channel}`;
    setSendLoading(key);
    try {
      const res = await apiRequest("POST", "/api/admin/notifications/send", { trigger, channel });
      const data = await res.json();
      toast({
        title: "تم الإرسال",
        description: `إيميل: ${data.result?.email?.sent ?? 0} | واتساب: ${data.result?.whatsapp?.sent ?? 0}`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/notification-logs"] });
    } catch {
      toast({ title: "خطأ", description: "فشل الإرسال", variant: "destructive" });
    } finally {
      setSendLoading(null);
    }
  };

  const emailTemplates = templates.filter(t => t.type === "email");
  const waTemplates = templates.filter(t => t.type === "whatsapp");

  const sentCount = logs.filter(l => l.status === "sent").length;
  const failedCount = logs.filter(l => l.status === "failed").length;

  if (authLoading || !user?.isAdmin) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center">
              <Send className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-[#005476]">نظام الإشعارات التلقائية</h1>
              <p className="text-sm text-gray-500">إدارة قوالب الإيميل والواتساب وإرسال الرسائل</p>
            </div>
          </div>
        </div>

        {/* Status Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              {status?.emailConfigured
                ? <CheckCircle2 className="h-8 w-8 text-[#3bcac4]" />
                : <XCircle className="h-8 w-8 text-red-400" />}
              <div>
                <p className="text-xs text-gray-500">إيميل</p>
                <p className="font-semibold text-sm">
                  {status?.emailConfigured ? "متصل" : "غير مفعّل"}
                </p>
                {status?.gmailUser && <p className="text-xs text-gray-400 truncate max-w-24">{status.gmailUser}</p>}
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              {status?.whatsappConfigured
                ? <CheckCircle2 className="h-8 w-8 text-[#3bcac4]" />
                : <XCircle className="h-8 w-8 text-red-400" />}
              <div>
                <p className="text-xs text-gray-500">واتساب</p>
                <p className="font-semibold text-sm">
                  {status?.whatsappConfigured ? "متصل" : "غير مفعّل"}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-xs text-gray-500">مُرسَل</p>
                <p className="font-bold text-xl text-green-600">{sentCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <XCircle className="h-8 w-8 text-red-400" />
              <div>
                <p className="text-xs text-gray-500">فشل</p>
                <p className="font-bold text-xl text-red-500">{failedCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Gmail setup alert */}
        {!status?.emailConfigured && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex gap-3">
            <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-800">إيميل Gmail غير مُفعَّل</p>
              <p className="text-amber-700 mt-1">
                لتفعيل إرسال الإيميلات، أضف هذين المتغيرين في إعدادات Secrets:
              </p>
              <ul className="mt-2 space-y-1 font-mono text-xs text-amber-800">
                <li>• <strong>GMAIL_USER</strong> = your@gmail.com</li>
                <li>• <strong>GMAIL_APP_PASSWORD</strong> = كلمة مرور التطبيق (App Password)</li>
              </ul>
            </div>
          </div>
        )}

        <Tabs defaultValue="templates">
          <TabsList className="mb-6">
            <TabsTrigger value="templates"><Edit3 className="h-4 w-4 mr-2" />القوالب</TabsTrigger>
            <TabsTrigger value="send"><Send className="h-4 w-4 mr-2" />الإرسال اليدوي</TabsTrigger>
            <TabsTrigger value="logs"><BarChart3 className="h-4 w-4 mr-2" />سجل الإرسال</TabsTrigger>
            <TabsTrigger value="schedule"><Clock className="h-4 w-4 mr-2" />الجدولة</TabsTrigger>
          </TabsList>

          {/* Templates Tab */}
          <TabsContent value="templates">
            <div className="space-y-6">
              <div>
                <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <Mail className="h-4 w-4 text-[#3bcac4]" /> قوالب الإيميل
                </h2>
                <div className="space-y-3">
                  {tplLoading
                    ? Array(3).fill(0).map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)
                    : emailTemplates.map(t => (
                      <TemplateEditor key={t.id} template={t} onSave={() => {}} />
                    ))}
                </div>
              </div>

              <div>
                <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-[#005476]" /> قوالب الواتساب
                </h2>
                <div className="space-y-3">
                  {tplLoading
                    ? Array(3).fill(0).map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)
                    : waTemplates.map(t => (
                      <TemplateEditor key={t.id} template={t} onSave={() => {}} />
                    ))}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Manual Send Tab */}
          <TabsContent value="send">
            <div className="grid gap-4">
              {(["welcome", "weekly_update", "inactive_reminder"] as const).map(trigger => (
                <Card key={trigger} className="border-0 shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div>
                        <p className="font-semibold text-[#005476]">{TRIGGER_LABELS[trigger]}</p>
                        <p className="text-sm text-gray-500 mt-0.5">{TRIGGER_DESCRIPTIONS[trigger]}</p>
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-[#3bcac4] text-[#3bcac4] hover:bg-[#3bcac4]/10"
                          disabled={!!sendLoading}
                          onClick={() => handleSend(trigger, "email")}
                        >
                          {sendLoading === `${trigger}-email` ? "جاري..." : <><Mail className="h-3.5 w-3.5 mr-1.5" />إيميل فقط</>}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-[#005476] text-[#005476] hover:bg-[#005476]/10"
                          disabled={!!sendLoading}
                          onClick={() => handleSend(trigger, "whatsapp")}
                        >
                          {sendLoading === `${trigger}-whatsapp` ? "جاري..." : <><MessageSquare className="h-3.5 w-3.5 mr-1.5" />واتساب فقط</>}
                        </Button>
                        <Button
                          size="sm"
                          className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white"
                          disabled={!!sendLoading}
                          onClick={() => handleSend(trigger, "all")}
                        >
                          {sendLoading === `${trigger}-all` ? "جاري الإرسال..." : <><Send className="h-3.5 w-3.5 mr-1.5" />إرسال للكل</>}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Logs Tab */}
          <TabsContent value="logs">
            <Card className="border-0 shadow-sm">
              <CardContent className="p-0">
                {logsLoading ? (
                  <div className="p-8 text-center text-gray-400">جاري التحميل...</div>
                ) : logs.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">لا توجد سجلات بعد</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-gray-50">
                          <th className="text-right p-3 font-semibold text-gray-600">النوع</th>
                          <th className="text-right p-3 font-semibold text-gray-600">الرسالة</th>
                          <th className="text-right p-3 font-semibold text-gray-600">المستلم</th>
                          <th className="text-right p-3 font-semibold text-gray-600">الحالة</th>
                          <th className="text-right p-3 font-semibold text-gray-600">التاريخ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logs.map(log => (
                          <tr key={log.id} className="border-b hover:bg-gray-50">
                            <td className="p-3">
                              <Badge variant="outline" className="text-xs">
                                {log.type === "email" ? <Mail className="h-3 w-3 mr-1" /> : <MessageSquare className="h-3 w-3 mr-1" />}
                                {log.type === "email" ? "إيميل" : "واتساب"}
                              </Badge>
                            </td>
                            <td className="p-3 text-gray-700">{TRIGGER_LABELS[log.trigger] || log.trigger}</td>
                            <td className="p-3 text-gray-500 font-mono text-xs max-w-32 truncate">{log.recipient || "—"}</td>
                            <td className="p-3">
                              {log.status === "sent"
                                ? <span className="text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" />تم</span>
                                : <span className="text-red-500 flex items-center gap-1" title={log.error || ""}><XCircle className="h-3.5 w-3.5" />فشل</span>
                              }
                            </td>
                            <td className="p-3 text-gray-400 text-xs">
                              {new Date(log.sentAt).toLocaleString("ar")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Schedule Tab */}
          <TabsContent value="schedule">
            <div className="grid gap-4">
              {[
                { label: "التحديث الأسبوعي", icon: <Clock className="h-5 w-5" />, time: "كل اثنين الساعة 9:00 صباحاً", desc: "يُرسل لجميع المستخدمين المسجلين" },
                { label: "تذكير الغائبين", icon: <Users className="h-5 w-5" />, time: "كل يوم الساعة 10:00 صباحاً", desc: "للمستخدمين غير النشطين +30 يوم" },
                { label: "رسالة الترحيب", icon: <Send className="h-5 w-5" />, time: "فور التسجيل (تلقائي)", desc: "لكل مستخدم جديد عند إنشاء حسابه" },
              ].map((item, i) => (
                <Card key={i} className="border-0 shadow-sm">
                  <CardContent className="p-5 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3bcac4]/20 to-[#005476]/20 flex items-center justify-center text-[#005476]">
                      {item.icon}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-[#005476]">{item.label}</p>
                      <p className="text-sm text-gray-500">{item.desc}</p>
                    </div>
                    <div className="text-right">
                      <Badge className="bg-[#3bcac4]/10 text-[#005476] border-0 text-xs">{item.time}</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
