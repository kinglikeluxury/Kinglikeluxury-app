import { HlsVideoPlayer } from "@/components/property/HlsVideoPlayer";

interface CameraStreamRendererProps {
  url: string;
  label?: string;
}

function isEmbedPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+$/, "");

    return (
      (hostname === "rtsp.run" && pathname === "/embed.html") ||
      (hostname === "rtsp.me" && /^\/embed\/[^/]+$/i.test(pathname))
    );
  } catch {
    return false;
  }
}

function isHlsStream(url: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url);
}

/**
 * Routes each camera URL to the element it actually represents.
 * Embed pages must be iframes; HLS and direct video URLs use the existing
 * video player, which keeps its retry and fullscreen behavior.
 */
export function CameraStreamRenderer({ url, label }: CameraStreamRendererProps) {
  if (isEmbedPage(url)) {
    return (
      <div className="relative w-full aspect-video overflow-hidden rounded-2xl bg-black shadow-2xl">
        <iframe
          src={url}
          title={label || "Live camera"}
          allow="autoplay; fullscreen"
          allowFullScreen
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full border-0"
        />
      </div>
    );
  }

  // HlsVideoPlayer selects hls.js for .m3u8 and uses a normal <video>
  // element for direct supported video URLs.
  if (isHlsStream(url) || url.length > 0) {
    return <HlsVideoPlayer url={url} label={label} />;
  }

  return null;
}