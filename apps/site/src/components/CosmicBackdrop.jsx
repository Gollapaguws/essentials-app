/**
 * The front-page stage: a ringed orb in deep space, built from gradients and SVG
 * rather than a photograph.
 *
 * It is drawn in the DOM on purpose — the artwork scales with the viewport, keeps
 * its glow on dark screens, weighs nothing, and the type sits in real text on top
 * of it instead of being baked into an image.
 */
export default function CosmicBackdrop() {
  return (
    <div className="sonus-space" aria-hidden="true">
      <div className="sonus-nebula" />
      <div className="sonus-stars" />

      <div className="sonus-orb">
        <div className="sonus-core" />
        <svg viewBox="0 0 600 600" role="presentation" focusable="false">
          <defs>
            <linearGradient id="ring-ice" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#eaf8ff" stopOpacity="0.9" />
              <stop offset="45%" stopColor="#8fd4ff" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#5a7dff" stopOpacity="0.05" />
            </linearGradient>
            <linearGradient id="ring-violet" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#b48cff" stopOpacity="0" />
              <stop offset="55%" stopColor="#c9a6ff" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#eaf8ff" stopOpacity="0.75" />
            </linearGradient>
            <radialGradient id="orb-fill" cx="50%" cy="42%" r="58%">
              <stop offset="0%" stopColor="#eaf8ff" stopOpacity="0.55" />
              <stop offset="38%" stopColor="#7fb6ff" stopOpacity="0.16" />
              <stop offset="72%" stopColor="#131a3a" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#05070f" stopOpacity="1" />
            </radialGradient>
          </defs>

          {/* The sphere itself, lit from the upper left, with a lit rim. */}
          <circle cx="300" cy="300" r="196" fill="url(#orb-fill)" />
          <circle cx="300" cy="300" r="196" fill="none" stroke="rgba(224, 244, 255, 0.38)" strokeWidth="1.1" />

          {/* Orbital rings: tilted, unequal, brightest where they cross the light. */}
          <g className="sonus-rings">
            <ellipse cx="300" cy="300" rx="286" ry="104" transform="rotate(-16 300 300)" fill="none" stroke="url(#ring-ice)" strokeWidth="1.4" />
            <ellipse cx="300" cy="300" rx="248" ry="168" transform="rotate(24 300 300)" fill="none" stroke="url(#ring-violet)" strokeWidth="1" />
            <ellipse cx="300" cy="300" rx="214" ry="214" fill="none" stroke="rgba(207,227,255,0.14)" strokeWidth="1" />
          </g>

          {/* Filaments sweeping through the orb. */}
          <g className="sonus-filaments" fill="none" stroke="#dff2ff" strokeOpacity="0.5" strokeWidth="0.9">
            <path d="M120 268c64-52 168-78 250-52s110 92 66 138" />
            <path d="M150 372c58 44 158 58 226 20s64-104 18-136" />
            <path d="M232 148c88-16 176 26 200 92" />
          </g>
        </svg>
      </div>

      {/* The column of light through the centre. */}
      <div className="sonus-beam" />
    </div>
  );
}
