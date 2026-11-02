import type { ColorValue, DeviceState, Preset } from "./types";

/** CSS color for a bulb's hue/saturation at full brightness (HSV with V = 1). */
export function hsCss(hue: number, sat: number) {
  const s = sat / 100;
  const l = 1 - s / 2;
  const sl = l === 0 || l === 1 ? 0 : (1 - l) / Math.min(l, 1 - l);
  return `hsl(${Math.round(hue)} ${Math.round(sl * 100)}% ${Math.round(l * 100)}%)`;
}

/** Approximate sRGB for a black-body color temperature (Tanner Helland's fit). */
export function kelvinCss(kelvin: number) {
  const t = kelvin / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
  return `rgb(${c(r)} ${c(g)} ${c(b)})`;
}

export function colorCss(v: Pick<ColorValue, "mode" | "hue" | "sat" | "kelvin">) {
  return v.mode === "ct" ? kelvinCss(v.kelvin) : hsCss(v.hue, v.sat);
}

export function presetCss(p: Preset) {
  return p.kind === "ct" ? kelvinCss(p.kelvin) : hsCss(p.hue, p.sat);
}

export function stateCss(state: DeviceState, fallback = "#ffd27a") {
  if (state.mode === "ct" && state.kelvin) return kelvinCss(state.kelvin);
  if (state.mode === "hs" && state.hue !== undefined) return hsCss(state.hue, state.sat ?? 100);
  return fallback;
}

export function stateToColor(state: DeviceState): ColorValue {
  return {
    mode: state.mode ?? "ct",
    hue: state.hue ?? 30,
    sat: state.sat ?? 100,
    kelvin: state.kelvin ?? 2700,
  };
}

export function kelvinLabel(k: number) {
  if (k < 3000) return "Warm";
  if (k < 4500) return "Neutral";
  if (k < 5800) return "Daylight";
  return "Cool";
}

export const DEFAULT_PRESETS: Preset[] = [
  { id: "warm", kind: "ct", kelvin: 2700 },
  { id: "neutral", kind: "ct", kelvin: 4000 },
  { id: "cool", kind: "ct", kelvin: 6000 },
  { id: "red", kind: "hs", hue: 0, sat: 100 },
  { id: "orange", kind: "hs", hue: 28, sat: 100 },
  { id: "yellow", kind: "hs", hue: 52, sat: 100 },
  { id: "green", kind: "hs", hue: 125, sat: 100 },
  { id: "cyan", kind: "hs", hue: 185, sat: 100 },
  { id: "blue", kind: "hs", hue: 225, sat: 100 },
  { id: "purple", kind: "hs", hue: 275, sat: 100 },
  { id: "pink", kind: "hs", hue: 320, sat: 85 },
];
