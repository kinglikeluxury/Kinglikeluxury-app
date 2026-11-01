import { HlsVideoPlayer } from "@/components/property/HlsVideoPlayer";

interface CameraStreamRendererProps {
  url: string;
  label?: string;
}

const EMBED_PATHS: Record<string, RegExp> = {
  "rtsp.run": /^\/embed\.html\/?$/i,
  "rtsp.me": /^\/embed\/[^/]+\/?$/i,
};

function getProviderHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host in EMBED_PATHS ? host : null;
  } catch {
    return null;
  }
}

/**
 * Only accept the provider's HTTPS viewer embeds. Query strings and fragments
 * are intentionally preserved because rtsp.run embeds may require them.
 */
export function isSupportedCameraEmbedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const pathPattern = EMBED_PATHS[host];

    return (
      parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !!pathPattern?.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

function isHlsStream(url: string): boolean {
  return /\.m3u8(?:$|[?#])/i.test(url);
}

/**
 * Provider embed pages are iframes; existing HLS/direct-video links continue
 * through the established player and keep its retry/fullscreen behavior.
 */
export function CameraStreamRenderer({ url, label }: CameraStreamRendererProps) {
  if (isSupportedCameraEmbedUrl(url)) {
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

  // Do not reinterpret malformed or insecure provider links as video URLs.
  if (getProviderHost(url) !== null && !isHlsStream(url)) return null;

  if (url.length > 0) {
    return <HlsVideoPlayer url={url} label={label} />;
  }

  return null;
}
