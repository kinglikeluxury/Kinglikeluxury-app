import { useEffect, useRef, useState } from "react";

interface SplashScreenProps {
  onComplete: () => void;
}

function playLuxuryChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

    const playTone = (freq: number, startTime: number, duration: number, gain: number) => {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, startTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.98, startTime + duration);

      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(gain, startTime + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const t = ctx.currentTime;
    playTone(1047, t, 1.4, 0.06);
    playTone(1319, t + 0.18, 1.2, 0.04);
    playTone(1568, t + 0.35, 1.0, 0.03);
    playTone(2093, t + 0.50, 0.9, 0.02);
  } catch (_) {}
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");
  const soundPlayed = useRef(false);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 900);
    const t2 = setTimeout(() => setPhase("out"), 2600);
    const t3 = setTimeout(() => onComplete(), 3400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete]);

  useEffect(() => {
    if (!soundPlayed.current) {
      soundPlayed.current = true;
      const unlockAndPlay = () => {
        playLuxuryChime();
        document.removeEventListener("touchstart", unlockAndPlay);
        document.removeEventListener("click", unlockAndPlay);
      };
      setTimeout(() => {
        try {
          playLuxuryChime();
        } catch (_) {
          document.addEventListener("touchstart", unlockAndPlay, { once: true });
          document.addEventListener("click", unlockAndPlay, { once: true });
        }
      }, 100);
    }
  }, []);

  return (
    <>
      <style>{`
        @keyframes kl-fade-in {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes kl-glow-pulse {
          0%   { filter: drop-shadow(0 0 0px rgba(59,202,196,0)); }
          40%  { filter: drop-shadow(0 0 18px rgba(59,202,196,0.55)); }
          100% { filter: drop-shadow(0 0 8px rgba(59,202,196,0.2)); }
        }
        @keyframes kl-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes kl-text-in {
          from { opacity: 0; letter-spacing: 0.25em; }
          to   { opacity: 1; letter-spacing: 0.35em; }
        }
        @keyframes kl-sub-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes kl-dots {
          0%, 100% { opacity: 0.3; }
          50%       { opacity: 0.8; }
        }
        .kl-crown {
          animation: kl-fade-in 0.85s cubic-bezier(0.22,1,0.36,1) forwards;
          opacity: 0;
        }
        .kl-crown.hold {
          animation: kl-fade-in 0.85s cubic-bezier(0.22,1,0.36,1) forwards,
                     kl-glow-pulse 1.4s ease-in-out forwards;
        }
        .kl-brand-name {
          animation: kl-text-in 0.9s cubic-bezier(0.22,1,0.36,1) 0.4s forwards;
          opacity: 0;
        }
        .kl-brand-name.shimmer {
          background: linear-gradient(90deg, #005476 30%, #3bcac4 50%, #005476 70%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: kl-text-in 0.9s cubic-bezier(0.22,1,0.36,1) 0.4s forwards,
                     kl-shimmer 2.0s linear 1.0s 1;
        }
        .kl-subtitle {
          animation: kl-sub-in 0.7s ease-out 0.8s forwards;
          opacity: 0;
        }
        .kl-dot {
          animation: kl-dots 1.5s ease-in-out infinite;
        }
        .kl-dot:nth-child(2) { animation-delay: 0.5s; }
        .kl-dot:nth-child(3) { animation-delay: 1.0s; }
        .kl-divider {
          animation: kl-sub-in 0.7s ease-out 1.1s forwards;
          opacity: 0;
        }
        .kl-splash-wrap {
          transition: opacity 0.75s cubic-bezier(0.4,0,0.2,1);
        }
      `}</style>

      <div
        className="kl-splash-wrap fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-white"
        style={{ opacity: phase === "out" ? 0 : 1, pointerEvents: phase === "out" ? "none" : "auto" }}
      >
        {/* Crown logo */}
        <div className={`kl-crown${phase !== "in" ? " hold" : ""}`} style={{ width: "min(50vw, 180px)" }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%">
            <g transform="translate(10, 15) scale(0.8)">
              <path d="M10 65 L18 30 L35 50 L50 15 L65 50 L82 30 L90 65 Z" fill="#3bcac4" />
              <rect x="10" y="65" width="80" height="10" rx="3" fill="#3bcac4" />
              <rect x="47" y="10" width="6" height="6" rx="1" fill="#005476" transform="rotate(45 50 13)" />
              <rect x="31" y="44" width="6" height="6" rx="1" fill="#005476" transform="rotate(45 34 47)" />
              <rect x="63" y="44" width="6" height="6" rx="1" fill="#005476" transform="rotate(45 66 47)" />
            </g>
          </svg>
        </div>

        {/* KINGLIKE */}
        <h1
          className={`kl-brand-name${phase !== "in" ? " shimmer" : ""} mt-6 font-bold tracking-[0.35em] uppercase`}
          style={{
            fontSize: "clamp(22px, 6vw, 38px)",
            color: "#005476",
          }}
        >
          KINGLIKE
        </h1>

        {/* Divider */}
        <div className="kl-divider flex items-center gap-2 mt-2">
          <span className="kl-dot inline-block w-1 h-1 rounded-full bg-[#3bcac4]" />
          <span className="kl-dot inline-block w-1 h-1 rounded-full bg-[#3bcac4]" />
          <span className="kl-dot inline-block w-1 h-1 rounded-full bg-[#3bcac4]" />
        </div>

        {/* LUXURY subtitle */}
        <p
          className="kl-subtitle mt-2 tracking-[0.55em] uppercase font-light"
          style={{
            fontSize: "clamp(10px, 2.5vw, 14px)",
            color: "#005476",
            opacity: 0,
          }}
        >
          LUXURY
        </p>
      </div>
    </>
  );
}
