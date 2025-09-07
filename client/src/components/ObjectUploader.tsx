import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  allowedFileTypes?: string[];
  onComplete?: (fileUrls: string[]) => void;
  buttonClassName?: string;
  children: ReactNode;
  type?: "photo" | "video";
}

/**
 * Simple file upload component with drag-and-drop support
 */
export function ObjectUploader({
  maxNumberOfFiles = 1,
  maxFileSize = 10485760, // 10MB default
  allowedFileTypes = [],
  onComplete,
  buttonClassName,
  children,
  type = "photo"
}: ObjectUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).slice(0, maxNumberOfFiles);
      setSelectedFiles(files);
    }
  };

  const uploadFiles = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    const uploadedUrls: string[] = [];

    try {
      for (const file of selectedFiles) {
        // Get upload URL from server
        const urlResponse = await apiRequest(`/api/${type}s/upload`, 'POST');
        const { uploadURL } = urlResponse as { uploadURL: string };

        // Extract fileId from URL
        const fileId = uploadURL.split('/').pop();

        // Upload file using FormData
        const formData = new FormData();
        formData.append('file', file);

        const uploadResponse = await fetch(uploadURL, {
          method: 'POST',
          body: formData,
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.statusText}`);
        }

        const { url } = await uploadResponse.json();
        uploadedUrls.push(url);
      }

      onComplete?.(uploadedUrls);
      setSelectedFiles([]);
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button 
          onClick={() => document.getElementById('file-input')?.click()}
          className={buttonClassName}
          disabled={isUploading}
        >
          {children}
        </Button>
        
        <Input
          id="file-input"
          type="file"
          multiple={maxNumberOfFiles > 1}
          accept={allowedFileTypes.join(',')}
          onChange={handleFileSelect}
          className="hidden"
        />
        
        {selectedFiles.length > 0 && (
          <Button onClick={uploadFiles} disabled={isUploading}>
            {isUploading ? 'Uploading...' : `Upload ${selectedFiles.length} file(s)`}
          </Button>
        )}
      </div>
      
      {selectedFiles.length > 0 && (
        <div className="text-sm text-gray-600">
          Selected: {selectedFiles.map(f => f.name).join(', ')}
        </div>
      )}
    </div>
  );
}