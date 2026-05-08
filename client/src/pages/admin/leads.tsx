import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, Phone, Mail, Download, Search, Building2,
  Eye, UserCheck, ShoppingBag, ArrowLeft, Filter
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

const METHOD_LABELS: Record<string, string> = {
  phone: "📱 هاتف",
  email: "📧 إيميل",
  whatsapp: "💬 واتساب",
  facebook: "👤 فيسبوك",
};

export default function LeadsPage() {
  const { user, isLoading: authLoading } = useAuth();
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
          <Button
            onClick={handleExport}
            className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white gap-2 self-start md:self-auto"
          >
            <Download className="h-4 w-4" />
            تصدير Excel
          </Button>
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
