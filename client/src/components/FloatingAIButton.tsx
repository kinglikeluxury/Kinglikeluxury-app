import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import crownIcon from "@assets/crown-icon.png";

// Hide on pages where a floating button would be distracting or redundant
const HIDE_PREFIX = [
  "/login",
  "/register",
  "/admin",
  "/payment",
  "/ai-advisor",
  "/forgot-password",
  "/change-password",
];

export default function FloatingAIButton() {
  const [location, navigate] = useLocation();
  const [shining, setShining] = useState(false);

  const hidden =
    HIDE_PREFIX.some((p) => location === p || location.startsWith(p)) ||
    location.includes("/edit");

  const visible = !hidden;

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setShining(true);
      setTimeout(() => setShining(false), 1150);
    }, 3000);
    return () => clearInterval(id);
  }, [visible]);

  if (!visible) return null;

  return (
    <>
      <style>{`
        @keyframes klShine {
          0%   { transform: translateX(-130%) skewX(-18deg); opacity: 0; }
          12%  { opacity: 0.9; }
          88%  { opacity: 0.9; }
          100% { transform: translateX(230%) skewX(-18deg); opacity: 0; }
        }
        @keyframes klGlow {
          0%, 100% { box-shadow: 0 4px 18px rgba(59,202,196,0.32), 0 2px 8px rgba(0,0,0,0.10); }
          50%       { box-shadow: 0 4px 28px rgba(59,202,196,0.62), 0 2px 12px rgba(0,0,0,0.14); }
        }
        .kl-shine { animation: klShine 1.15s ease-in-out forwards; }
        .kl-glow  { animation: klGlow  1.15s ease-in-out; }
      `}</style>

      <button
        onClick={() => navigate("/ai-advisor")}
        aria-label="AI Investment Advisor"
        className={`
          fixed z-40
          bottom-[84px] right-4
          md:bottom-8 md:right-8
          w-[60px] h-[60px]
          rounded-full bg-white
          flex items-center justify-center
          overflow-hidden select-none
          transition-transform duration-150 active:scale-90
          ${shining ? "kl-glow" : ""}
        `}
        style={{
          boxShadow: shining
            ? undefined
            : "0 4px 18px rgba(59,202,196,0.32), 0 2px 8px rgba(0,0,0,0.10)",
          border: "2.5px solid rgba(59,202,196,0.22)",
        }}
      >
        <img
          src={crownIcon}
          alt=""
          className="w-[38px] h-[38px] object-contain pointer-events-none"
          draggable={false}
        />

        {shining && (
          <span
            className="kl-shine absolute inset-0 pointer-events-none rounded-full"
            style={{
              background:
                "linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.72) 50%, transparent 70%)",
            }}
          />
        )}
      </button>
    </>
  );
}
