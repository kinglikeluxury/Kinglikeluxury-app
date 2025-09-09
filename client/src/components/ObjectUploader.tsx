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
  type?: "photo" | "video" | "audio";
}

/**
 * Simple file upload component with drag-and-drop support
 */
export function ObjectUploader({
  maxNumberOfFiles = 10, // Allow multiple files
  maxFileSize = Infinity, // No size limit for unlimited duration videos/audio
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
        // Get upload URL from server - using fetch directly to debug
        const response = await fetch(`/api/${type}s/upload`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (!response.ok) {
          throw new Error(`Failed to get upload URL: ${response.statusText}`);
        }
        
        const urlResponse = await response.json();
        console.log('URL Response:', urlResponse);
        const { uploadURL } = urlResponse;
        console.log('Upload URL:', uploadURL);
        
        if (!uploadURL) {
          throw new Error('No upload URL received from server');
        }

        // Upload file directly to storage using PUT
        const uploadResponse = await fetch(uploadURL, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.statusText}`);
        }

        // Process the uploaded file on server
        const cleanURL = uploadURL.split('?')[0]; // Remove query parameters
        console.log('Clean URL for processing:', cleanURL);
        console.log('Sending to process endpoint:', { [`${type}URL`]: cleanURL });
        
        const processResponse = await fetch(`/api/${type}s/process`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            [`${type}URL`]: cleanURL
          }),
        });
        
        if (!processResponse.ok) {
          const errorText = await processResponse.text();
          throw new Error(`Process failed: ${processResponse.status}: ${errorText}`);
        }
        
        const processResult = await processResponse.json();
        console.log('Process result:', processResult);
        const { objectPath } = processResult;

        uploadedUrls.push(objectPath);
      }

      onComplete?.(uploadedUrls);
      setSelectedFiles([]);
    } catch (error) {
      console.error('Upload error:', error);
      console.error('Error details:', error instanceof Error ? error.message : 'Unknown error');
      alert(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Button 
          type="button"
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
          <Button type="button" onClick={uploadFiles} disabled={isUploading}>
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