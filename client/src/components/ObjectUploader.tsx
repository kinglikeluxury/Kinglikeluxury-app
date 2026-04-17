import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files).slice(0, maxNumberOfFiles);
      setSelectedFiles(files);
      setProgress(0);
    }
  };

  const uploadFiles = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setProgress(0);
    const uploadedUrls: string[] = [];

    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const formData = new FormData();
        formData.append("file", file);

        const endpoint = type === "photo"
          ? "/api/photos/upload"
          : type === "video"
          ? "/api/videos/upload"
          : "/api/audios/upload";

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
        setProgress(Math.round(((i + 1) / selectedFiles.length) * 100));
      }

      onComplete?.(uploadedUrls);
      setSelectedFiles([]);
      setProgress(0);
    } catch (error) {
      console.error("Upload error:", error);
      alert(`Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsUploading(false);
    }
  };

  const inputId = `file-input-${type}-${Math.random().toString(36).substr(2, 5)}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={() => document.getElementById(inputId)?.click()}
          className={buttonClassName}
          disabled={isUploading}
        >
          {children}
        </Button>

        <Input
          id={inputId}
          type="file"
          multiple={maxNumberOfFiles > 1}
          accept={allowedFileTypes.join(",")}
          onChange={handleFileSelect}
          className="hidden"
        />

        {selectedFiles.length > 0 && !isUploading && (
          <Button type="button" onClick={uploadFiles} variant="default">
            رفع {selectedFiles.length} ملف
          </Button>
        )}
      </div>

      {selectedFiles.length > 0 && (
        <div className="text-sm text-gray-500">
          المحدد: {selectedFiles.map((f) => f.name).join(", ")}
        </div>
      )}

      {isUploading && (
        <div className="space-y-1">
          <Progress value={progress} className="h-2" />
          <p className="text-xs text-gray-500">جارٍ الرفع... {progress}%</p>
        </div>
      )}
    </div>
  );
}
