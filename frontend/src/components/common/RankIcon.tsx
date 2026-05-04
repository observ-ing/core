import * as React from "react";

interface RankIconProps {
  rank: string | undefined;
  size?: number;
  title?: string;
  /** Optional override; otherwise inherits currentColor from surrounding text. */
  color?: string;
}

const FILL = "currentColor";

const PENTAGON: ReadonlyArray<readonly [number, number]> = [
  [24, 12],
  [37.31, 21.67],
  [32.23, 37.33],
  [15.77, 37.33],
  [10.69, 21.67],
];
const SQUARE: ReadonlyArray<readonly [number, number]> = [
  [14, 14],
  [34, 14],
  [14, 34],
  [34, 34],
];
const TRIANGLE: ReadonlyArray<readonly [number, number]> = [
  [24, 12],
  [36.12, 33],
  [11.88, 33],
];

function filledDots(pts: ReadonlyArray<readonly [number, number]>, r: number) {
  return pts.map(([cx, cy], i) => <circle key={i} cx={cx} cy={cy} r={r} fill={FILL} />);
}
function hollowDots(pts: ReadonlyArray<readonly [number, number]>, r: number, sw: number) {
  return pts.map(([cx, cy], i) => (
    <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={FILL} strokeWidth={sw} />
  ));
}
function filledBars(ys: number[]) {
  return ys.map((y, i) => <rect key={i} x={8} y={y} width={32} height={4} fill={FILL} />);
}
function splitBars(ys: number[]) {
  return ys.flatMap((y, i) => [
    <rect key={`l${i}`} x={8} y={y} width={13} height={4} fill={FILL} />,
    <rect key={`r${i}`} x={27} y={y} width={13} height={4} fill={FILL} />,
  ]);
}

function glyphFor(rank: string): React.ReactNode | null {
  switch (rank) {
    case "domain":
      return filledBars([14, 22, 30]);
    case "subdomain":
      return splitBars([14, 22, 30]);
    case "kingdom":
      return filledBars([18, 26]);
    case "subkingdom":
      return splitBars([18, 26]);
    case "phylum":
    case "division":
      return filledBars([22]);
    case "subphylum":
    case "subdivision":
      return splitBars([22]);
    case "class":
      return filledDots(PENTAGON, 4);
    case "subclass":
      return hollowDots(PENTAGON, 4, 1.5);
    case "order":
      return filledDots(SQUARE, 4);
    case "suborder":
      return hollowDots(SQUARE, 4, 1.5);
    case "family":
      return filledDots(TRIANGLE, 4);
    case "subfamily":
      return hollowDots(TRIANGLE, 4, 1.5);
    case "genus":
      return [
        <circle key="l" cx={16} cy={24} r={5} fill={FILL} />,
        <circle key="r" cx={32} cy={24} r={5} fill={FILL} />,
      ];
    case "subgenus":
      return [
        <circle key="l" cx={16} cy={24} r={5} fill="none" stroke={FILL} strokeWidth={2} />,
        <circle key="r" cx={32} cy={24} r={5} fill="none" stroke={FILL} strokeWidth={2} />,
      ];
    case "species":
      return <circle cx={24} cy={24} r={6} fill={FILL} />;
    case "subspecies":
    case "variety":
    case "form":
    case "forma":
      return <circle cx={24} cy={24} r={6} fill="none" stroke={FILL} strokeWidth={2} />;
    default:
      return null;
  }
}

/**
 * A glyph for a Linnaean rank. Phylum and above use stacked bars; below phylum
 * uses 1–5 dots arranged on the implied polygon. Sub-ranks are the hollow or
 * gap-split version of the parent. Returns null for ranks without a glyph
 * (tribe, super-/infra- ranks, etc.).
 */
export function RankIcon({ rank, size = 16, title, color }: RankIconProps) {
  if (!rank) return null;
  const glyph = glyphFor(rank.trim().toLowerCase());
  if (!glyph) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{ flexShrink: 0, display: "inline-block", color }}
    >
      {title ? <title>{title}</title> : null}
      {glyph}
    </svg>
  );
}
