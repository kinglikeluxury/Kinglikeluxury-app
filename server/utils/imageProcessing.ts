import { createCanvas, loadImage } from 'canvas';
import path from 'path';
import fs from 'fs';

const LOGO_PATH = path.join(process.cwd(), 'server', 'assets', 'watermark-logo.png');

let cachedLogo: any = null;

async function getWatermarkLogo() {
  if (cachedLogo) return cachedLogo;
  try {
    if (fs.existsSync(LOGO_PATH)) {
      cachedLogo = await loadImage(LOGO_PATH);
      return cachedLogo;
    }
  } catch (err) {
    console.error('Failed to load watermark logo:', err);
  }
  return null;
}

export async function addWatermark(imageDataUrl: string): Promise<string> {
  try {
    if (!imageDataUrl.startsWith('data:')) {
      return imageDataUrl;
    }

    const base64Data = imageDataUrl.split(',')[1];
    if (!base64Data) return imageDataUrl;

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
