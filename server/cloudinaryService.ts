import { v2 as cloudinary } from "cloudinary";

/**
 * Cloudinary env vars may be stored in wrong slots.
 * Detect each value by its known pattern:
 *   - Cloud name: short (5-15 chars), all lowercase alphanumeric  e.g. "dmfy0mz7g"
 *   - API key:    10-20 pure digits                               e.g. "128179551742346"
 *   - API secret: everything else (long alphanumeric string)
 */
function resolveCloudinaryConfig() {
  const raw = [
    process.env.CLOUDINARY_CLOUD_NAME || "",
    process.env.CLOUDINARY_API_KEY    || "",
    process.env.CLOUDINARY_API_SECRET || "",
  ].filter(Boolean);

  const cloudName = raw.find(v => /^[a-z][a-z0-9]{4,14}$/.test(v))
    || process.env.CLOUDINARY_CLOUD_NAME || "";

  const apiKey = raw.find(v => /^\d{10,20}$/.test(v))
    || process.env.CLOUDINARY_API_KEY || "";

  const apiSecret = raw.find(v => v !== cloudName && v !== apiKey && v.length >= 10)
    || process.env.CLOUDINARY_API_SECRET || "";

  return { cloudName, apiKey, apiSecret };
}

const { cloudName, apiKey, apiSecret } = resolveCloudinaryConfig();

cloudinary.config({
  cloud_name: cloudName,
  api_key:    apiKey,
  api_secret: apiSecret,
  secure:     true,
});

console.log(`[Cloudinary] Configured → cloud: ${cloudName}, key: ${apiKey.substring(0, 6)}***`);

export interface CloudinaryUploadResult {
  url:          string;
  secureUrl:    string;
  publicId:     string;
  resourceType: string;
  format:       string;
  width?:       number;
  height?:      number;
  bytes:        number;
}

export async function uploadToCloudinary(
  buffer: Buffer,
  options: {
    folder?:         string;
    resourceType?:   "image" | "video" | "raw" | "auto";
    publicId?:       string;
    transformation?: object[];
  } = {}
): Promise<CloudinaryUploadResult> {
  const { folder = "kinglike", resourceType = "auto", publicId, transformation } = options;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary credentials missing. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET."
    );
  }

  return new Promise((resolve, reject) => {
    const uploadOptions: any = {
      folder,
      resource_type:   resourceType,
      use_filename:    false,
      unique_filename: true,
    };

    if (publicId)      uploadOptions.public_id    = publicId;
    if (transformation) uploadOptions.transformation = transformation;

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", JSON.stringify(error));
          reject(new Error(`Cloudinary: ${error.message || JSON.stringify(error)}`));
          return;
        }
        if (!result) {
          reject(new Error("Cloudinary: no result returned"));
          return;
        }
        resolve({
          url:          result.url,
          secureUrl:    result.secure_url,
          publicId:     result.public_id,
          resourceType: result.resource_type,
          format:       result.format,
          width:        result.width,
          height:       result.height,
          bytes:        result.bytes,
        });
      }
    );

    uploadStream.end(buffer);
  });
}

export async function deleteFromCloudinary(
  publicId:     string,
  resourceType: "image" | "video" | "raw" = "image"
) {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.error("Error deleting from Cloudinary:", error);
  }
}

export { cloudinary };
