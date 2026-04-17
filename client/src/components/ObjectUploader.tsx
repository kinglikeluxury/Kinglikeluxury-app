import { useState, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface ObjectUploaderProps {
  maxNumberOfFiles?: number;
  maxFileSize?: number;
  allowedFileTypes?: string[];
  onComplete?: (fileUrls: string[]) => void;
  buttonClassName?: string;
  children: ReactNode;
  type?: "photo" | "video" | "audio";
}

export function ObjectUploader({
  maxNumberOfFiles = 10,
  maxFileSize = Infinity,
  allowedFileTypes = [],
  onComplete,
  buttonClassName,
  children,
  type = "photo"
}: ObjectUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).slice(0, maxNumberOfFiles);
      setSelectedFiles(files);
      setProgress(0);
      // Auto-upload when files are selected
      if (files.length > 0) {
        uploadFilesDirectly(files);
      }
    }
  };

  const uploadFilesDirectly = async (files: File[]) => {
    setIsUploading(true);
    setProgress(0);
    const uploadedUrls: string[] = [];

    try {
      const endpoint =
        type === "photo"
          ? "/api/photos/upload"
          : type === "video"
          ? "/api/videos/upload"
          : "/api/audios/upload";

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(endpoint, {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err?.error || `Upload failed: ${response.statusText}`);
        }

        const result = await response.json();
        uploadedUrls.push(result.url);
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }

      onComplete?.(uploadedUrls);
      setSelectedFiles([]);
      setProgress(0);
      // Reset the file input
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      console.error("Upload error:", error);
      alert(`Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={buttonClassName}
          disabled={isUploading}
        >
          {isUploading ? "جارٍ الرفع..." : children}
        </Button>

        <input
          ref={inputRef}
          type="file"
          multiple={maxNumberOfFiles > 1}
          accept={allowedFileTypes.join(",")}
          onChange={handleFileSelect}
          style={{ display: "none" }}
        />
      </div>

      {isUploading && (
        <div className="space-y-1">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-gray-500">جارٍ الرفع على Cloudinary... {progress}%</p>
        </div>
      )}
    </div>
  );
}
