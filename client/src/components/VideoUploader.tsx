import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Video, X, Play, Upload, Loader2 } from "lucide-react";
import { videoCompressor, CompressionProgress } from "@/lib/videoCompression";
import { uploadToCloudinary } from "@/lib/cloudinaryUpload";
import logoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";

interface VideoUploaderProps {
  onVideosChange: (videos: string[]) => void;
  initialVideos?: string[];
}

export function VideoUploader({ onVideosChange, initialVideos = [] }: VideoUploaderProps) {
  const [videos, setVideos] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState<CompressionProgress | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [showPatientPopup, setShowPatientPopup] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    setVideos(initialVideos.filter(Boolean));
  }, [initialVideos]);

  useEffect(() => {
    if (compressionProgress?.phase === "loading") {
      setShowPatientPopup(true);
      const t = setTimeout(() => setShowPatientPopup(false), 5000);
      return () => clearTimeout(t);
    }
  }, [compressionProgress?.phase]);

  const cancelUpload = () => {
    setCancelled(true);
    setIsUploading(false);
    setCompressionProgress(null);
    setShowPatientPopup(false);
    setUploadProgress(0);
  };

  const handleFileUpload = async (files: File[]) => {
    setCancelled(false);
    setIsUploading(true);
    setCompressionProgress(null);
    setUploadProgress(0);

    const uploadedVideos: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        if (cancelled) break;

        let file = files[i];

        if (videoCompressor.shouldCompress(file)) {
          setCompressionProgress({
            phase: "loading",
            progress: 0,
            message: `Compressing video ${i + 1} of ${files.length}...`,
          });
          try {
            file = await videoCompressor.compressVideo(file, setCompressionProgress);
          } catch (err) {
            console.warn("Compression failed, using original:", err);
          }
        }

        if (cancelled) break;

        setCompressionProgress(null);

        const result = await uploadToCloudinary(file, "video", (pct) => {
          const overall = Math.round(((i + pct / 100) / files.length) * 100);
          setUploadProgress(overall);
        });

        uploadedVideos.push(result.secure_url);
        setUploadProgress(Math.round(((i + 1) / files.length) * 100));
      }

      if (!cancelled && uploadedVideos.length > 0) {
        const newVideos = [...videos, ...uploadedVideos];
        setVideos(newVideos);
        onVideosChange(newVideos);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message !== "Upload cancelled") {
        console.error("Error uploading videos:", error);
        alert(`Failed to upload video: ${error.message}`);
      }
    } finally {
      setIsUploading(false);
      setCompressionProgress(null);
      setShowPatientPopup(false);
      setUploadProgress(0);
    }
  };

  const removeVideo = (index: number) => {
    const newVideos = videos.filter((_, i) => i !== index);
    setVideos(newVideos);
    onVideosChange(newVideos);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="h-5 w-5" />
          Property Videos ({videos.length} uploaded)
        </CardTitle>
        <p className="text-sm text-gray-600">
          Upload videos with automatic 1080p HD compression for optimal quality and fast loading.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {!isUploading && (
            <div>
              <input
                type="file"
                id="video-upload"
                multiple
                accept=".mp4,.mov,.avi,.mkv,.wmv,.flv,.webm,.m4v,.3gp,.ogv,video/*"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFileUpload(Array.from(e.target.files));
                  }
                }}
                className="hidden"
              />
              <Button
                type="button"
                onClick={() => document.getElementById("video-upload")?.click()}
                className="w-full"
              >
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Upload 1080p HD (Optimized Size)
                </div>
              </Button>
            </div>
          )}

          {isUploading && (
            <div className="text-center py-4 space-y-3">
              {compressionProgress ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <p className="text-sm text-gray-600">{compressionProgress.message}</p>
                  </div>
                  <Progress value={compressionProgress.progress} className="w-full max-w-md mx-auto" />
                  <p className="text-xs text-gray-500">
                    {compressionProgress.phase === "loading" && "Initializing compression engine..."}
                    {compressionProgress.phase === "compressing" && "Compressing to 1080p HD..."}
                    {compressionProgress.phase === "complete" && "Compression complete! Uploading..."}
                    {compressionProgress.phase === "error" && "Compression failed, uploading original..."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <p className="text-sm text-gray-500">Uploading to Cloudinary... {uploadProgress}%</p>
                  </div>
                  <Progress value={uploadProgress} className="w-full max-w-md mx-auto" />
                </div>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cancelUpload}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                <X className="h-4 w-4 mr-1" />
                Cancel Upload
              </Button>
            </div>
          )}

          {/* Patient Popup */}
          <AlertDialog open={showPatientPopup}>
            <AlertDialogContent className="sm:max-w-md border-0 shadow-2xl bg-gradient-to-br from-white via-blue-50 to-indigo-100">
              <div className="flex flex-col items-center text-center space-y-6 p-8 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 via-purple-400/10 to-pink-400/10 transform rotate-12 scale-110" />
                <div className="relative z-10">
                  <div className="w-24 h-24 relative">
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full opacity-20 blur-xl animate-pulse" />
                    <div className="relative w-full h-full bg-white rounded-full shadow-lg flex items-center justify-center">
                      <img src={logoPath} alt="Kinglike Luxury" className="w-16 h-16 object-contain drop-shadow-lg" />
                    </div>
                  </div>
                </div>
                <AlertDialogTitle className="text-xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent relative z-10">
                  Be patient!<br />Your video will be uploaded soon
                </AlertDialogTitle>
                <AlertDialogDescription className="text-sm text-gray-600 relative z-10 font-medium">
                  We're preparing your video for optimal quality and fast loading
                </AlertDialogDescription>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelUpload}
                  className="relative z-10 text-red-600 border-red-200 hover:bg-red-50 bg-white/80"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </div>
            </AlertDialogContent>
          </AlertDialog>

          {videos.length > 0 && (
            <div className="space-y-3">
              {videos.map((video, index) => (
                <div key={index} className="flex items-center justify-between bg-gray-50 p-4 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Play className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Property Video {index + 1}</p>
                      <p className="text-xs text-gray-500 truncate max-w-[200px]">{video.split("/").pop()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">1080p HD</Badge>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeVideo(index)}
                      className="text-red-500 hover:text-red-600"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {videos.length === 0 && (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
              <Video className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-500">No videos uploaded yet</p>
              <p className="text-sm text-gray-400">Upload videos optimized to 1080p HD for faster loading</p>
            </div>
          )}

          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">Video Upload Benefits:</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• Automatic 1080p HD compression for optimal quality and size</li>
              <li>• No quantity restrictions — add as many videos as needed</li>
              <li>• Smart compression — only processes large or unoptimized files</li>
              <li>• Perfect for virtual tours, drone footage, and walkthroughs</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
