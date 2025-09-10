import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

export interface CompressionProgress {
  phase: 'loading' | 'compressing' | 'complete' | 'error';
  progress: number;
  message: string;
}

export class VideoCompressor {
  private ffmpeg: FFmpeg | null = null;
  private isLoaded = false;

  async initialize(onProgress?: (progress: CompressionProgress) => void): Promise<void> {
    if (this.isLoaded) return;

    onProgress?.({
      phase: 'loading',
      progress: 0,
      message: 'Initializing video compression engine...'
    });

    try {
      this.ffmpeg = new FFmpeg();
      
      // Load FFmpeg WebAssembly files from local node_modules (safer than CDN)
      await this.ffmpeg.load();

      this.isLoaded = true;
      
      onProgress?.({
        phase: 'loading',
        progress: 100,
        message: 'Compression engine ready!'
      });
    } catch (error) {
      console.error('Failed to initialize FFmpeg:', error);
      onProgress?.({
        phase: 'error',
        progress: 0,
        message: 'Failed to initialize compression engine'
      });
      throw error;
    }
  }

  async compressVideo(
    file: File,
    onProgress?: (progress: CompressionProgress) => void
  ): Promise<File> {
    if (!this.isLoaded || !this.ffmpeg) {
      await this.initialize(onProgress);
    }

    if (!this.ffmpeg) {
      throw new Error('FFmpeg not initialized');
    }

    const inputFileName = 'input.mp4';
    const outputFileName = 'output.mp4';

    try {
      onProgress?.({
        phase: 'compressing',
        progress: 0,
        message: 'Preparing video for compression...'
      });

      // Write input file to FFmpeg file system
      await this.ffmpeg.writeFile(inputFileName, await fetchFile(file));

      onProgress?.({
        phase: 'compressing',
        progress: 25,
        message: 'Compressing to 1080p HD...'
      });

      // Set up progress monitoring
      const progressHandler = ({ progress }: { progress: number }) => {
        const percent = Math.round(progress * 100);
        onProgress?.({
          phase: 'compressing',
          progress: 25 + (percent * 0.7), // 25% to 95%
          message: `Compressing video: ${percent}%`
        });
      };
      
      this.ffmpeg.on('progress', progressHandler);

      let compressedFile: File;
      
      try {
        // Compression settings for 1080p HD with good quality
        await this.ffmpeg.exec([
          '-i', inputFileName,
          // Video settings
          '-vf', 'scale=-2:1080', // Scale to 1080p maintaining aspect ratio with even dimensions
          '-c:v', 'libx264', // H.264 codec
          '-crf', '23', // Good quality (18-28 range, lower = better quality)
          '-preset', 'medium', // Balance between speed and compression
          '-pix_fmt', 'yuv420p', // Ensure compatibility
          '-movflags', '+faststart', // Enable fast start for web
          // Audio settings
          '-c:a', 'aac', // AAC audio codec
          '-b:a', '128k', // Audio bitrate
          '-ac', '2', // Stereo audio
          // Output
          outputFileName
        ]);

        onProgress?.({
          phase: 'compressing',
          progress: 95,
          message: 'Finalizing compressed video...'
        });

        // Read the output file
        const data = await this.ffmpeg.readFile(outputFileName);
        const compressedBlob = new Blob([data], { type: 'video/mp4' });
        
        // Create a new File object with the original name but compressed content
        compressedFile = new File(
          [compressedBlob], 
          file.name.replace(/\.[^/.]+$/, '.mp4'), // Ensure .mp4 extension
          { type: 'video/mp4' }
        );
      } finally {
        // Always clean up listeners and temp files
        this.ffmpeg.off('progress', progressHandler);
        try {
          await this.ffmpeg.deleteFile(inputFileName);
          await this.ffmpeg.deleteFile(outputFileName);
        } catch (cleanupError) {
          console.warn('Cleanup failed:', cleanupError);
        }
      }

      onProgress?.({
        phase: 'complete',
        progress: 100,
        message: `Compression complete! Size reduced from ${this.formatFileSize(file.size)} to ${this.formatFileSize(compressedFile.size)}`
      });

      return compressedFile;
    } catch (error) {
      console.error('Video compression failed:', error);
      onProgress?.({
        phase: 'error',
        progress: 0,
        message: 'Video compression failed'
      });
      throw error;
    }
  }

  shouldCompress(file: File): boolean {
    // Compress if file is larger than 50MB or likely not optimized
    const isLargeFile = file.size > 50 * 1024 * 1024; // 50MB
    const isNotOptimalFormat = !file.type.includes('mp4');
    
    return isLargeFile || isNotOptimalFormat;
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// Singleton instance
export const videoCompressor = new VideoCompressor();