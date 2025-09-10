import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Video, X, Play, Upload, Loader2 } from "lucide-react";
import { videoCompressor, CompressionProgress } from "@/lib/videoCompression";

interface VideoUploaderProps {
  onVideosChange: (videos: string[]) => void;
  initialVideos?: string[];
}

export function VideoUploader({ onVideosChange, initialVideos = [] }: VideoUploaderProps) {
  const [videos, setVideos] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState<CompressionProgress | null>(null);
  const [showPatientPopup, setShowPatientPopup] = useState(false);

  // Convert any storage URLs to object paths and update videos when initialVideos changes
  useEffect(() => {
    const convertedVideos = initialVideos.map(video => {
      if (video.includes('storage.googleapis.com') && video.includes('.private/uploads/')) {
        const urlParts = video.split('/');
        const bucketIndex = urlParts.findIndex((part: string) => part.includes('objstore'));
        if (bucketIndex !== -1 && urlParts[bucketIndex + 1]) {
          const objectPath = `/objects/${urlParts.slice(bucketIndex + 1).join('/').split('?')[0]}`;
          return objectPath;
        }
      }
      return video;
    });
    setVideos(convertedVideos);
  }, [initialVideos]);

  // Show patient popup when compression starts and hide after 3 seconds
  useEffect(() => {
    if (compressionProgress?.phase === 'loading') {
      setShowPatientPopup(true);
      const timer = setTimeout(() => {
        setShowPatientPopup(false);
      }, 3000); // Hide after 3 seconds
      
      return () => clearTimeout(timer);
    }
  }, [compressionProgress?.phase]);

  const handleFileUpload = async (files: File[]) => {
    setIsUploading(true);
    setCompressionProgress(null);
    
    try {
      const uploadedVideos = [];
      
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let processedFile = file;
        
        // Compress video if needed
        if (videoCompressor.shouldCompress(file)) {
          setCompressionProgress({
            phase: 'loading',
            progress: 0,
            message: `Compressing video ${i + 1} of ${files.length}...`
          });
          
          try {
            processedFile = await videoCompressor.compressVideo(file, setCompressionProgress);
          } catch (compressionError) {
            console.warn('Video compression failed, uploading original:', compressionError);
            // Continue with original file if compression fails
          }
        }
        
        // Get upload URL first
        const uploadResponse = await fetch("/api/videos/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });
        
        if (!uploadResponse.ok) {
          throw new Error("Failed to get upload URL");
        }
        
        const { uploadURL } = await uploadResponse.json();
        
        // Upload the processed file directly to cloud storage using PUT
        const fileUploadResponse = await fetch(uploadURL, {
          method: 'PUT',
          body: processedFile,
        });
        
        if (!fileUploadResponse.ok) {
          throw new Error(`Upload failed: ${fileUploadResponse.statusText}`);
        }
        
        // Convert upload URL to object path for serving
        const urlParts = uploadURL.split('/');
        const bucketIndex = urlParts.findIndex((part: string) => part.includes('objstore'));
        if (bucketIndex !== -1 && urlParts[bucketIndex + 1]) {
          const objectPath = `/objects/${urlParts.slice(bucketIndex + 1).join('/').split('?')[0]}`;
          uploadedVideos.push(objectPath);
        } else {
          uploadedVideos.push(uploadURL);
        }
      }
      
      const newVideos = [...videos, ...uploadedVideos];
      setVideos(newVideos);
      onVideosChange(newVideos);
    } catch (error) {
      console.error("Error uploading videos:", error);
      alert('Failed to upload videos. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const removeVideo = (index: number) => {
    const newVideos = videos.filter((_, i) => i !== index);
    setVideos(newVideos);
    onVideosChange(newVideos);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="h-5 w-5" />
          Property Videos ({videos.length} uploaded)
        </CardTitle>
        <p className="text-sm text-gray-600">
          Upload videos with automatic 1080p HD compression for optimal quality and fast loading. Perfect for virtual tours and detailed property showcases.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Upload Button */}
          {!isUploading && (
            <div className="space-y-4">
              <input
                type="file"
                id="video-upload"
                multiple
                accept=".mp4,.mov,.avi,.mkv,.wmv,.flv,.webm,.m4v,.3gp,.ogv,.ts,.mts,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,video/x-ms-wmv,video/x-flv,video/webm,video/x-m4v,video/3gpp,video/ogg"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleFileUpload(Array.from(e.target.files));
                  }
                }}
                className="hidden"
              />
              <Button
                type="button"
                onClick={() => document.getElementById('video-upload')?.click()}
                className="w-full"
              >
                <div className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Upload 1080p HD (Optimized Size)
                </div>
              </Button>
            </div>
          )}

          {(isUploading || compressionProgress) && (
            <div className="text-center py-4 space-y-3">
              {compressionProgress && (
                <div className="space-y-2">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <p className="text-sm text-gray-600">{compressionProgress.message}</p>
                  </div>
                  <Progress value={compressionProgress.progress} className="w-full max-w-md mx-auto" />
                  <p className="text-xs text-gray-500">
                    {compressionProgress.phase === 'loading' && 'Initializing compression engine...'}
                    {compressionProgress.phase === 'compressing' && 'Compressing to 1080p HD...'}
                    {compressionProgress.phase === 'complete' && 'Compression complete! Uploading...'}
                    {compressionProgress.phase === 'error' && 'Compression failed, uploading original...'}
                  </p>
                </div>
              )}
              {isUploading && !compressionProgress && (
                <p className="text-sm text-gray-500">Uploading videos...</p>
              )}
            </div>
          )}

          {/* Patient Popup */}
          <AlertDialog open={showPatientPopup}>
            <AlertDialogContent className="sm:max-w-md">
              <div className="flex flex-col items-center text-center space-y-4 p-6">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                  <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
                </div>
                <AlertDialogTitle className="text-lg font-semibold text-gray-900">
                  be patient ! your videos will be uploaded soon
                </AlertDialogTitle>
                <AlertDialogDescription className="text-sm text-gray-600">
                  We're preparing your videos for optimal quality and fast loading
                </AlertDialogDescription>
              </div>
            </AlertDialogContent>
          </AlertDialog>

          {/* Video List */}
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
                      <p className="text-xs text-gray-500">1080p HD Video</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
1080p HD
                    </Badge>
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

          {/* Info Section */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <h4 className="font-medium text-blue-900 mb-2">Video Upload Benefits:</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• Automatic 1080p HD compression for optimal quality and size</li>
              <li>• No quantity restrictions - Add as many videos as needed</li>
              <li>• Smart compression - only processes large or unoptimized files</li>
              <li>• Perfect for virtual tours, drone footage, and walkthroughs</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}