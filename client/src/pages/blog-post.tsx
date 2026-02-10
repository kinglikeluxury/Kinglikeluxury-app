import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { useTranslation } from "react-i18next";
import { CalendarDays, User, ArrowLeft, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function BlogPost() {
  const { i18n, t } = useTranslation();
  const [, params] = useRoute("/blog/:slug");
  const slug = params?.slug;
  const lang = i18n.language;

  const { data: post, isLoading, error } = useQuery<any>({
    queryKey: ["/api/blog/slug", slug, lang],
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (lang) queryParams.set("lang", lang);
      const res = await fetch(`/api/blog/slug/${slug}?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Blog post not found");
      return res.json();
    },
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-4xl mx-auto px-4">
          <Skeleton className="h-8 w-48 mb-8" />
          <Skeleton className="h-80 w-full rounded-xl mb-8" />
          <Skeleton className="h-10 w-3/4 mb-4" />
          <Skeleton className="h-5 w-48 mb-8" />
          <Skeleton className="h-4 w-full mb-3" />
          <Skeleton className="h-4 w-full mb-3" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            {t('blog.notFound', 'Article not found')}
          </h1>
          <p className="text-gray-600 mb-8">
            {t('blog.notFoundDesc', 'The article you are looking for does not exist or has been removed.')}
          </p>
          <Button
            onClick={() => window.location.href = '/blog'}
            className="bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('blog.backToBlog', 'Back to Blog')}
          </Button>
        </div>
      </div>
    );
  }

  const formattedDate = post.createdAt
    ? new Intl.DateTimeFormat(lang || 'en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(post.createdAt))
    : "";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <button
          onClick={() => window.location.href = '/blog'}
          className="inline-flex items-center text-[#005476] hover:text-[#3bcac4] font-medium mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t('blog.backToBlog', 'Back to Blog')}
        </button>

        {post.coverVideo ? (
          <div className="relative rounded-xl overflow-hidden mb-8 shadow-lg">
            <video
              src={post.coverVideo}
              className="w-full max-h-[500px] object-cover"
              controls
              autoPlay
              muted
            />
          </div>
        ) : post.coverImage ? (
          <div className="relative rounded-xl overflow-hidden mb-8 shadow-lg">
            <img
              src={post.coverImage}
              alt={post.title}
              className="w-full max-h-[500px] object-cover"
            />
          </div>
        ) : null}

        <div className="bg-white rounded-xl shadow-sm p-8 md:p-12">
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mb-6">
            {post.country && (
              <span className="inline-flex items-center gap-1 bg-[#005476]/10 text-[#005476] px-3 py-1 rounded-full font-medium">
                <MapPin className="w-3.5 h-3.5" />
                {post.country === 'uae' ? '🇦🇪 UAE' : '🇬🇪 Georgia'}
              </span>
            )}
            <div className="flex items-center gap-1.5">
              <CalendarDays className="w-4 h-4" />
              {formattedDate}
            </div>
            <div className="flex items-center gap-1.5">
              <User className="w-4 h-4" />
              {post.author?.username || "Admin"}
            </div>
          </div>

          <h1 className="text-3xl md:text-4xl font-bold text-[#005476] mb-8 leading-tight">
            {post.title}
          </h1>

          <div
            className="prose prose-lg max-w-none text-gray-700 leading-relaxed
              prose-headings:text-[#005476] prose-headings:font-bold
              prose-a:text-[#3bcac4] prose-a:no-underline hover:prose-a:underline
              prose-img:rounded-lg prose-img:shadow-md"
            dangerouslySetInnerHTML={{ __html: post.content }}
          />
        </div>
      </div>
    </div>
  );
}