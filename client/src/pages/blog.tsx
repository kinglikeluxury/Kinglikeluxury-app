import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, User, MapPin } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function Blog() {
  const { i18n, t } = useTranslation();
  const [countryFilter, setCountryFilter] = useState("all");
  const lang = i18n.language;

  const { data: blogPosts = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/blog", lang, countryFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (lang) params.set("lang", lang);
      if (countryFilter !== "all") params.set("country", countryFilter);
      const res = await fetch(`/api/blog?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch blog posts");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-[#005476] mb-4">{t('blog.title', 'Blog')}</h1>
            <p className="text-xl text-gray-600 mb-12">{t('blog.loading', 'Loading blog posts...')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-[#005476] mb-4">{t('blog.title', 'Blog')}</h1>
          <p className="text-xl text-gray-600">
            {t('blog.subtitle', 'Latest insights and updates from our real estate experts')}
          </p>
        </div>

        <div className="flex justify-center gap-3 mb-8">
          <button
            onClick={() => setCountryFilter("all")}
            className={`px-5 py-2.5 rounded-full text-sm font-medium transition ${
              countryFilter === "all"
                ? "bg-[#005476] text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:border-[#3bcac4]"
            }`}
          >
            {t('blog.allCountries', 'All')}
          </button>
          <button
            onClick={() => setCountryFilter("georgia")}
            className={`px-5 py-2.5 rounded-full text-sm font-medium transition flex items-center gap-2 ${
              countryFilter === "georgia"
                ? "bg-[#005476] text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:border-[#3bcac4]"
            }`}
          >
            <span>🇬🇪</span> {t('countries.georgia', 'Georgia')}
          </button>
          <button
            onClick={() => setCountryFilter("uae")}
            className={`px-5 py-2.5 rounded-full text-sm font-medium transition flex items-center gap-2 ${
              countryFilter === "uae"
                ? "bg-[#005476] text-white"
                : "bg-white text-gray-600 border border-gray-200 hover:border-[#3bcac4]"
            }`}
          >
            <span>🇦🇪</span> {t('countries.uae', 'Dubai / UAE')}
          </button>
        </div>

        {blogPosts.length === 0 ? (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <h3 className="text-2xl font-semibold text-gray-900 mb-4">
                {t('blog.noPosts', 'No blog posts yet')}
              </h3>
              <p className="text-gray-600">
                {t('blog.noPostsDescription', "We're working on some great content. Check back soon for the latest insights about real estate and market trends.")}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {blogPosts.map((post: any) => (
              <Card key={post.id} className="h-full hover:shadow-lg transition-shadow overflow-hidden">
                {post.coverImage && (
                  <div className="relative h-48 overflow-hidden">
                    <img
                      src={post.coverImage}
                      alt={post.title}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-3 left-3">
                      <span className="text-xs bg-white/90 backdrop-blur-sm text-[#005476] px-2.5 py-1 rounded-full font-medium flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {post.country === 'uae' ? '🇦🇪 UAE' : '🇬🇪 Georgia'}
                      </span>
                    </div>
                  </div>
                )}
                <CardHeader>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {Array.isArray(post.categories) && post.categories.map((cat: string, i: number) => (
                      <Badge key={i} variant="secondary" className="text-xs bg-[#3bcac4]/10 text-[#005476]">
                        {cat}
                      </Badge>
                    ))}
                  </div>
                  <CardTitle className="text-xl font-bold leading-tight text-[#005476]">
                    {post.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <p className="text-gray-600 text-sm leading-relaxed">
                      {post.excerpt || post.content?.substring(0, 150) + "..."}
                    </p>
                    
                    <div className="flex items-center justify-between text-sm text-gray-500">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4" />
                        <span>{post.author?.username || post.author?.email || "Admin"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4" />
                        <span>
                          {post.createdAt ? new Intl.DateTimeFormat(lang || 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(post.createdAt)) : "Recently"}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
