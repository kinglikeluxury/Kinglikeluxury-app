export type WhatsappMediaKind = "image" | "video" | "audio" | "file";

export interface WhatsappMediaObject {
  key: string;
  kind: WhatsappMediaKind;
  contentType: string;
  sizeBytes: number;
}

export interface WhatsappMediaStorage {
  put(object: WhatsappMediaObject, content: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(key: string): Promise<void>;
}

/**
 * Phase 2A deliberately has no media provider. This implementation makes
 * accidental uploads, downloads, and credential use fail explicitly.
 */
export class DisabledWhatsappMediaStorage implements WhatsappMediaStorage {
  async put(): Promise<void> {
    throw new Error("WhatsApp media storage is disabled in Mock Mode");
  }

  async get(): Promise<Uint8Array | null> {
    throw new Error("WhatsApp media storage is disabled in Mock Mode");
  }

  async remove(): Promise<void> {
    throw new Error("WhatsApp media storage is disabled in Mock Mode");
  }
}

export const whatsappMediaStorage: WhatsappMediaStorage = new DisabledWhatsappMediaStorage();