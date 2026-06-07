interface LogoProps {
  size?: number;
}

// The Observ.ing mark: a leaf that doubles as an eye — "observing" nature.
// Flat single-color treatment (the brand-exploration recommendation): cleaner
// at small sizes and more versatile than the old two-tone version. The leaf and
// pupil use `currentColor`, so the mark inherits the accent green from its
// parent — forest green in light mode, the brighter accent in dark mode.
export function Logo({ size = 32 }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="40 40 120 120"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <g transform="translate(100,100) rotate(-45)">
        <path d="M-60,0 Q0,-70 60,0 Q0,70 -60,0Z" fill="currentColor" />
        <circle cx="0" cy="0" r="18" fill="#ffffff" />
        <circle cx="0" cy="0" r="9" fill="currentColor" />
        <circle cx="3.5" cy="-3.5" r="2.5" fill="#ffffff" opacity="0.65" />
      </g>
    </svg>
  );
}
