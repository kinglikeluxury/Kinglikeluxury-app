import path from 'path';
import fs from 'fs';
import { cloudinary } from '../cloudinaryService';

let canvasModule: any = null;
try {
  canvasModule = require('canvas');
} catch (_e) {
  console.warn('[imageProcessing] canvas native module not available — Cloudinary URL transformation will handle watermarking for cloud-hosted images');
}

const LOGO_PATH = path.join(process.cwd(), 'server', 'assets', 'watermark-logo.png');
const WATERMARK_PUBLIC_ID = 'kinglike/watermark_overlay';
const CLOUDINARY_OVERLAY_TAG = 'l_kinglike:watermark_overlay';
const UNSIGNED_PRESET = 'kinglike_unsigned';

let cachedLogo: any = null;
let watermarkOverlayReady = false;

async function initWatermarkOverlay(): Promise<void> {
  try {
    if (!fs.existsSync(LOGO_PATH)) {
      console.warn('[imageProcessing] Watermark logo not found at', LOGO_PATH, '— overlay disabled');
      return;
    }

    const uploadPromise = cloudinary.uploader.unsigned_upload(
      LOGO_PATH,
      UNSIGNED_PRESET,
      {
        public_id: 'watermark_overlay',
        folder: 'kinglike',
      }
    );

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Cloudinary upload timed out after 15s')), 15000)
    );

    const result: any = await Promise.race([uploadPromise, timeoutPromise]);

    if (result && result.secure_url) {
      watermarkOverlayReady = true;
      console.log('[imageProcessing] Watermark overlay ready in Cloudinary — id:', result.public_id);
    } else {
      console.warn('[imageProcessing] Watermark overlay upload returned unexpected result — overlay disabled');
    }
  } catch (e: any) {
    const msg: string = e?.message || JSON.stringify(e);
    if (msg.includes('already exists') || msg.includes('already_exists')) {
      watermarkOverlayReady = true;
      console.log('[imageProcessing] Watermark overlay already in Cloudinary — ready');
    } else {
      console.error('[imageProcessing] Watermark overlay init failed — Cloudinary URL transformation disabled:', msg);
    }
  }
}

initWatermarkOverlay().catch(() => {});

function applyCloudinaryWatermark(imageUrl: string): string {
  if (!imageUrl.includes('res.cloudinary.com')) return imageUrl;
  if (!imageUrl.includes('/image/upload/')) return imageUrl;
  if (imageUrl.includes(CLOUDINARY_OVERLAY_TAG)) return imageUrl;
  return imageUrl.replace(
    '/image/upload/',
    `/image/upload/${CLOUDINARY_OVERLAY_TAG},o_35,w_0.25,g_center,fl_relative/`
  );
}

async function getWatermarkLogo() {
  if (cachedLogo) return cachedLogo;
  if (!canvasModule) return null;
  try {
    if (fs.existsSync(LOGO_PATH)) {
      cachedLogo = await canvasModule.loadImage(LOGO_PATH);
      return cachedLogo;
    }
  } catch (err) {
    console.error('Failed to load watermark logo:', err);
  }
  return null;
}

export async function addWatermark(imageDataUrl: string): Promise<string> {
  if (
    imageDataUrl.startsWith('https://res.cloudinary.com') ||
    imageDataUrl.startsWith('http://res.cloudinary.com')
  ) {
    if (watermarkOverlayReady) {
      return applyCloudinaryWatermark(imageDataUrl);
    }
    return imageDataUrl;
  }

  if (!canvasModule) return imageDataUrl;
  try {
    if (!imageDataUrl.startsWith('data:')) {
      return imageDataUrl;
    }

    const base64Data = imageDataUrl.split(',')[1];
    if (!base64Data) return imageDataUrl;

    const { createCanvas, loadImage } = canvasModule;
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const image = await loadImage(imageBuffer);
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');

    ctx.drawImage(image, 0, 0);

    const logo = await getWatermarkLogo();

    if (logo) {
      const logoScale = 0.25;
      const logoWidth = image.width * logoScale;
      const logoHeight = (logo.height / logo.width) * logoWidth;
      const logoX = (image.width - logoWidth) / 2;
      const logoY = (image.height - logoHeight) / 2;

      ctx.globalAlpha = 0.35;
      ctx.drawImage(logo, logoX, logoY, logoWidth, logoHeight);
      ctx.globalAlpha = 1.0;
    } else {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = `bold ${Math.max(24, image.width / 20)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.lineWidth = 2;
      const text = 'KINGLIKE LUXURY';
      ctx.strokeText(text, image.width / 2, image.height / 2);
      ctx.fillText(text, image.width / 2, image.height / 2);
    }

    const mimeType = imageDataUrl.split(';')[0].split(':')[1] || 'image/jpeg';
    if (mimeType === 'image/png') {
      return canvas.toDataURL('image/png');
    }
    return canvas.toDataURL('image/jpeg');
  } catch (error) {
    console.error('Error adding watermark to image:', error);
    return imageDataUrl;
  }
}

export async function processImages(imageUrls: string[]): Promise<string[]> {
  if (!imageUrls || imageUrls.length === 0) return imageUrls;

  try {
    const results: string[] = [];
    for (const url of imageUrls) {
      const watermarked = await addWatermark(url);
      results.push(watermarked);
    }
    return results;
  } catch (error) {
    console.error('Error processing images:', error);
    return imageUrls;
  }
}
