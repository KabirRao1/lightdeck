// Browser-side mock of the Tauri backend, used only to render README screenshots of the real UI
// (see scripts/screenshots.mjs). It fakes the Matter engine with a few sample devices.
(() => {
  const theme = new URLSearchParams(location.search).get("theme") || "dark";
  const devices = [
    {
      id: "1/1", nodeId: "1", endpoint: 1, kind: "light", name: "Desk Lamp", vendor: "Example Co.", product: "Color Bulb A19",
      reachable: true,
      caps: { dimmable: true, hs: true, xy: true, ct: true, ctMinKelvin: 2700, ctMaxKelvin: 6500 },
      state: { on: true, level: 72, mode: "ct", kelvin: 2700 },
    },
    {
      id: "2/1", nodeId: "2", endpoint: 1, kind: "light", name: "Bedroom Bulb", vendor: "Example Co.", product: "Color Bulb A19",
      reachable: true,
      caps: { dimmable: true, hs: true, xy: true, ct: true, ctMinKelvin: 2200, ctMaxKelvin: 6500 },
      state: { on: true, level: 45, mode: "hs", hue: 275, sat: 100 },
    },
    {
      id: "3/1", nodeId: "3", endpoint: 1, kind: "plug", name: "Floor Lamp", vendor: "Example Co.", product: "Smart Plug",
      reachable: true,
      caps: { dimmable: false, hs: false, xy: false, ct: false },
      state: { on: false },
    },
  ];
  const config = {
    settings: { mode: "desktop", theme },
    devices: {},
    scenes: [
      { id: "s1", name: "Movie night", actions: [
        { id: "1/1", on: true, level: 20, color: { mode: "hs", hue: 225, sat: 100, kelvin: 2700 } },
        { id: "2/1", on: true, level: 30, color: { mode: "hs", hue: 275, sat: 100, kelvin: 2700 } },
        { id: "3/1", on: false },
      ] },
      { id: "s2", name: "Focus", actions: [
        { id: "1/1", on: true, level: 100, color: { mode: "ct", hue: 0, sat: 0, kelvin: 5000 } },
        { id: "3/1", on: true },
      ] },
      { id: "s3", name: "Relax", actions: [
        { id: "1/1", on: true, level: 50, color: { mode: "ct", hue: 0, sat: 0, kelvin: 2700 } },
        { id: "2/1", on: true, level: 40, color: { mode: "hs", hue: 28, sat: 100, kelvin: 2700 } },
      ] },
      { id: "s4", name: "Good night", actions: [
        { id: "1/1", on: false }, { id: "2/1", on: true, level: 5, color: { mode: "hs", hue: 0, sat: 100, kelvin: 2700 } }, { id: "3/1", on: false },
      ] },
    ],
    presets: [],
  };

  const find = id => devices.find(d => d.id === id);
  function apply(p) {
    const d = find(p.id);
    if (!d) throw new Error("Unknown device");
    if (p.on !== undefined) d.state.on = p.on;
    if (p.level !== undefined) Object.assign(d.state, { level: p.level, on: true });
    if (p.kelvin !== undefined) Object.assign(d.state, { mode: "ct", kelvin: p.kelvin });
    else if (p.hue !== undefined) Object.assign(d.state, { mode: "hs", hue: p.hue, sat: p.sat ?? d.state.sat });
    return structuredClone(d);
  }

  let callbackId = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    transformCallback: () => ++callbackId,
    unregisterCallback: () => {},
    convertFileSrc: s => s,
    invoke: async (cmd, args = {}) => {
      switch (cmd) {
        case "get_config": return structuredClone(config);
        case "matter": {
          const { method, params } = args;
          if (method === "list" || method === "refresh") return structuredClone(devices);
          if (method === "set") return apply(params);
          if (method === "setMany") return params.actions.map(a => ({ id: a.id, ok: true, device: apply(a) }));
          return { ok: true };
        }
        case "engine_log_path": return "C:\\Users\\you\\AppData\\Local\\io.github.kabirrao1.lightdeck\\logs\\matter-engine.log";
        case "plugin:app|version": return "0.1.0";
        case "plugin:autostart|is_enabled": return true;
        default: return null;
      }
    },
  };
})();
