<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
  import { getVersion } from "@tauri-apps/api/app";
  import { app, applyTheme, displayName, saveConfig, setMode, toast } from "./store.svelte";
  import type { Mode, Theme } from "./types";
  import Icon from "./Icon.svelte";
  import Toggle from "./Toggle.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let autostart = $state(false);
  let version = $state("");
  let logPath = $state("");

  $effect(() => {
    isEnabled().then(v => (autostart = v)).catch(() => {});
    getVersion().then(v => (version = v)).catch(() => {});
    invoke<string | null>("engine_log_path").then(p => (logPath = p ?? "")).catch(() => {});
  });

  const modes: { id: Mode; title: string; text: string }[] = [
    { id: "desktop", title: "On the desktop", text: "Sits on your wallpaper like a widget, behind other windows. Visible with Win+D." },
    { id: "top", title: "Always on top", text: "Floats above all windows." },
    { id: "tray", title: "Tray flyout", text: "Hidden until you click the tray icon, like the volume flyout." },
  ];

  async function toggleAutostart(v: boolean) {
    try {
      if (v) await enable();
      else await disable();
      autostart = await isEnabled();
    } catch (e) {
      toast(String(e));
    }
  }

  function setTheme(theme: Theme) {
    app.config.settings.theme = theme;
    applyTheme();
    saveConfig();
  }

  const hidden = $derived(app.devices.filter(d => app.config.devices[d.id]?.hidden));
</script>

<section class="settings">
  <div class="top">
    <button type="button" class="icon-btn" aria-label="Back" onclick={onclose}><Icon name="back" /></button>
    <h2>Settings</h2>
  </div>

  <h3>Display</h3>
  <div class="modes" role="radiogroup">
    {#each modes as m (m.id)}
      <button
        type="button"
        role="radio"
        aria-checked={app.config.settings.mode === m.id}
        class="mode"
        class:sel={app.config.settings.mode === m.id}
        onclick={() => setMode(m.id)}
      >
        <strong>{m.title}</strong>
        <span>{m.text}</span>
      </button>
    {/each}
  </div>

  <div class="line">
    <span>Start with Windows</span>
    <Toggle checked={autostart} label="Start with Windows" onchange={toggleAutostart} />
  </div>

  <div class="line">
    <span>Theme</span>
    <div class="segmented">
      {#each ["system", "light", "dark"] as const as t (t)}
        <button type="button" class:sel={app.config.settings.theme === t} onclick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
      {/each}
    </div>
  </div>

  {#if hidden.length}
    <h3>Hidden devices</h3>
    {#each hidden as d (d.id)}
      <div class="line">
        <span>{displayName(d)}</span>
        <button
          type="button"
          class="link"
          onclick={() => {
            app.config.devices[d.id].hidden = false;
            saveConfig();
          }}>Show</button
        >
      </div>
    {/each}
  {/if}

  <h3>About</h3>
  <p class="muted about">
    Lightdeck {version} · controls Matter devices locally on your network, no cloud account needed.
    {#if logPath}<br /><span class="path" title={logPath}>Engine log: {logPath}</span>{/if}
  </p>
  <div class="line">
    <span class="muted">Close the widget and stop the background engine</span>
    <button type="button" class="btn ghost danger" onclick={() => invoke("quit")}>Quit</button>
  </div>
</section>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  h2 {
    margin: 0;
    font-size: 14px;
  }
  h3 {
    margin: 6px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .modes {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mode {
    display: flex;
    flex-direction: column;
    gap: 2px;
    text-align: left;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    cursor: pointer;
  }
  .mode span {
    font-size: 11.5px;
    color: var(--muted);
  }
  .mode.sel {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
  }
  .segmented {
    display: flex;
    background: var(--track);
    border-radius: 8px;
    padding: 2px;
  }
  .segmented button {
    border: 0;
    background: transparent;
    color: var(--muted);
    padding: 4px 10px;
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .segmented button.sel {
    background: var(--surface);
    color: var(--text);
  }
  .about {
    font-size: 11.5px;
    margin: 0;
  }
  .path {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    user-select: text;
  }
</style>
