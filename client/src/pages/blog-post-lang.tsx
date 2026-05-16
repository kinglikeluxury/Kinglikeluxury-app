import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { CalendarDays, User, ArrowLeft, MapPin, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useEffect } from "react";

const SUPPORTED_LANGS = ["en", "ar", "tr", "ru", "ka", "az", "he", "zh", "pl"];
const BASE_URL = "https://www.kinglikeluxury.app";

export default function BlogPostLang() {
  const { i18n, t } = useTranslation();
  const [, params] = useRoute("/:lang/blog/:slug");
  const [, navigate] = useLocation();
  const urlLang = params?.lang ?? "en";
  const slug = params?.slug;

  // Switch app language to match URL language
  useEffect(() => {
    if (urlLang && SUPPORTED_LANGS.includes(urlLang) && i18n.language !== urlLang) {
      i18n.changeLanguage(urlLang);
    }
  }, [urlLang]);

  const { data: post, isLoading, error } = useQuery<any>({
    queryKey: ["/api/blog/slug", slug, urlLang],
    queryFn: async () => {
      const res = await fetch(`/api/blog/slug/${encodeURIComponent(slug!)}?lang=${urlLang}`, { credentials: "include" });
      if (res.status === 301) {
        const data = await res.json();
        if (data.redirect) {
          navigate(`/${urlLang}/blog/${data.redirect}`, { replace: true } as any);
          return null;
        }
      }
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
            {t("blog.notFound", "Article not found")}
          </h1>
          <Button
            onClick={() => navigate(`/${urlLang}/blog`)}
            className="bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("blog.backToBlog", "Back to Blog")}
          </Button>
        </div>
      </div>
    );
  }

  const canonicalUrl = `${BASE_URL}/${urlLang}/blog/${slug}`;
  const title = post.title || "";
  const description = post.excerpt || title;
  const image = post.coverImage || `${BASE_URL}/icons/icon-512.png`;
  const formattedDate = post.createdAt
    ? new Intl.DateTimeFormat(urlLang, { year: "numeric", month: "long", day: "numeric" }).format(new Date(post.createdAt))
    : "";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: title,
    description: description,
    image: image,
    url: canonicalUrl,
    datePublished: post.createdAt,
    dateModified: post.updatedAt || post.createdAt,
    author: {
      "@type": "Organization",
      name: "Kinglike Luxury",
      url: BASE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: "Kinglike Luxury",
      logo: { "@type": "ImageObject", url: `${BASE_URL}/icons/icon-512.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
  };

  return (
    <>
      <Helmet>
        <html lang={urlLang} />
        <title>{title} | Kinglike Luxury</title>
        <meta name="description" content={description} />
        <link rel="canonical" href={canonicalUrl} />

        {/* hreflang for all languages */}
        {SUPPORTED_LANGS.map((l) => (
          <link key={l} rel="alternate" hrefLang={l} href={`${BASE_URL}/${l}/blog/${slug}`} />
        ))}
        <link rel="alternate" hrefLang="x-default" href={`${BASE_URL}/en/blog/${slug}`} />

        {/* Open Graph */}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={`${title} | Kinglike Luxury`} />
        <meta property="og:description" content={description} />
        <meta property="og:image" content={image} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:site_name" content="Kinglike Luxury" />
        <meta property="og:locale" content={urlLang} />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${title} | Kinglike Luxury`} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={image} />

        {/* JSON-LD */}
        <script type="application/ld+json">{JSON.stringify(jsonLd)}</script>
      </Helmet>

      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <button
            onClick={() => navigate("/blog")}
            className="inline-flex items-center text-[#005476] hover:text-[#3bcac4] font-medium mb-8 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("blog.backToBlog", "Back to Blog")}
          </button>

          {post.coverVideo ? (
            <div className="relative rounded-xl overflow-hidden mb-8 shadow-lg">
              <video src={post.coverVideo} className="w-full max-h-[500px] object-cover" controls autoPlay muted />
            </div>
          ) : post.coverImage ? (
            <div className="relative rounded-xl overflow-hidden mb-8 shadow-lg">
              <img src={post.coverImage} alt={title} className="w-full max-h-[500px] object-cover" />
            </div>
          ) : null}

          <div className="bg-white rounded-xl shadow-sm p-8 md:p-12">
            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mb-6">
              {post.country && (
                <span className="inline-flex items-center gap-1 bg-[#005476]/10 text-[#005476] px-3 py-1 rounded-full font-medium">
                  <MapPin className="w-3.5 h-3.5" />
                  {post.country === "uae" ? "🇦🇪 UAE" : post.country === "turkey" ? "🇹🇷 Turkey" : post.country === "northern-cyprus" ? "🇨🇾 N. Cyprus" : "🇬🇪 Georgia"}
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

            <h1 className="text-3xl md:text-4xl font-bold text-[#005476] mb-8 leading-tight">{title}</h1>

            <div
              className="prose prose-lg max-w-none text-gray-700 leading-relaxed
                prose-headings:text-[#005476] prose-headings:font-bold
                prose-a:text-[#3bcac4] prose-a:no-underline hover:prose-a:underline
                prose-img:rounded-lg prose-img:shadow-md"
              dangerouslySetInnerHTML={{ __html: post.content }}
            />

            {/* Language switcher */}
            <div className="mt-8 pt-6 border-t border-gray-100">
              <p className="text-xs text-gray-400 mb-3 text-center">Available in other languages:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {[
                  { code: "en", label: "English" },
                  { code: "ar", label: "العربية" },
                  { code: "tr", label: "Türkçe" },
                  { code: "ru", label: "Русский" },
                  { code: "ka", label: "ქართული" },
                  { code: "az", label: "Azərbaycan" },
                  { code: "he", label: "עברית" },
                  { code: "zh", label: "中文" },
                  { code: "pl", label: "Polski" },
                ].map((l) => (
                  <a
                    key={l.code}
                    href={`/${l.code}/blog/${slug}`}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition border ${
                      l.code === urlLang
                        ? "bg-[#005476] text-white border-[#005476]"
                        : "bg-white text-gray-600 border-gray-200 hover:border-[#3bcac4]"
                    }`}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-gray-100">
              <p className="text-gray-500 text-sm mb-4 text-center">
                {t("blog.interestedQuestion", "Interested? Contact us on WhatsApp")}
              </p>
              <a
                href={`https://wa.me/995591000058?text=${encodeURIComponent(t("blog.whatsappMessage", 'Hello, I read "') + title + '"')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 w-full py-4 px-6 rounded-xl font-semibold text-white text-lg transition-all hover:opacity-90 hover:shadow-lg"
                style={{ background: "linear-gradient(135deg,#25D366 0%,#128C7E 100%)" }}
              >
                <MessageCircle className="w-6 h-6" />
                {t("blog.contactWhatsApp", "Contact us on WhatsApp")}
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
