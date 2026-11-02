import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_PRESETS } from "./color";
import type { AppConfig, ColorValue, Device, Mode, Scene, SceneAction, SetParams } from "./types";

// ---------------------------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------------------------

function defaultConfig(): AppConfig {
  return {
    settings: { mode: "desktop", theme: "system" },
    devices: {},
    scenes: [],
    presets: structuredClone(DEFAULT_PRESETS),
  };
}

export const app = $state({
  devices: [] as Device[],
  config: defaultConfig(),
  loaded: false,
  engine: "starting" as "starting" | "ready" | "restarting" | "error",
  engineError: "",
  pairingStatus: "",
  refreshing: false,
  toast: "",
});

let lastRefresh = 0;

// ---------------------------------------------------------------------------------------------------------------
// Engine calls
// ---------------------------------------------------------------------------------------------------------------

export function matter<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>("matter", { method, params });
}

function message(error: unknown) {
  return typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string) {
  app.toast = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (app.toast = ""), 4500);
}

function upsertDevice(device: Device) {
  const i = app.devices.findIndex(d => d.id === device.id);
  if (i >= 0) app.devices[i] = device;
  else app.devices.push(device);
}

export async function init() {
  const stored = await invoke<Partial<AppConfig>>("get_config");
  const base = defaultConfig();
  app.config = {
    settings: { ...base.settings, ...(stored.settings ?? {}) },
    devices: stored.devices ?? {},
    scenes: stored.scenes ?? [],
    presets: stored.presets?.length ? stored.presets : base.presets,
  };
  applyTheme();

  await listen<{ event: string; data?: any }>("matter://event", ({ payload }) => {
    switch (payload.event) {
      case "ready":
        app.engine = "ready";
        app.engineError = "";
        if (payload.data?.devices) app.devices = payload.data.devices;
        void refresh(true);
        break;
      case "stopped":
        app.engine = "restarting";
        break;
      case "fatal":
        app.engine = "error";
        app.engineError = payload.data?.error ?? "The Matter engine failed to start";
        break;
      case "status":
        app.pairingStatus = payload.data?.message ?? "";
        break;
    }
  });
  await listen("widget://shown", () => {
    if (Date.now() - lastRefresh > 15_000) void refresh();
  });

  try {
    app.devices = await matter<Device[]>("list");
    app.engine = "ready";
    void refresh(true);
  } catch (error) {
    app.engine = "error";
    app.engineError = message(error);
  }
  app.loaded = true;
}

/** Re-read live state from all devices. */
export async function refresh(quiet = false) {
  if (app.refreshing) return;
  app.refreshing = !quiet;
  lastRefresh = Date.now();
  try {
    app.devices = await matter<Device[]>("refresh");
  } catch (error) {
    if (!quiet) toast(message(error));
  } finally {
    app.refreshing = false;
  }
}

export function refreshIfStale(ms = 60_000) {
  if (Date.now() - lastRefresh > ms) void refresh(true);
}

// ---------------------------------------------------------------------------------------------------------------
// Device control (optimistic; only the latest response per device is applied so sliders never jump back)
// ---------------------------------------------------------------------------------------------------------------

const seq = new Map<string, number>();

function applyOptimistic(device: Device, p: SetParams) {
  const s = device.state;
  if (p.on !== undefined) s.on = p.on;
  if (p.level !== undefined) {
    s.level = p.level;
    s.on = true;
  }
  if (p.kelvin !== undefined) {
    s.mode = "ct";
    s.kelvin = p.kelvin;
  } else if (p.hue !== undefined) {
    s.mode = "hs";
    s.hue = p.hue;
    s.sat = p.sat ?? s.sat;
  }
}

export async function control(p: SetParams) {
  const device = app.devices.find(d => d.id === p.id);
  if (!device) return;
  applyOptimistic(device, p);
  const n = (seq.get(p.id) ?? 0) + 1;
  seq.set(p.id, n);
  try {
    const updated = await matter<Device>("set", { ...p });
    if (seq.get(p.id) === n) upsertDevice(updated);
  } catch (error) {
    if (seq.get(p.id) === n) {
      device.reachable = false;
      toast(`${displayName(device)}: ${message(error)}`);
    }
  }
}

export function colorParams(color: ColorValue): Partial<SetParams> {
  return color.mode === "ct" ? { kelvin: color.kelvin } : { hue: color.hue, sat: color.sat };
}

