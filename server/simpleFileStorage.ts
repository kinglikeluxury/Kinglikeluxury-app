import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";

export class SimpleFileStorage {
  private uploadDir = path.join(process.cwd(), "uploads");

  constructor() {
    this.ensureUploadDirs();
  }

  private async ensureUploadDirs() {
    try {
      await fs.mkdir(path.join(this.uploadDir, "photos"), { recursive: true });
      await fs.mkdir(path.join(this.uploadDir, "videos"), { recursive: true });
      await fs.mkdir(path.join(this.uploadDir, "audio"), { recursive: true });
    } catch (error) {
      console.error("Error creating upload directories:", error);
    }
  }

  generateUploadUrl(fileType: "photo" | "video" | "audio"): { uploadUrl: string; fileId: string } {
    const fileId = randomUUID();
    const uploadUrl = `/api/files/upload/${fileType}/${fileId}`;
    return { uploadUrl, fileId };
  }

  getFilePath(fileType: "photo" | "video" | "audio", fileId: string, extension: string): string {
    const dir = fileType === "photo" ? "photos" : fileType === "video" ? "videos" : "audio";
    return path.join(this.uploadDir, dir, `${fileId}${extension}`);
  }

  getPublicUrl(fileType: "photo" | "video" | "audio", fileId: string, extension: string): string {
    const dir = fileType === "photo" ? "photos" : fileType === "video" ? "videos" : "audio";
    return `/uploads/${dir}/${fileId}${extension}`;
  }

  async saveFile(fileType: "photo" | "video" | "audio", fileId: string, buffer: Buffer, originalName: string): Promise<string> {
    const extension = path.extname(originalName);
    const filePath = this.getFilePath(fileType, fileId, extension);
    
    await fs.writeFile(filePath, buffer);
    return this.getPublicUrl(fileType, fileId, extension);
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(process.cwd(), filePath));
      return true;
    } catch {
      return false;
    }
  }
}

export const fileStorage = new SimpleFileStorage();