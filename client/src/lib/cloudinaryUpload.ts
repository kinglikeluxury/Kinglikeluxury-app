const CLOUD_NAME = "dmfy0mz7g";
const UPLOAD_PRESET = "kinglike_unsigned";

export type CloudinaryResourceType = "image" | "video" | "auto";

export interface CloudinaryUploadResult {
  secure_url: string;
  url: string;
  public_id: string;
  resource_type: string;
  format: string;
  bytes: number;
}

/**
 * Unsigned direct-to-Cloudinary upload (no API key / signature needed).
 * Uses the "kinglike_unsigned" upload preset configured in Cloudinary dashboard.
 */
export async function uploadToCloudinary(
  file: File,
  resourceType: CloudinaryResourceType = "auto",
  onProgress?: (pct: number) => void
): Promise<CloudinaryUploadResult> {
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`;

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", UPLOAD_PRESET);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Invalid response from Cloudinary"));
        }
      } else {
        let msg = `Cloudinary error ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.error?.message) msg = body.error.message;
        } catch {}
        reject(new Error(msg));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));

    xhr.open("POST", endpoint);
    xhr.send(formData);

    // Expose abort method so callers can cancel
    (xhr as any)._abort = () => xhr.abort();
  });
}
