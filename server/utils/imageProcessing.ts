import { createCanvas, loadImage } from 'canvas';

/**
 * Adds a watermark to an image
 * @param imageDataUrl Base64 encoded image data URL
 * @param watermarkText Text to use as watermark
 * @returns Promise that resolves to a base64 encoded data URL of the watermarked image
 */
export async function addWatermark(imageDataUrl: string, watermarkText: string = 'Kinglike Luxury'): Promise<string> {
  try {
    // Extract the base64 data from the data URL
    const base64Data = imageDataUrl.split(',')[1];
    if (!base64Data) {
      throw new Error('Invalid image data URL');
    }

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(base64Data, 'base64');
    
    // Load the image
    const image = await loadImage(imageBuffer);
    
    // Create canvas with the same dimensions as the image
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d');
    
    // Draw the original image on the canvas
    ctx.drawImage(image, 0, 0);
    
    // Configure watermark
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'; // Semi-transparent white
    ctx.font = `${Math.max(20, image.width / 25)}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Calculate diagonal position for the watermark
    const diagonalX = image.width / 2;
    const diagonalY = image.height / 2;
    
    // Add white text with a slight rotation for the watermark
    ctx.save();
    ctx.translate(diagonalX, diagonalY);
    ctx.rotate(-Math.PI / 8); // Rotate about -22.5 degrees
    ctx.fillText(watermarkText, 0, 0);
    ctx.restore();
    
    // Convert canvas to data URL
    const mimeType = imageDataUrl.split(';')[0].split(':')[1] || 'image/jpeg';
    // Return data URL with the appropriate mime type
    if (mimeType === 'image/png') {
      return canvas.toDataURL('image/png');
    } else {
      return canvas.toDataURL('image/jpeg');
    }
  } catch (error) {
    console.error('Error adding watermark to image:', error);
    return imageDataUrl; // Return original image if watermarking fails
  }
}

/**
 * Process an array of image URLs to add watermarks
 * @param imageUrls Array of image URLs to process
 * @returns Promise that resolves to an array of watermarked image URLs
 */
export async function processImages(imageUrls: string[]): Promise<string[]> {
  try {
    const watermarkPromises = imageUrls.map(url => addWatermark(url));
    return await Promise.all(watermarkPromises);
  } catch (error) {
    console.error('Error processing images:', error);
    return imageUrls; // Return original URLs if processing fails
  }
}