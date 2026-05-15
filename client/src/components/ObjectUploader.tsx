import { useState, useRef } from "react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { uploadToCloudinary } from "@/lib/cloudinaryUpload";

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
  type = "photo",
}: ObjectUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const resourceType =
    type === "video" ? "video" : type === "audio" ? "video" : "image";

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).slice(0, maxNumberOfFiles);
      uploadFiles(files);
    }
  };

  const uploadFiles = async (files: File[]) => {
    setIsUploading(true);
    setProgress(0);
    const uploadedUrls: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];

        const result = await uploadToCloudinary(
          file,
          resourceType as "image" | "video" | "auto",
          (pct) => {
            const overall = Math.round(((i + pct / 100) / files.length) * 100);
            setProgress(overall);
          }
        );

        uploadedUrls.push(result.secure_url);
        setProgress(Math.round(((i + 1) / files.length) * 100));
      }

      onComplete?.(uploadedUrls);
      if (inputRef.current) inputRef.current.value = "";
    } catch (error) {
      console.error("Upload error:", error);
      alert(`Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsUploading(false);
      setProgress(0);
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
