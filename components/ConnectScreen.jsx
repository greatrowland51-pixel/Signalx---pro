import React, { useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";

export default function ConnectScreen({ theme: th, onConnect, connecting, error }) {
  const [token, setToken] = useState("");

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{ background: th.bg, backgroundImage: th.bgImage, color: th.text }}
    >
      <ThemeSignature th={th} />

      <div
        className="w-full max-w-sm relative z-10 p-8 space-y-7"
        style={{ background: th.panel, border: `1px solid ${th.panelBorder}` }}
      >
        <div className="space-y-3">
          <Wordmark th={th} />
          <p className={`text-xs tracking-wide ${th.bodyFont}`} style={{ color: th.textDim }}>
            {th.tagline}
          </p>
        </div>

        <div className="space-y-3">
          <label
            className={`text-[10px] uppercase tracking-[0.2em] block`}
            style={{ color: th.textFaint }}
          >
            Deriv API Token
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="pat_········································"
            className={`w-full px-4 py-3 text-sm outline-none ${th.cardRadius}`}
            style={{
              background: th.bg,
              border: `1px solid ${th.panelBorder}`,
              color: th.text,
            }}
            onKeyDown={(e) => e.key === "Enter" && token.trim() && onConnect(token.trim())}
          />

          {error && (
            <div className="flex items-start gap-2 text-xs" style={{ color: th.down }}>
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            onClick={() => token.trim() && onConnect(token.trim())}
            disabled={connecting || !token.trim()}
            className={`w-full py-3 text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-40 transition-opacity ${th.cardRadius}`}
            style={{ background: th.accent, color: th.accentText }}
          >
            {connecting ? "Connecting…" : "Connect"}
            {!connecting && <ArrowRight className="w-4 h-4" />}
          </button>

          <p className="text-[11px] leading-relaxed" style={{ color: th.textFaint }}>
            Generate a token in your Deriv account under Settings → API Token
            (Read, Trade, Trading information scopes). The token is held only
            in this browser session and is never sent anywhere but Deriv's
            own API.
          </p>
        </div>
      </div>
    </div>
  );
}

function Wordmark({ th }) {
  if (th.key === "terminal") {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px]" style={{ color: th.accent }}>
          [●REC]
        </span>
        <h1 className={`text-xl tracking-tight ${th.displayFont}`} style={{ color: th.accent }}>
          SIGNALX_PRO<span className="animate-pulse">_</span>
        </h1>
      </div>
    );
  }
  if (th.key === "dune") {
    return (
      <h1 className={`text-3xl tracking-tight ${th.displayFont}`} style={{ color: th.accent }}>
        SignalX <span style={{ color: th.text }}>Pro</span>
      </h1>
    );
  }
  return (
    <h1 className={`text-3xl ${th.displayFont}`} style={{ color: th.text }}>
      SignalX <span style={{ color: th.accent, fontStyle: "italic" }}>Pro</span>
    </h1>
  );
}

function ThemeSignature({ th }) {
  if (th.signature === "scanline") {
    return (
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
        <div
          className="absolute w-full h-24 scanline"
          style={{ background: `linear-gradient(180deg, transparent, ${th.accent}33, transparent)` }}
        />
      </div>
    );
  }
  if (th.signature === "hairline-gold") {
    return (
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-24"
          style={{ background: `linear-gradient(180deg, ${th.accent}, transparent)` }}
        />
      </div>
    );
  }
  return (
    <div
      className="absolute inset-0 pointer-events-none opacity-[0.04]"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
      }}
    />
  );
}
