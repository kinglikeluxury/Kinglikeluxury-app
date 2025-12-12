import { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { apiRequest } from '@/lib/queryClient';
import { BlogPost } from '@shared/schema';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowRight, Calendar, User, Tag } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Sample blog images for initial development
const SAMPLE_IMAGES = [
  'https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1582407947304-fd86f028f716?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80',
  'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80'
];

export const BlogSection = () => {
  const { t } = useTranslation();
  const [blogPosts, setBlogPosts] = useState<(BlogPost & { author: { username: string } })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchBlogPosts = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/blog');
        if (!response.ok) {
          // If we don't have blog posts yet, set empty array (we'll show placeholder)
          setBlogPosts([]);
          return;
        }
        const data = await response.json();
        setBlogPosts(data.slice(0, 3)); // Get the 3 most recent posts
      } catch (error) {
        console.error('Error fetching blog posts:', error);
        setBlogPosts([]); // Show placeholder if error
      } finally {
        setIsLoading(false);
      }
    };

    fetchBlogPosts();
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    // Always use Gregorian calendar (English locale) for dates
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date);
  };

  // For development purposes - sample blog posts with translations
  const samplePosts = [
    {
      id: 1,
      title: t('home.insights.posts.post1.title', '5 Tips for Buying Your First Luxury Villa'),
      slug: "tips-buying-first-luxury-villa",
      excerpt: t('home.insights.posts.post1.excerpt', 'Discover essential advice for first-time luxury homebuyers looking to make a sound investment in premium real estate.'),
      coverImage: SAMPLE_IMAGES[0],
      categories: [t('home.insights.categories.luxuryHomes', 'Luxury Homes'), t('home.insights.categories.buyingGuide', 'Buying Guide')],
      createdAt: new Date().toISOString(),
      author: { username: t('home.insights.posts.post1.author', 'Sarah Johnson') }
    },
    {
      id: 2,
      title: t('home.insights.posts.post2.title', '2024 Market Trends: Middle East Luxury Real Estate'),
      slug: "2024-market-trends-middle-east",
      excerpt: t('home.insights.posts.post2.excerpt', 'An in-depth analysis of current luxury property market trends across Dubai, Abu Dhabi, and emerging locations.'),
      coverImage: SAMPLE_IMAGES[1],
      categories: [t('home.insights.categories.marketAnalysis', 'Market Analysis'), t('home.insights.categories.investment', 'Investment')],
      createdAt: new Date().toISOString(),
      author: { username: t('home.insights.posts.post2.author', 'Ahmad Al-Farsi') }
    },
    {
      id: 3,
      title: t('home.insights.posts.post3.title', 'Creating the Perfect Outdoor Space for Your Property'),
      slug: "perfect-outdoor-space-property",
      excerpt: t('home.insights.posts.post3.excerpt', 'Landscape design tips that can increase your property value while creating stunning exterior living areas.'),
      coverImage: SAMPLE_IMAGES[2],
      categories: [t('home.insights.categories.design', 'Design'), t('home.insights.categories.propertyValue', 'Property Value')],
      createdAt: new Date().toISOString(),
      author: { username: t('home.insights.posts.post3.author', 'Michael Chen') }
    }
  ];

  // Use actual blog posts if available, otherwise use sample posts
  const displayPosts = blogPosts.length > 0 ? blogPosts : samplePosts;

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
            // Skeletons for loading state
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
          ) : (
            displayPosts.map((post) => (
              <div key={post.id} className="bg-white rounded-lg overflow-hidden shadow-lg transition-all duration-300 hover:shadow-xl group">
                <div className="relative h-64 overflow-hidden">
                  <img
                    src={post.coverImage}
                    alt={post.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
                  <div className="absolute bottom-4 left-4 right-4">
                    {post.categories && post.categories.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {post.categories.map((category, idx) => (
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
                      {formatDate(post.createdAt.toString())}
                    </div>
                    <div className="flex items-center">
                      <User className="w-3 h-3 mr-1" />
                      {post.author.username}
                    </div>
                  </div>
                  
                  <h3 className="text-xl font-bold mb-3 text-gray-900 line-clamp-2 group-hover:text-[#005476] transition-colors">
                    {post.title}
                  </h3>
                  
                  <p className="text-gray-600 mb-4 line-clamp-3">
                    {post.excerpt}
                  </p>
                  
                  <div className="inline-flex items-center text-[#3bcac4] hover:text-[#005476] font-medium cursor-pointer" onClick={() => window.location.href = `/blog/${post.slug}`}>
                    {t('home.insights.readArticle', 'Read Article')}
                    <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>
              </div>
            ))
          )}
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