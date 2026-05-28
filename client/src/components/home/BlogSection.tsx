import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, Calendar, User, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAutoTranslate } from '@/hooks/useAutoTranslate';

const ARABIC_RE = /[\u0600-\u06FF]/;

const SAMPLE_IMAGES = [
  'https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1582407947304-fd86f028f716?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80'
];

function BlogPostItem({ post }: { post: any }) {
  const { i18n, t } = useTranslation();
  const currentLang = i18n.language?.split('-')[0] || 'en';

  const contentIsArabic = ARABIC_RE.test(post.title || '');
  const shouldTranslate = currentLang !== 'ar' && contentIsArabic;

  const rawExcerpt = post.excerpt || '';

  const translated = useAutoTranslate({
    title: shouldTranslate ? post.title || '' : '',
    excerpt: shouldTranslate ? rawExcerpt : '',
  });

  const displayTitle = shouldTranslate && translated.title ? translated.title : post.title;
  const displayExcerpt = shouldTranslate && translated.excerpt ? translated.excerpt : rawExcerpt;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  };

  return (
    <a
      href={`/${currentLang}/blog/${post.slug}`}
      className="bg-white rounded-lg overflow-hidden shadow-lg transition-all duration-300 hover:shadow-xl group block cursor-pointer"
    >
      <div className="relative h-64 overflow-hidden">
        <img
          src={post.coverImage || SAMPLE_IMAGES[0]}
          alt={displayTitle}
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
        <div className="absolute bottom-4 left-4 right-4">
          {post.categories && post.categories.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {post.categories.map((category: string, idx: number) => (
                <span
                  key={idx}
                  className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#3bcac4]/80 text-white"
                >
                  <Tag className="w-3 h-3 mr-1" />
                  {category}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="p-6">
        <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
          <div className="flex items-center">
            <Calendar className="w-3 h-3 mr-1" />
            {post.createdAt ? formatDate(post.createdAt.toString()) : ''}
          </div>
          <div className="flex items-center">
            <User className="w-3 h-3 mr-1" />
            {post.author?.username || post.author?.email || 'Admin'}
          </div>
        </div>

        <h3 className="text-xl font-bold mb-3 text-gray-900 line-clamp-2 group-hover:text-[#005476] transition-colors">
          {displayTitle}
        </h3>

        <p className="text-gray-600 mb-4 line-clamp-3">
          {displayExcerpt}
        </p>

        <div className="inline-flex items-center text-[#3bcac4] hover:text-[#005476] font-medium">
          {t('home.insights.readArticle', 'Read Article')}
          <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    </a>
  );
}

export const BlogSection = () => {
  const { t, i18n } = useTranslation();
  const [blogPosts, setBlogPosts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const lang = i18n.language;

  useEffect(() => {
    const fetchBlogPosts = async () => {
      try {
        setIsLoading(true);
        const params = new URLSearchParams();
        if (lang) params.set('lang', lang);
        const response = await fetch(`/api/blog?${params.toString()}`);
        if (!response.ok) {
          setBlogPosts([]);
          return;
        }
        const data = await response.json();
        setBlogPosts(data.slice(0, 3));
      } catch (error) {
        console.error('Error fetching blog posts:', error);
        setBlogPosts([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBlogPosts();
  }, [lang]);

  return (
    <section className="py-16 bg-gradient-to-b from-white to-gray-50">
      <div className="container mx-auto px-4">
        <div className="flex flex-col items-center text-center mb-12">
          <h2 className="text-4xl font-bold mb-3 bg-gradient-to-r from-[#005476] to-[#3bcac4] bg-clip-text text-transparent">
            {t('home.insights.title', 'Real Estate Insights')}
          </h2>
          <div className="w-24 h-1 bg-gradient-to-r from-[#005476] to-[#3bcac4] rounded-full mb-4"></div>
          <p className="text-gray-600 max-w-2xl text-center">
            {t('home.insights.subtitle', 'Expert advice, market trends, and design inspirations from our real estate specialists to help you make informed decisions')}
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {isLoading ? (
            Array(3).fill(0).map((_, index) => (
              <div key={index} className="rounded-lg overflow-hidden shadow-lg bg-white">
                <Skeleton className="h-64 w-full" />
                <div className="p-6">
                  <Skeleton className="h-4 w-32 mb-2" />
                  <Skeleton className="h-8 w-full mb-3" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-2/3 mb-4" />
                  <Skeleton className="h-10 w-28" />
                </div>
              </div>
            ))
          ) : blogPosts.length > 0 ? (
            blogPosts.map((post) => (
              <BlogPostItem key={post.id} post={post} />
            ))
          ) : null}
        </div>

        <div className="flex justify-center mt-12">
          <Button
            className="bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white hover:from-[#004966] hover:to-[#2ab9b4] px-8 py-6 text-lg font-medium"
            onClick={() => window.location.href = '/blog'}
          >
            {t('home.insights.viewAllButton', 'View All Articles')}
          </Button>
        </div>
      </div>
    </section>
  );
};

export default BlogSection;
