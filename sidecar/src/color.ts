/**
 * Color conversions between the UI model (hue 0-360, saturation 0-100, Kelvin) and Matter's Color Control
 * representations (hue/sat 0-254, CIE xy scaled to 0-65279, mireds).
 */

export interface Hs {
    hue: number; // 0-360
    sat: number; // 0-100
}

export function hsToMatter({ hue, sat }: Hs) {
    return {
        hue: clamp(Math.round((((hue % 360) + 360) % 360) / 360 * 254), 0, 254),
        saturation: clamp(Math.round(sat / 100 * 254), 0, 254),
    };
}

export function hsFromMatter(hue: number, saturation: number): Hs {
    return { hue: Math.round(hue / 254 * 360), sat: Math.round(saturation / 254 * 100) };
}

/** HSV (value = 1) -> CIE 1931 xy, scaled for Matter (0..65279). */
export function hsToXy({ hue, sat }: Hs) {
    const [r, g, b] = hsvToRgb(hue, sat / 100, 1).map(srgbToLinear);
    const X = r * 0.4124 + g * 0.3576 + b * 0.1805;
    const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const Z = r * 0.0193 + g * 0.1192 + b * 0.9505;
    const sum = X + Y + Z || 1;
    return {
        colorX: clamp(Math.round((X / sum) * 65536), 0, 65279),
        colorY: clamp(Math.round((Y / sum) * 65536), 0, 65279),
    };
}

/** Matter xy -> approximate hue/saturation for display. */
export function xyToHs(colorX: number, colorY: number): Hs {
    const x = colorX / 65536;
    const y = colorY / 65536 || 1e-6;
    const Y = 1;
    const X = (x / y) * Y;
    const Z = ((1 - x - y) / y) * Y;
    let r = X * 3.2406 - Y * 1.5372 - Z * 0.4986;
    let g = -X * 0.9689 + Y * 1.8758 + Z * 0.0415;
    let b = X * 0.0557 - Y * 0.204 + Z * 1.057;
    const max = Math.max(r, g, b, 1e-6);
    [r, g, b] = [r, g, b].map(c => Math.max(0, c / max));
    return rgbToHs(r, g, b);
}

export function kelvinToMireds(kelvin: number, minMireds = 153, maxMireds = 500) {
    return clamp(Math.round(1_000_000 / kelvin), minMireds, maxMireds);
}

export function miredsToKelvin(mireds: number) {
    return Math.round(1_000_000 / Math.max(mireds, 1));
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const f = (n: number) => {
        const k = (n + h / 60) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)];
}

function rgbToHs(r: number, g: number, b: number): Hs {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
    }
    return { hue: Math.round(((h * 60) + 360) % 360), sat: Math.round(max === 0 ? 0 : (d / max) * 100) };
}

function srgbToLinear(c: number) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function clamp(v: number, min: number, max: number) {
    return Math.min(max, Math.max(min, v));
}
