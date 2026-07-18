// Small color-math helpers for tenant-aware UI accents — no dependency,
// just hex <-> HSL conversion plus a "pick a hue that reads as distinct
// from this tenant's brand color" helper.

export function hexToHsl(hex: string): [number, number, number] {
  const m = hex.replace("#", "").match(/.{1,2}/g);
  if (!m || m.length < 3) return [0, 0, 50];
  const [r, g, b] = m.slice(0, 3).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n: number) => Math.round(f(n) * 255).toString(16).padStart(2, "0");
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

// A flag/alert box (e.g. "this document was requested and is still
// outstanding") needs to visually pop regardless of what a hospital picked
// as its brand color — if a tenant's accent happens to be red, a hardcoded
// red flag would blend right into their buttons and stop reading as an
// alert. Instead, pick whichever of a few well-spaced alert hues sits
// furthest around the color wheel from the tenant's accent hue.
export function contrastingHighlight(tenantAccentHex: string): { border: string; bg: string } {
  const [tenantHue] = hexToHsl(tenantAccentHex);
  const candidates = [0, 30, 210, 270]; // red, amber, blue, violet
  let best = candidates[0];
  let bestDist = -1;
  for (const hue of candidates) {
    const diff = Math.abs(hue - tenantHue);
    const dist = Math.min(diff, 360 - diff);
    if (dist > bestDist) { bestDist = dist; best = hue; }
  }
  return {
    border: hslToHex(best, 65, 45),
    bg: hslToHex(best, 65, 95),
  };
}
