import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, User } from "lucide-react";

export default function Blog() {
  const { data: blogPosts = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/blog"],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-6xl mx-auto px-4">
          <div className="text-center">
            <h1 className="text-4xl font-bold text-gray-900 mb-4">Blog</h1>
            <p className="text-xl text-gray-600 mb-12">Loading blog posts...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Blog</h1>
          <p className="text-xl text-gray-600">
            Latest insights and updates from our real estate experts
          </p>
        </div>

        {/* Blog Posts */}
        {blogPosts.length === 0 ? (
          <div className="text-center py-12">
            <div className="max-w-md mx-auto">
              <h3 className="text-2xl font-semibold text-gray-900 mb-4">
                No blog posts yet
              </h3>
              <p className="text-gray-600">
                We're working on some great content. Check back soon for the latest
                insights about real estate and market trends.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {blogPosts.map((post: any) => (
              <Card key={post.id} className="h-full hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {post.category && (
                      <Badge variant="secondary" className="text-xs">
                        {post.category}
                      </Badge>
                    )}
                    {post.published && (
                      <Badge variant="outline" className="text-xs">
                        Published
                      </Badge>
                    )}
                  </div>
                  <CardTitle className="text-xl font-bold leading-tight">
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
                        <span>{post.author?.name || post.author?.email || "Anonymous"}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4" />
                        <span>
                          {post.createdAt ? new Date(post.createdAt).toLocaleDateString() : "Recently"}
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