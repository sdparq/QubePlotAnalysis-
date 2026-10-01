/**
 * Solar position for the sun & shadow study — the low-precision NOAA /
 * Astronomical Almanac formulae (≈0.1° over 1950–2050), plenty for massing
 * shadows. Pure functions, no dependencies.
 */

/** Dubai (Business Bay) — the default site for every study. */
export const DUBAI = { lat: 25.1972, lon: 55.2744, utcOffsetHours: 4, name: "Dubai" } as const;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface SunPosition {
  /** Degrees clockwise from true north (90 = east, 180 = south, 270 = west). */
  azimuthDeg: number;
  /** Degrees above the horizon (negative = below). */
  altitudeDeg: number;
}

function mod(a: number, n: number) {
  return ((a % n) + n) % n;
}

/** Sun position at a UTC instant for a latitude / longitude (east positive). */
export function sunPosition(utcMs: number, lat: number, lon: number): SunPosition {
  const n = utcMs / 86_400_000 + 2440587.5 - 2451545.0; // days since J2000.0
  const L = mod(280.46 + 0.9856474 * n, 360); // mean longitude
  const g = mod(357.528 + 0.9856003 * n, 360) * RAD; // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // ecliptic longitude
  const eps = (23.439 - 0.0000004 * n) * RAD; // obliquity
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstHours = mod(18.697374558 + 24.06570982441908 * n, 24);
  const hourAngle = mod(gmstHours * 15 + lon - ra * DEG, 360) * RAD; // local hour angle
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle));
  const az = Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI;
  return { azimuthDeg: mod(az * DEG, 360), altitudeDeg: alt * DEG };
}

/** UTC instant for a local civil date/time at a fixed UTC offset (no DST — as in the UAE). */
export function localToUtcMs(year: number, month1: number, day: number, hours: number, utcOffsetHours: number): number {
  return Date.UTC(year, month1 - 1, day) + (hours - utcOffsetHours) * 3_600_000;
}

/** Sun position at a local date and decimal hour in Dubai. */
export function dubaiSun(year: number, month1: number, day: number, hours: number): SunPosition {
  return sunPosition(localToUtcMs(year, month1, day, hours, DUBAI.utcOffsetHours), DUBAI.lat, DUBAI.lon);
}

/** Local sunrise / sunset (decimal hours) for a date in Dubai, found by bisection on the altitude. */
export function dubaiDaylight(year: number, month1: number, day: number): { sunrise: number; sunset: number } {
  // The sun's upper limb + refraction put apparent sunrise at about −0.833°.
  const h0 = -0.833;
  const alt = (h: number) => dubaiSun(year, month1, day, h).altitudeDeg - h0;
  const solve = (a: number, b: number) => {
    let lo = a;
    let hi = b;
    const rising = alt(lo) < 0;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (alt(mid) < 0 === rising) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  return { sunrise: solve(3, 12), sunset: solve(12, 21) };
}

/**
 * Unit vector pointing TO the sun in the viewer's world frame.
 *
 * Plan coordinates (x east-ish, y north-ish) map to world (x, 0, −y). The plot
 * drawing is rarely perfectly north-up, so `northDeg` is the bearing of true
 * north measured clockwise from the drawing's +y axis.
 */
export function sunDirectionWorld(sun: SunPosition, northDeg = 0): [number, number, number] {
  // Bearing of the sun measured from the drawing's +y axis.
  const az = (sun.azimuthDeg + northDeg) * RAD;
  const alt = sun.altitudeDeg * RAD;
  const east = Math.sin(az) * Math.cos(alt);
  const north = Math.cos(az) * Math.cos(alt);
  return [east, Math.sin(alt), -north];
}

export function formatClock(hours: number): string {
  const h = Math.floor(mod(hours, 24));
  const m = Math.round((mod(hours, 24) - h) * 60);
  const hh = m === 60 ? h + 1 : h;
  return `${String(hh).padStart(2, "0")}:${String(m === 60 ? 0 : m).padStart(2, "0")}`;
}
