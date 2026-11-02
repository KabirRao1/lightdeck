export type Mode = "desktop" | "top" | "tray";
export type Theme = "system" | "light" | "dark";

/** A controllable endpoint (one bulb, plug, or one outlet of a multi-outlet device) as reported by the engine. */
export interface Device {
  id: string; // "<nodeId>/<endpoint>"
  nodeId: string;
  endpoint: number;
  kind: "light" | "plug";
  name: string;
  vendor?: string;
  product?: string;
  reachable: boolean;
  caps: {
    dimmable: boolean;
    hs: boolean;
    xy: boolean;
    ct: boolean;
    ctMinKelvin?: number;
    ctMaxKelvin?: number;
  };
  state: DeviceState;
}

export interface DeviceState {
  on?: boolean;
  level?: number; // 1-100
  mode?: "hs" | "ct";
  hue?: number; // 0-360
  sat?: number; // 0-100
  kelvin?: number;
}

/** What a device should do: used for live control and stored in scenes. */
export interface SetParams {
  id: string;
  on?: boolean;
  level?: number;
  hue?: number;
  sat?: number;
  kelvin?: number;
  transition?: number;
}

export interface ColorValue {
  mode: "hs" | "ct";
  hue: number;
  sat: number;
  kelvin: number;
}

export type Preset =
  | { id: string; kind: "hs"; hue: number; sat: number }
  | { id: string; kind: "ct"; kelvin: number };

export interface SceneAction {
  id: string; // device id
  on: boolean;
  level?: number;
  color?: ColorValue;
}

export interface Scene {
  id: string;
  name: string;
  actions: SceneAction[];
}

export interface DeviceSettings {
  name?: string;
  hidden?: boolean;
  order?: number;
}

export interface AppConfig {
  settings: {
    mode: Mode;
    theme: Theme;
  };
  devices: Record<string, DeviceSettings>;
  scenes: Scene[];
  presets: Preset[];
}
