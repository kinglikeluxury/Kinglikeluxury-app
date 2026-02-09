import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { BlogPost } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, ArrowLeft, Eye, EyeOff } from "lucide-react";

type BlogPostWithAuthor = BlogPost & { author: { username: string } };

const BlogManagement = () => {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [editingPost, setEditingPost] = useState<BlogPostWithAuthor | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [coverImage, setCoverImage] = useState("");
  const [categories, setCategories] = useState("");
  const [published, setPublished] = useState(true);

  useEffect(() => {
    if (!authLoading && (!user || !user.isAdmin)) {
      navigate("/");
    }
  }, [user, authLoading, navigate]);

  const { data: posts, isLoading: postsLoading } = useQuery<BlogPostWithAuthor[]>({
    queryKey: ['/api/blog?published=all'],
    enabled: !!user?.isAdmin,
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/blog", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/blog'] });
      queryClient.invalidateQueries({ queryKey: ['/api/blog?published=all'] });
      toast({ title: "Blog post created successfully" });
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error creating post", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      const res = await apiRequest("PUT", `/api/blog/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/blog'] });
      queryClient.invalidateQueries({ queryKey: ['/api/blog?published=all'] });
      toast({ title: "Blog post updated successfully" });
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: "Error updating post", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/blog/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/blog'] });
      queryClient.invalidateQueries({ queryKey: ['/api/blog?published=all'] });
      toast({ title: "Blog post deleted successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting post", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setTitle("");
    setContent("");
    setExcerpt("");
    setCoverImage("");
    setCategories("");
    setPublished(true);
    setEditingPost(null);
    setShowForm(false);
  };

  const startEdit = (post: BlogPostWithAuthor) => {
    setEditingPost(post);
    setTitle(post.title);
    setContent(post.content);
    setExcerpt(post.excerpt);
    setCoverImage(post.coverImage);
    setCategories(Array.isArray(post.categories) ? post.categories.join(", ") : "");
    setPublished(post.published);
    setShowForm(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      toast({ title: "Title and content are required", variant: "destructive" });
      return;
    }

    const data = {
      title: title.trim(),
      content: content.trim(),
      excerpt: excerpt.trim() || content.trim().substring(0, 200),
      coverImage: coverImage.trim(),
      categories: categories.split(",").map(c => c.trim()).filter(Boolean),
      published,
    };

    if (editingPost) {
      updateMutation.mutate({ id: editingPost.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  if (authLoading || postsLoading) {
    return (
      <div className="p-8">
        <div className="max-w-5xl mx-auto">
          <Skeleton className="h-8 w-64 mb-6" />
          <div className="space-y-4">
            {Array(3).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!user?.isAdmin) return null;

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-[#005476]">Blog Management</h1>
          {!showForm && (
            <Button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="bg-[#3bcac4] hover:bg-[#2fb8b2] text-white"
            >
              <Plus className="w-4 h-4 mr-2" /> New Post
            </Button>
          )}
        </div>

        {showForm && (
          <Card className="mb-8 border-[#3bcac4]/30">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-[#005476]">
                  {editingPost ? "Edit Post" : "Create New Post"}
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={resetForm}>
                  <ArrowLeft className="w-4 h-4 mr-1" /> Cancel
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter blog post title"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="coverImage">Cover Image URL</Label>
                  <Input
                    id="coverImage"
                    value={coverImage}
                    onChange={(e) => setCoverImage(e.target.value)}
                    placeholder="https://example.com/image.jpg"
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="excerpt">Excerpt</Label>
                  <Textarea
                    id="excerpt"
                    value={excerpt}
                    onChange={(e) => setExcerpt(e.target.value)}
                    placeholder="Brief summary of the post (auto-generated from content if empty)"
                    rows={2}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="content">Content *</Label>
                  <Textarea
                    id="content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Write your blog post content here..."
                    rows={12}
                    className="mt-1"
                  />
                </div>

                <div>
                  <Label htmlFor="categories">Categories (comma-separated)</Label>
                  <Input
                    id="categories"
                    value={categories}
                    onChange={(e) => setCategories(e.target.value)}
                    placeholder="Real Estate, Luxury, Dubai"
                    className="mt-1"
                  />
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    id="published"
                    checked={published}
                    onCheckedChange={setPublished}
                  />
                  <Label htmlFor="published">
                    {published ? "Published" : "Draft"}
                  </Label>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="bg-[#3bcac4] hover:bg-[#2fb8b2] text-white"
                  >
                    {(createMutation.isPending || updateMutation.isPending)
                      ? "Saving..."
                      : editingPost ? "Update Post" : "Create Post"}
                  </Button>
                  <Button type="button" variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="space-y-4">
          {(!posts || posts.length === 0) && !showForm && (
            <Card className="p-12 text-center">
              <p className="text-gray-500 mb-4">No blog posts yet</p>
              <Button
                onClick={() => setShowForm(true)}
                className="bg-[#3bcac4] hover:bg-[#2fb8b2] text-white"
              >
                <Plus className="w-4 h-4 mr-2" /> Create Your First Post
              </Button>
            </Card>
          )}

          {posts?.map((post) => (
            <Card key={post.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4 md:p-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold text-[#005476] truncate">{post.title}</h3>
                      {post.published ? (
                        <span className="flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                          <Eye className="w-3 h-3" /> Published
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                          <EyeOff className="w-3 h-3" /> Draft
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 line-clamp-2">{post.excerpt}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-400">
                      <span>By {post.author?.username || "Admin"}</span>
                      <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                      {Array.isArray(post.categories) && post.categories.length > 0 && (
                        <span>{post.categories.join(", ")}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => startEdit(post)}
                    >
                      <Pencil className="w-4 h-4 mr-1" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this post?")) {
                          deleteMutation.mutate(post.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="w-4 h-4 mr-1" /> Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BlogManagement;
