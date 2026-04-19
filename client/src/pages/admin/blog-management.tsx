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
import { Plus, Pencil, Trash2, ArrowLeft, Eye, EyeOff, Upload, ImageIcon, X, RefreshCw, Video } from "lucide-react";

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
  const [coverVideo, setCoverVideo] = useState("");
  const [coverType, setCoverType] = useState<"image" | "video">("image");
  const [categories, setCategories] = useState("");
  const [country, setCountry] = useState("georgia");
  const [published, setPublished] = useState(true);
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      toast({ title: "يرجى اختيار صورة بصيغة JPG, PNG, WEBP أو GIF", variant: "destructive" });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "حجم الصورة يجب أن يكون أقل من 10 ميغابايت", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch('/api/blog/upload-image', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Upload failed');
      const { url } = await res.json();
      setCoverImage(url);
      toast({ title: "تم رفع الصورة بنجاح" });
    } catch {
      toast({ title: "فشل رفع الصورة", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo'];
    if (!validTypes.includes(file.type)) {
      toast({ title: "يرجى اختيار فيديو بصيغة MP4, WEBM, MOV أو AVI", variant: "destructive" });
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      toast({ title: "حجم الفيديو يجب أن يكون أقل من 100 ميغابايت", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('video', file);
      const res = await fetch('/api/blog/upload-video', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Upload failed');
      const { url } = await res.json();
      setCoverVideo(url);
      toast({ title: "تم رفع الفيديو بنجاح" });
    } catch {
      toast({ title: "فشل رفع الفيديو", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

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
    setCoverVideo("");
    setCoverType("image");
    setCategories("");
    setCountry("georgia");
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
    setCoverVideo((post as any).coverVideo || "");
    setCoverType((post as any).coverVideo ? "video" : "image");
    setCategories(Array.isArray(post.categories) ? post.categories.join(", ") : "");
    setCountry((post as any).country || "georgia");
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
      coverVideo: coverVideo.trim() || null,
      categories: categories.split(",").map(c => c.trim()).filter(Boolean),
      country,
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
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    toast({ title: "جارٍ إعادة ترجمة جميع المقالات..." });
                    await apiRequest("POST", "/api/blog/retranslate-all");
                    toast({ title: "تمت إعادة الترجمة بنجاح! قد تستغرق دقائق." });
                  } catch {
                    toast({ title: "فشلت إعادة الترجمة", variant: "destructive" });
                  }
                }}
                className="border-[#3bcac4] text-[#005476]"
              >
                <RefreshCw className="w-4 h-4 mr-2" /> Re-translate All
              </Button>
              <Button
                onClick={() => { resetForm(); setShowForm(true); }}
                className="bg-[#3bcac4] hover:bg-[#2fb8b2] text-white"
              >
                <Plus className="w-4 h-4 mr-2" /> New Post
              </Button>
            </div>
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
                  <Label>Country / Region *</Label>
                  <div className="flex gap-3 mt-2">
                    <button
                      type="button"
                      onClick={() => setCountry("georgia")}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 transition font-medium ${
                        country === "georgia"
                          ? "border-[#3bcac4] bg-[#3bcac4]/10 text-[#005476]"
                          : "border-gray-200 hover:border-gray-300 text-gray-500"
                      }`}
                    >
                      <span className="text-xl">🇬🇪</span>
                      Georgia
                    </button>
                    <button
                      type="button"
                      onClick={() => setCountry("uae")}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 transition font-medium ${
                        country === "uae"
                          ? "border-[#3bcac4] bg-[#3bcac4]/10 text-[#005476]"
                          : "border-gray-200 hover:border-gray-300 text-gray-500"
                      }`}
                    >
                      <span className="text-xl">🇦🇪</span>
                      Dubai / UAE
                    </button>
                    <button
                      type="button"
                      onClick={() => setCountry("turkey")}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 transition font-medium ${
                        country === "turkey"
                          ? "border-[#3bcac4] bg-[#3bcac4]/10 text-[#005476]"
                          : "border-gray-200 hover:border-gray-300 text-gray-500"
                      }`}
                    >
                      <span className="text-xl">🇹🇷</span>
                      Turkey
                    </button>
                    <button
                      type="button"
                      onClick={() => setCountry("northern-cyprus")}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-lg border-2 transition font-medium ${
                        country === "northern-cyprus"
                          ? "border-[#3bcac4] bg-[#3bcac4]/10 text-[#005476]"
                          : "border-gray-200 hover:border-gray-300 text-gray-500"
                      }`}
                    >
                      <span className="text-xl">🇨🇾</span>
                      N. Cyprus
                    </button>
                  </div>
                </div>

                <div>
                  <Label>Cover Media</Label>
                  <div className="flex gap-2 mt-1 mb-3">
                    <button
                      type="button"
                      onClick={() => { setCoverType("image"); setCoverVideo(""); }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border-2 transition font-medium text-sm ${
                        coverType === "image"
                          ? "border-[#3bcac4] bg-[#3bcac4]/10 text-[#005476]"
                          : "border-gray-200 hover:border-gray-300 text-gray-500"
                      }`}
                    >
                      <ImageIcon className="w-4 h-4" />
                      Image
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCoverType("video"); setCoverImage(""); }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border-2 transition font-medium text-sm ${
                        coverType === "video"
                          ? "border-[#3bcac4] bg-[#3bcac4]/10 text-[#005476]"
                          : "border-gray-200 hover:border-gray-300 text-gray-500"
                      }`}
                    >
                      <Video className="w-4 h-4" />
                      Video
                    </button>
                  </div>

                  {coverType === "image" ? (
                    <>
                      <p className="text-xs text-gray-400 mb-2">Recommended: 1200 × 630 px (16:9) — JPG, PNG, WEBP — Max 10MB</p>
                      {coverImage ? (
                        <div className="relative rounded-lg overflow-hidden border border-gray-200">
                          <img
                            src={coverImage}
                            alt="Cover preview"
                            className="w-full h-48 object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => setCoverImage("")}
                            className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <label
                          htmlFor="coverImageFile"
                          className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition ${
                            uploading ? 'border-[#3bcac4] bg-[#3bcac4]/5' : 'border-gray-300 hover:border-[#3bcac4] hover:bg-gray-50'
                          }`}
                        >
                          {uploading ? (
                            <div className="flex flex-col items-center gap-2">
                              <div className="w-8 h-8 border-3 border-[#3bcac4] border-t-transparent rounded-full animate-spin" />
                              <span className="text-sm text-[#3bcac4]">Uploading...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-gray-400">
                              <ImageIcon className="w-10 h-10" />
                              <span className="text-sm font-medium">Click to upload cover image</span>
                              <span className="text-xs">or drag and drop</span>
                            </div>
                          )}
                          <input
                            id="coverImageFile"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            onChange={handleImageUpload}
                            className="hidden"
                            disabled={uploading}
                          />
                        </label>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-gray-400 mb-2">MP4, WEBM, MOV, AVI — Max 100MB</p>
                      {coverVideo ? (
                        <div className="relative rounded-lg overflow-hidden border border-gray-200">
                          <video
                            src={coverVideo}
                            className="w-full h-48 object-cover"
                            controls
                            muted
                          />
                          <button
                            type="button"
                            onClick={() => setCoverVideo("")}
                            className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1 hover:bg-black/80 transition"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <label
                          htmlFor="coverVideoFile"
                          className={`flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition ${
                            uploading ? 'border-[#3bcac4] bg-[#3bcac4]/5' : 'border-gray-300 hover:border-[#3bcac4] hover:bg-gray-50'
                          }`}
                        >
                          {uploading ? (
                            <div className="flex flex-col items-center gap-2">
                              <div className="w-8 h-8 border-3 border-[#3bcac4] border-t-transparent rounded-full animate-spin" />
                              <span className="text-sm text-[#3bcac4]">Uploading...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-2 text-gray-400">
                              <Video className="w-10 h-10" />
                              <span className="text-sm font-medium">Click to upload cover video</span>
                              <span className="text-xs">or drag and drop</span>
                            </div>
                          )}
                          <input
                            id="coverVideoFile"
                            type="file"
                            accept="video/mp4,video/webm,video/quicktime,video/x-msvideo"
                            onChange={handleVideoUpload}
                            className="hidden"
                            disabled={uploading}
                          />
                        </label>
                      )}
                    </>
                  )}
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
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                        {(post as any).country === 'uae' ? '🇦🇪 UAE' : (post as any).country === 'turkey' ? '🇹🇷 Turkey' : (post as any).country === 'northern-cyprus' ? '🇨🇾 N. Cyprus' : '🇬🇪 Georgia'}
                      </span>
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
