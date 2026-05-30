import { useEffect, useRef, useState, useCallback } from "react";
import Hls from "hls.js";
import { Camera, Maximize2, RefreshCw, WifiOff } from "lucide-react";

interface HlsVideoPlayerProps {
  url: string;
  label?: string;
  onFullscreen?: () => void;
}

const MAX_AUTO_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

export function HlsVideoPlayer({ url, label, onFullscreen }: HlsVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);

  const [status, setStatus] = useState<"loading" | "playing" | "error">("loading");

  const cleanup = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  const initPlayer = useCallback((streamUrl: string) => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    cleanup();
    setStatus("loading");

    const isHls = streamUrl.includes(".m3u8");

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingTimeOut: 10000,
        manifestLoadingMaxRetry: 4,
        levelLoadingTimeOut: 10000,
        fragLoadingTimeOut: 20000,
      });

      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        retryCountRef.current = 0;
        video.play().catch(() => {});
        setStatus("playing");
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return;
        if (retryCountRef.current < MAX_AUTO_RETRIES) {
          retryCountRef.current += 1;
          retryTimerRef.current = setTimeout(() => initPlayer(streamUrl), RETRY_DELAY_MS);
        } else {
          setStatus("error");
        }
      });
    } else if (isHls && video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
      video.addEventListener("loadedmetadata", () => {
        retryCountRef.current = 0;
        video.play().catch(() => {});
        setStatus("playing");
      }, { once: true });
      video.addEventListener("error", () => {
        if (retryCountRef.current < MAX_AUTO_RETRIES) {
          retryCountRef.current += 1;
          retryTimerRef.current = setTimeout(() => initPlayer(streamUrl), RETRY_DELAY_MS);
        } else {
          setStatus("error");
        }
      }, { once: true });
    } else if (!isHls) {
      video.src = streamUrl;
      video.play().catch(() => {});
      setStatus("playing");
    } else {
      setStatus("error");
    }
  }, [cleanup]);

  useEffect(() => {
    retryCountRef.current = 0;
    initPlayer(url);
    return cleanup;
  }, [url, initPlayer, cleanup]);

  const handleManualRetry = () => {
    retryCountRef.current = 0;
    initPlayer(url);
  };

  const handleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (onFullscreen) {
      onFullscreen();
      return;
    }
    if (video.requestFullscreen) video.requestFullscreen();
    else if ((video as any).webkitEnterFullscreen) (video as any).webkitEnterFullscreen();
  };

  return (
    <div className="relative rounded-2xl overflow-hidden bg-black shadow-2xl group w-full aspect-video">
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[10px] font-bold uppercase tracking-wider bg-red-500">
          <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-ping" />
          LIVE
        </span>
        <button
          onClick={handleFullscreen}
          className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors opacity-0 group-hover:opacity-100"
          aria-label="Fullscreen"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {label && (
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-4 py-3 pointer-events-none">
          <p className="text-white font-semibold text-sm">{label}</p>
        </div>
      )}

      {status === "loading" && (
        <div className="absolute inset-0 z-20 bg-gray-900 flex flex-col items-center justify-center gap-3">
          <div className="w-10 h-10 rounded-full border-4 border-[#3bcac4]/30 border-t-[#3bcac4] animate-spin" />
          <p className="text-sm text-gray-400">Connecting to live stream…</p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 z-20 bg-gray-900 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <WifiOff className="w-12 h-12 text-gray-500" />
          <div>
            <p className="text-sm font-semibold text-gray-300 mb-1">Camera temporarily unavailable</p>
            <p className="text-xs text-gray-500">Please try again in a moment.</p>
          </div>
          <button
            onClick={handleManualRetry}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#3bcac4] text-[#3bcac4] text-sm hover:bg-[#3bcac4] hover:text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-500 underline underline-offset-2"
            >
              Open stream directly
            </a>
          )}
        </div>
      )}

      <video
        ref={videoRef}
        className="w-full h-full object-cover"
        autoPlay
        muted
        playsInline
        controls={status === "playing"}
        style={{ display: status === "error" ? "none" : "block" }}
      />
    </div>
  );
}
