/**
 * A deterministic two-stop CSS gradient derived from an arbitrary string.
 *
 * Hashing the seed keeps each value's color stable across renders while giving
 * a set of seeds a varied, recognizable palette — useful as an image-less
 * avatar/placeholder fill (taxa rows, user avatars, etc.). Earthy mid-tones
 * (moderate saturation/lightness) keep it in the field-guide palette rather
 * than looking neon.
 */
export function gradientFromString(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 42% 50%), hsl(${(hue + 26) % 360} 46% 30%))`;
}
