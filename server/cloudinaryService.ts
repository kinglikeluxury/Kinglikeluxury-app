import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export interface CloudinaryUploadResult {
  url: string;
  secureUrl: string;
  publicId: string;
  resourceType: string;
  format: string;
  width?: number;
  height?: number;
  bytes: number;
}

export async function uploadToCloudinary(
  buffer: Buffer,
  options: {
    folder?: string;
    resourceType?: "image" | "video" | "raw" | "auto";
    publicId?: string;
    transformation?: object[];
  } = {}
): Promise<CloudinaryUploadResult> {
  const { folder = "kinglike", resourceType = "auto", publicId, transformation } = options;

  return new Promise((resolve, reject) => {
    const uploadOptions: any = {
      folder,
      resource_type: resourceType,
      use_filename: false,
      unique_filename: true,
    };

    if (publicId) uploadOptions.public_id = publicId;
    if (transformation) uploadOptions.transformation = transformation;

    const uploadStream = cloudinary.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        if (!result) {
          reject(new Error("Upload failed: no result returned"));
          return;
        }
        resolve({
          url: result.url,
          secureUrl: result.secure_url,
          publicId: result.public_id,
          resourceType: result.resource_type,
          format: result.format,
          width: result.width,
          height: result.height,
          bytes: result.bytes,
        });
      }
    );

    uploadStream.end(buffer);
  });
}

export async function deleteFromCloudinary(publicId: string, resourceType: "image" | "video" | "raw" = "image") {
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.error("Error deleting from Cloudinary:", error);
  }
}

export { cloudinary };
