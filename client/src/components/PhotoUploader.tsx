import { useState } from "react";
import { ObjectUploader } from "./ObjectUploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Camera, X, Image } from "lucide-react";
import type { UploadResult } from "@uppy/core";

interface PhotoUploaderProps {
  maxPhotos?: number;
  onPhotosChange: (photos: string[]) => void;
  initialPhotos?: string[];
}

export function PhotoUploader({ 
  maxPhotos = 30, 
  onPhotosChange, 
  initialPhotos = [] 
}: PhotoUploaderProps) {
  const [photos, setPhotos] = useState<string[]>(initialPhotos);
  const [isUploading, setIsUploading] = useState(false);


  const handleUploadComplete = (fileUrls: string[]) => {
    const newPhotos = [...photos, ...fileUrls];
    setPhotos(newPhotos);
    onPhotosChange(newPhotos);
  };

  const removePhoto = (index: number) => {
    const newPhotos = photos.filter((_, i) => i !== index);
    setPhotos(newPhotos);
    onPhotosChange(newPhotos);
  };

  const canAddMore = photos.length < maxPhotos;
  const remainingSlots = maxPhotos - photos.length;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-5 w-5" />
          Property Photos ({photos.length}/{maxPhotos})
        </CardTitle>
        <p className="text-sm text-gray-600">
          Upload up to {maxPhotos} high-quality photos of your property. Images will be automatically watermarked.
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Upload Button */}
          {canAddMore && !isUploading && (
            <ObjectUploader
              maxNumberOfFiles={Math.min(remainingSlots, 10)} // Allow batch upload up to 10 at once
              maxFileSize={50 * 1024 * 1024} // 50MB per image
              allowedFileTypes={["image/*"]}
              type="photo"
              onComplete={handleUploadComplete}
              buttonClassName="w-full"
            >
              <div className="flex items-center gap-2">
                <Image className="h-4 w-4" />
                Upload Photos ({remainingSlots} slots remaining)
              </div>
            </ObjectUploader>
          )}

          {isUploading && (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500">Processing and watermarking images...</p>
            </div>
          )}

          {!canAddMore && (
            <div className="text-center py-2">
              <Badge variant="secondary">Maximum {maxPhotos} photos reached</Badge>
            </div>
          )}

          {/* Photo Grid */}
          {photos.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {photos.map((photo, index) => (
                <div key={index} className="relative group">
                  <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                    <img
                      src={photo}
                      alt={`Property photo ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => removePhoto(index)}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                  <div className="absolute bottom-2 left-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                    {index + 1}
                  </div>
                </div>
              ))}
            </div>
          )}

          {photos.length === 0 && (
            <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
              <Camera className="h-12 w-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-500">No photos uploaded yet</p>
              <p className="text-sm text-gray-400">Click the upload button above to add property photos</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}