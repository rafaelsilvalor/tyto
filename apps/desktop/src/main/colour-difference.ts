/**
 * How different two colours look, as CIEDE2000's ΔE (CIE 142-2001), for the tests that hold
 * vim's mode badges apart (TYTO-301, ADR 0089 decision 8). Only tests import it, like
 * `theme-pack-upstream.ts`; it sits in `src/main` so both `theme-pack.test.ts` and
 * `e2e/renderer-tokens.test.ts` read one formula.
 *
 * Why ΔE2000 and not a distance in RGB: equal steps in sRGB are not equal steps to the eye — a
 * blue and a purple 40 units apart in RGB can look closer than two greens 20 apart — and the
 * question the test asks is whether a person tells two badges apart. ΔE2000 is the CIE's
 * answer to that question; about 2.3 is a just-noticeable difference side by side, and
 * ADR 0089 asks 10, a difference seen at a glance between two badges that are never on
 * screen together.
 */

/** The minimum ΔE2000 between any two of a theme's four mode badges (ADR 0089 decision 8). */
export const MINIMUM_MODE_DIFFERENCE = 10;

export type Lab = readonly [lightness: number, a: number, b: number];

/** `#rrggbb` to CIELAB under D65, through linear sRGB and XYZ. */
const toLab = (hex: string): Lab => {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (match === null) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [red, green, blue] = [match[1]!, match[2]!, match[3]!].map((channel) => {
    const value = Number.parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047;
  const y = 0.2126729 * red + 0.7151522 * green + 0.072175 * blue;
  const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};

const RADIANS = Math.PI / 180;

/** A hue angle in degrees, 0 to 360, and 0 for a colour with no chroma. */
const hueAngle = (b: number, a: number): number => {
  if (a === 0 && b === 0) return 0;
  const degrees = Math.atan2(b, a) / RADIANS;
  return degrees < 0 ? degrees + 360 : degrees;
};

/** CIEDE2000 colour difference of two `#rrggbb` colours. */
export const colourDifference = (one: string, two: string): number =>
  labDifference(toLab(one), toLab(two));

/** CIEDE2000 colour difference of two CIELAB colours, with kL = kC = kH = 1. */
export const labDifference = (one: Lab, two: Lab): number => {
  const [lightness1, a1, b1] = one;
  const [lightness2, a2, b2] = two;
  const chromaMean = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(chromaMean ** 7 / (chromaMean ** 7 + 25 ** 7)));
  const aPrime1 = (1 + g) * a1;
  const aPrime2 = (1 + g) * a2;
  const chroma1 = Math.hypot(aPrime1, b1);
  const chroma2 = Math.hypot(aPrime2, b2);
  const hue1 = hueAngle(b1, aPrime1);
  const hue2 = hueAngle(b2, aPrime2);

  const deltaLightness = lightness2 - lightness1;
  const deltaChroma = chroma2 - chroma1;
  let deltaHueAngle = 0;
  if (chroma1 * chroma2 !== 0) {
    deltaHueAngle = hue2 - hue1;
    if (deltaHueAngle > 180) deltaHueAngle -= 360;
    else if (deltaHueAngle < -180) deltaHueAngle += 360;
  }
  const deltaHue = 2 * Math.sqrt(chroma1 * chroma2) * Math.sin((deltaHueAngle / 2) * RADIANS);

  const lightnessMean = (lightness1 + lightness2) / 2;
  const chromaPrimeMean = (chroma1 + chroma2) / 2;
  let hueMean = hue1 + hue2;
  if (chroma1 * chroma2 !== 0) {
    hueMean =
      Math.abs(hue1 - hue2) <= 180
        ? (hue1 + hue2) / 2
        : hue1 + hue2 < 360
          ? (hue1 + hue2 + 360) / 2
          : (hue1 + hue2 - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((hueMean - 30) * RADIANS) +
    0.24 * Math.cos(2 * hueMean * RADIANS) +
    0.32 * Math.cos((3 * hueMean + 6) * RADIANS) -
    0.2 * Math.cos((4 * hueMean - 63) * RADIANS);
  const rotationAngle = 30 * Math.exp(-(((hueMean - 275) / 25) ** 2));
  const rotationChroma = 2 * Math.sqrt(chromaPrimeMean ** 7 / (chromaPrimeMean ** 7 + 25 ** 7));
  const weightLightness =
    1 + (0.015 * (lightnessMean - 50) ** 2) / Math.sqrt(20 + (lightnessMean - 50) ** 2);
  const weightChroma = 1 + 0.045 * chromaPrimeMean;
  const weightHue = 1 + 0.015 * chromaPrimeMean * t;
  const rotation = -Math.sin(2 * rotationAngle * RADIANS) * rotationChroma;

  return Math.sqrt(
    (deltaLightness / weightLightness) ** 2 +
      (deltaChroma / weightChroma) ** 2 +
      (deltaHue / weightHue) ** 2 +
      rotation * (deltaChroma / weightChroma) * (deltaHue / weightHue),
  );
};

/** The closest two of `colours` by ΔE2000, with their names: the pair a reader confuses first. */
export const closestPair = (
  colours: Readonly<Record<string, string>>,
): { readonly names: readonly [string, string]; readonly difference: number } => {
  const entries = Object.entries(colours);
  let closest = { names: ['', ''] as [string, string], difference: Number.POSITIVE_INFINITY };
  entries.forEach(([name, value], index) => {
    for (const [otherName, otherValue] of entries.slice(index + 1)) {
      const difference = colourDifference(value, otherValue);
      if (difference < closest.difference) closest = { names: [name, otherName], difference };
    }
  });
  return closest;
};
