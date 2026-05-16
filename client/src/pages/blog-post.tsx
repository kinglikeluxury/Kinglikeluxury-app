import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Legacy route handler for /blog/:slug
 * Immediately redirects to /{lang}/blog/:slug with replace (no history entry).
 */
export default function BlogPost() {
  const { i18n } = useTranslation();
  const [, params] = useRoute("/blog/:slug");
  const [, navigate] = useLocation();
  const slug = params?.slug;
  const lang = i18n.language || "en";

  useEffect(() => {
    if (slug) {
      navigate(`/${lang}/blog/${slug}`, { replace: true } as any);
    }
  }, [slug, lang]);

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <Skeleton className="h-8 w-48 mb-8" />
        <Skeleton className="h-80 w-full rounded-xl mb-8" />
        <Skeleton className="h-10 w-3/4 mb-4" />
        <Skeleton className="h-4 w-full mb-3" />
        <Skeleton className="h-4 w-full mb-3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
