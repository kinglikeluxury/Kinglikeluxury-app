import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Video, X, Play, Upload, Loader2 } from "lucide-react";
import { videoCompressor, CompressionProgress } from "@/lib/videoCompression";
import logoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";

interface VideoUploaderProps {
  onVideosChange: (videos: string[]) => void;
  initialVideos?: string[];
}

export function VideoUploader({ onVideosChange, initialVideos = [] }: VideoUploaderProps) {
  const [videos, setVideos] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState<CompressionProgress | null>(null);
  const [showPatientPopup, setShowPatientPopup] = useState(false);
  const [uploadController, setUploadController] = useState<AbortController | null>(null);

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
      }, 5000); // Hide after 5 seconds
      
      return () => clearTimeout(timer);
    }
  }, [compressionProgress?.phase]);

  const cancelUpload = () => {
    if (uploadController) {
      uploadController.abort();
      setUploadController(null);
    }
    setIsUploading(false);
    setCompressionProgress(null);
    setShowPatientPopup(false);
  };

  const handleFileUpload = async (files: File[]) => {
    // Create abort controller for this upload session
    const controller = new AbortController();
    setUploadController(controller);
    setIsUploading(true);
    setCompressionProgress(null);
    
    try {
      const uploadedVideos = [];
      
      for (let i = 0; i < files.length; i++) {
        // Check if upload was cancelled
        if (controller.signal.aborted) {
          throw new Error('Upload cancelled');
        }

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
            
            // Check if cancelled during compression
            if (controller.signal.aborted) {
              throw new Error('Upload cancelled');
            }
          } catch (compressionError: unknown) {
            if (compressionError instanceof Error && compressionError.message === 'Upload cancelled') {
              throw compressionError;
            }
            console.warn('Video compression failed, uploading original:', compressionError);
            // Continue with original file if compression fails
          }
        }
        
        // Check if cancelled before uploading
        if (controller.signal.aborted) {
          throw new Error('Upload cancelled');
        }

        // Upload file directly to server as multipart form data
        const formData = new FormData();
        formData.append("file", processedFile);

        const uploadResponse = await fetch("/api/videos/upload", {
          method: "POST",
          credentials: "include",
          body: formData,
          signal: controller.signal,
        });

        if (!uploadResponse.ok) {
          const errText = await uploadResponse.text();
          throw new Error(`Upload failed: ${errText}`);
        }

        const { url } = await uploadResponse.json();
        uploadedVideos.push(url);
      }
      
      const newVideos = [...videos, ...uploadedVideos];
      setVideos(newVideos);
      onVideosChange(newVideos);
    } catch (error: unknown) {
      if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Upload cancelled')) {
        console.log('Upload cancelled by user');
        // Don't show error for cancelled uploads
      } else {
        console.error("Error uploading videos:", error);
        alert('Failed to upload videos. Please try again.');
      }
    } finally {
      setIsUploading(false);
      setCompressionProgress(null);
      setShowPatientPopup(false);
      setUploadController(null);
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
              
              {/* Cancel Button */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={cancelUpload}
                className="mt-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                data-testid="button-cancel-upload"
              >
                <X className="h-4 w-4 mr-1" />
                Cancel Upload
              </Button>
            </div>
          )}

          {/* Patient Popup with 3D Effect */}
          <AlertDialog open={showPatientPopup}>
            <AlertDialogContent className="sm:max-w-md border-0 shadow-2xl bg-gradient-to-br from-white via-blue-50 to-indigo-100">
              <div className="flex flex-col items-center text-center space-y-6 p-8 relative overflow-hidden">
                {/* 3D Background Effect */}
                <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 via-purple-400/10 to-pink-400/10 transform rotate-12 scale-110"></div>
                
                {/* 3D Logo Container */}
                <div className="relative z-10">
                  <div className="w-24 h-24 relative transform-gpu perspective-1000">
                    {/* 3D Logo with floating animation */}
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full opacity-20 blur-xl animate-pulse"></div>
                    <div className="relative w-full h-full transform-gpu transition-transform duration-1000 hover:scale-110 animate-float">
                      <div className="absolute inset-0 bg-white rounded-full shadow-2xl transform rotate-6 scale-105 opacity-30"></div>
                      <div className="absolute inset-0 bg-white rounded-full shadow-xl transform -rotate-3 scale-95 opacity-50"></div>
                      <div className="relative w-full h-full bg-white rounded-full shadow-lg flex items-center justify-center transform-gpu hover:rotate-y-12 transition-transform duration-500">
                        <img 
                          src={logoPath} 
                          alt="Kinglike Luxury" 
                          className="w-16 h-16 object-contain transform-gpu hover:scale-110 transition-transform duration-300 drop-shadow-lg"
                        />
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* 3D Text */}
                <div className="relative z-10">
                  <AlertDialogTitle className="text-xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent transform-gpu hover:scale-105 transition-transform duration-300 drop-shadow-lg">
                    Be patient !<br />your videos will be uploaded soon
                  </AlertDialogTitle>
                </div>
                
                <AlertDialogDescription className="text-sm text-gray-600 relative z-10 font-medium">
                  We're preparing your videos for optimal quality and fast loading
                </AlertDialogDescription>
                
                {/* Cancel Button in Popup */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelUpload}
                  className="relative z-10 mt-4 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300 bg-white/80 backdrop-blur-sm"
                  data-testid="button-cancel-popup"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                
                {/* Floating Particles Effect */}
                <div className="absolute top-4 left-4 w-2 h-2 bg-blue-400 rounded-full opacity-60 animate-bounce"></div>
                <div className="absolute top-8 right-6 w-1 h-1 bg-purple-400 rounded-full opacity-40 animate-ping"></div>
                <div className="absolute bottom-6 left-8 w-1.5 h-1.5 bg-indigo-400 rounded-full opacity-50 animate-pulse"></div>
                <div className="absolute bottom-4 right-4 w-1 h-1 bg-pink-400 rounded-full opacity-30 animate-bounce"></div>
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

