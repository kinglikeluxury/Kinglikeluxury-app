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

// ─── Image compression via Canvas ────────────────────────────────────────────
// Max dimensions for uploaded images (width or height, whichever is larger).
// Quality is JPEG compression quality (0–1).
const IMAGE_MAX_DIMENSION = 2048;
const IMAGE_QUALITY = 0.82;

/**
 * Compress an image File using the browser Canvas API before uploading.
 * – Resizes so the longest side ≤ IMAGE_MAX_DIMENSION
 * – Re-encodes as JPEG at IMAGE_QUALITY
 * – Returns the original file unchanged if it is already small or is not an image
 */
async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Only resize if the image exceeds the max dimension
      if (width <= IMAGE_MAX_DIMENSION && height <= IMAGE_MAX_DIMENSION) {
        // Still re-encode to reduce quality / strip metadata
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              resolve(file); // compressed is larger — keep original
            } else {
              resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
            }
          },
          "image/jpeg",
          IMAGE_QUALITY
        );
        return;
      }

      // Resize proportionally
      if (width > height) {
        height = Math.round((height / width) * IMAGE_MAX_DIMENSION);
        width = IMAGE_MAX_DIMENSION;
      } else {
        width = Math.round((width / height) * IMAGE_MAX_DIMENSION);
        height = IMAGE_MAX_DIMENSION;
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file);
          } else {
            resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
          }
        },
        "image/jpeg",
        IMAGE_QUALITY
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // fallback — upload original
    };

    img.src = objectUrl;
  });
}

// ─── Upload ───────────────────────────────────────────────────────────────────

/**
 * Upload a file directly to Cloudinary using an unsigned preset.
 * Images are automatically compressed/resized client-side before upload.
 * Videos are sent as-is (Cloudinary handles transcoding server-side via the preset).
 */
export async function uploadToCloudinary(
  file: File,
  resourceType: CloudinaryResourceType = "auto",
  onProgress?: (pct: number) => void
): Promise<CloudinaryUploadResult> {
  // Compress images before upload
  const fileToUpload =
    resourceType === "image" || (resourceType === "auto" && file.type.startsWith("image/"))
      ? await compressImage(file)
      : file;

  const effectiveType: CloudinaryResourceType =
    resourceType === "auto"
      ? file.type.startsWith("video/")
        ? "video"
        : "image"
      : resourceType;

  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${effectiveType}/upload`;

  const formData = new FormData();
  formData.append("file", fileToUpload);
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

    (xhr as any)._abort = () => xhr.abort();
  });
}
