import { useEffect, useRef, useState } from "react";

interface SplashScreenProps {
  onComplete: () => void;
}

function playLuxuryCinematic() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const totalDuration = 8;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.38, ctx.currentTime + 2.2);
    master.gain.setValueAtTime(0.38, ctx.currentTime + totalDuration - 1.8);
    master.gain.linearRampToValueAtTime(0, ctx.currentTime + totalDuration);
    master.connect(ctx.destination);

    const t = ctx.currentTime;

    const pad = (
      freq: number,
      type: OscillatorType,
      gain: number,
      start = 0,
      dur = totalDuration,
      detune = 0
    ) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.detune.value = detune;
      g.gain.setValueAtTime(0, t + start);
      g.gain.linearRampToValueAtTime(gain, t + start + 2.0);
      g.gain.setValueAtTime(gain, t + start + dur - 1.2);
      g.gain.linearRampToValueAtTime(0, t + start + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t + start);
      osc.stop(t + start + dur + 0.1);
    };

    // Deep bass pad — Cmaj7 chord (C2, E2, G2, B2)
    pad(65.41,  "sine",     0.18);
    pad(82.41,  "sine",     0.12);
    pad(98.0,   "sine",     0.09);
    pad(123.47, "sine",     0.07);

    // Warm mid-range strings (triangle) — slight detune for richness
    pad(261.63, "triangle", 0.055);
    pad(329.63, "triangle", 0.042);
    pad(392.0,  "triangle", 0.035);
    pad(493.88, "triangle", 0.028);
    pad(261.63, "triangle", 0.030, 0, totalDuration, +8);
    pad(329.63, "triangle", 0.022, 0, totalDuration, +8);
    pad(392.0,  "triangle", 0.018, 0, totalDuration, -6);

    // Luxury sparkle bells cascading in
    const bells: [number, number, number][] = [
      [523.25,  0.0, 0.028],
      [783.99,  0.7, 0.020],
      [1046.5,  1.4, 0.014],
      [1318.51, 2.1, 0.010],
      [1568.0,  2.7, 0.007],
    ];
    bells.forEach(([freq, offset, gain]) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t + offset);
      g.gain.linearRampToValueAtTime(gain, t + offset + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + offset + 3.5);
      osc.connect(g);
      g.connect(master);
      osc.start(t + offset);
      osc.stop(t + offset + 3.6);
    });

    // Subtle sub-bass rumble for cinematic depth
    const sub = ctx.createOscillator();
    const subG = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(32.7, t);
    sub.frequency.linearRampToValueAtTime(36.7, t + totalDuration);
    subG.gain.setValueAtTime(0, t);
    subG.gain.linearRampToValueAtTime(0.08, t + 1.5);
    subG.gain.setValueAtTime(0.08, t + totalDuration - 1.0);
    subG.gain.linearRampToValueAtTime(0, t + totalDuration);
    sub.connect(subG);
    subG.connect(master);
    sub.start(t);
    sub.stop(t + totalDuration + 0.1);

  } catch (_) {}
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fading, setFading] = useState(false);
  const doneRef = useRef(false);
  const audioStarted = useRef(false);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setFading(true);
    setTimeout(() => onComplete(), 650);
  };

  const startAudio = () => {
    if (!audioStarted.current) {
      audioStarted.current = true;
      playLuxuryCinematic();
    }
  };

  useEffect(() => {
    // Try to auto-play audio immediately (works on desktop; mobile needs interaction)
    const timer = setTimeout(() => {
      startAudio();
    }, 80);

    // Fallback — force complete after 10s if video fails
    const fallback = setTimeout(finish, 10000);

    return () => {
      clearTimeout(timer);
      clearTimeout(fallback);
    };
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        opacity: fading ? 0 : 1,
        transition: "opacity 0.65s ease-in-out",
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      <video
        ref={videoRef}
        src="/intro.mp4"
        autoPlay
        muted
        playsInline
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
        onPlay={startAudio}
        onEnded={finish}
        onError={finish}
      />
    </div>
  );
}