export async function identify(device: Device) {
  try {
    await matter("identify", { id: device.id });
  } catch (error) {
    toast(message(error));
  }
}

export async function removeDevice(device: Device) {
  await matter("remove", { nodeId: device.nodeId });
  app.devices = app.devices.filter(d => d.nodeId !== device.nodeId);
  for (const id of Object.keys(app.config.devices)) {
    if (id.startsWith(`${device.nodeId}/`)) delete app.config.devices[id];
  }
  for (const scene of app.config.scenes) {
    scene.actions = scene.actions.filter(a => !a.id.startsWith(`${device.nodeId}/`));
  }
  saveConfig();
}

export async function commission(code: string): Promise<Device[]> {
  app.pairingStatus = "Starting...";
  try {
    const added = await matter<Device[]>("commission", { code });
    for (const d of added) upsertDevice(d);
    return added;
  } finally {
    app.pairingStatus = "";
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------------------------

export function actionToParams(a: SceneAction, device?: Device): SetParams {
  if (!a.on) return { id: a.id, on: false };
  const p: SetParams = { id: a.id, on: true };
  if (device?.caps.dimmable && a.level !== undefined) p.level = a.level;
  if (a.color && device && (device.caps.hs || device.caps.xy || device.caps.ct)) {
    if (a.color.mode === "ct" && device.caps.ct) p.kelvin = a.color.kelvin;
    else if (a.color.mode === "hs" && (device.caps.hs || device.caps.xy)) Object.assign(p, { hue: a.color.hue, sat: a.color.sat });
  }
  return p;
}

export async function runActions(actions: SetParams[]) {
  if (!actions.length) return;
  for (const p of actions) {
    const d = app.devices.find(x => x.id === p.id);
    if (d) applyOptimistic(d, p);
  }
  try {
    const results = await matter<{ id: string; ok: boolean; error?: string; device?: Device }[]>("setMany", { actions });
    const failed: string[] = [];
    for (const r of results) {
      if (r.device) upsertDevice(r.device);
      if (!r.ok) {
        const d = app.devices.find(x => x.id === r.id);
        if (d) d.reachable = false;
        failed.push(d ? displayName(d) : r.id);
      }
    }
    if (failed.length) toast(`Couldn't reach: ${failed.join(", ")}`);
  } catch (error) {
    toast(message(error));
  }
}

export function applyScene(scene: Scene) {
  const actions = scene.actions
    .map(a => actionToParams(a, app.devices.find(d => d.id === a.id)))
    .filter(p => app.devices.some(d => d.id === p.id));
  return runActions(actions);
}

export function allDevices(on: boolean) {
  return runActions(visibleDevices().map(d => ({ id: d.id, on })));
}

export function saveScene(scene: Scene) {
  const i = app.config.scenes.findIndex(s => s.id === scene.id);
  if (i >= 0) app.config.scenes[i] = scene;
  else app.config.scenes.push(scene);
  saveConfig();
}

export function deleteScene(id: string) {
  app.config.scenes = app.config.scenes.filter(s => s.id !== id);
  saveConfig();
}

// ---------------------------------------------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
export function saveConfig() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void invoke("save_config", { value: $state.snapshot(app.config) });
  }, 250);
}

export function displayName(device: Device) {
  return app.config.devices[device.id]?.name || device.name;
}

export function deviceSettings(id: string) {
  return (app.config.devices[id] ??= {});
}

export function visibleDevices() {
  return sortedDevices().filter(d => !app.config.devices[d.id]?.hidden);
}

export function sortedDevices() {
  const order = (d: Device) => app.config.devices[d.id]?.order ?? Number.MAX_SAFE_INTEGER;
  return [...app.devices].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function moveDevice(id: string, delta: -1 | 1) {
  const list = visibleDevices();
  const i = list.findIndex(d => d.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((d, index) => (deviceSettings(d.id).order = index));
  saveConfig();
}

export async function setMode(mode: Mode) {
  app.config.settings.mode = mode;
  await invoke("set_mode", { mode });
  saveConfig();
}

export function applyTheme() {
  const theme = app.config.settings.theme;
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/** Leading + trailing throttle, used for sliders so dragging sends a few commands per second, not hundreds. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms = 180) {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;
  return (...args: A) => {
    const now = Date.now();
    pending = args;
    if (now - last >= ms) {
      last = now;
      fn(...args);
      pending = undefined;
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        last = Date.now();
        if (pending) fn(...pending);
        pending = undefined;
      }, ms - (now - last));
    }
  };
}
