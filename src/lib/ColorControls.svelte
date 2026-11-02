<script lang="ts">
  import { app, newId, saveConfig } from "./store.svelte";
  import { colorCss, hsCss, kelvinCss, kelvinLabel, presetCss } from "./color";
  import type { ColorValue, Device, Preset } from "./types";
  import Icon from "./Icon.svelte";

  let {
    value: external,
    caps,
    onchange: emit,
    compact = false,
  }: {
    value: ColorValue;
    caps: Device["caps"];
    onchange: (value: ColorValue, final: boolean) => void;
    compact?: boolean;
  } = $props();

  // While a slider is being dragged we show the local value, so late device responses can't make the thumb jump.
  let local = $state<ColorValue | null>(null);
  const value = $derived(local ?? external);

  function onchange(next: ColorValue, final: boolean) {
    local = final ? null : next;
    emit(next, final);
  }

  const canColor = $derived(caps.hs || caps.xy);
  const canWhite = $derived(caps.ct);
  const minK = $derived(caps.ctMinKelvin ?? 2000);
  const maxK = $derived(caps.ctMaxKelvin ?? 6500);

  let expanded = $state(false);
  let tab = $derived<"hs" | "ct">(value.mode === "ct" && canWhite ? "ct" : canColor ? "hs" : "ct");

  const presets = $derived(
    app.config.presets.filter(p => (p.kind === "ct" ? canWhite : canColor)),
  );

  function isActive(p: Preset) {
    if (p.kind === "ct") return value.mode === "ct" && Math.abs(value.kelvin - p.kelvin) < 150;
    return value.mode === "hs" && Math.abs(value.hue - p.hue) < 6 && Math.abs(value.sat - p.sat) < 6;
  }

  function pick(p: Preset) {
    if (p.kind === "ct") onchange({ ...value, mode: "ct", kelvin: Math.min(maxK, Math.max(minK, p.kelvin)) }, true);
    else onchange({ ...value, mode: "hs", hue: p.hue, sat: p.sat }, true);
  }

  function savePreset() {
    const preset: Preset =
      value.mode === "ct"
        ? { id: newId(), kind: "ct", kelvin: value.kelvin }
        : { id: newId(), kind: "hs", hue: value.hue, sat: value.sat };
    app.config.presets.push(preset);
    saveConfig();
  }

  function removePreset(event: MouseEvent, p: Preset) {
    event.preventDefault();
    app.config.presets = app.config.presets.filter(x => x.id !== p.id);
    saveConfig();
  }

  const kelvinGradient = $derived(
    `linear-gradient(to right, ${[0, 0.25, 0.5, 0.75, 1].map(t => kelvinCss(minK + (maxK - minK) * t)).join(", ")})`,
  );
  const satGradient = $derived(`linear-gradient(to right, #fff, ${hsCss(value.hue, 100)})`);
</script>

<div class="color" class:compact>
  <div class="swatches" role="group" aria-label="Color presets">
    {#each presets as p (p.id)}
      <button
        type="button"
        class="swatch"
        class:active={isActive(p)}
        style:background={presetCss(p)}
        title={p.kind === "ct" ? `${kelvinLabel(p.kelvin)} white (${p.kelvin} K) · right-click to remove` : "Right-click to remove"}
        aria-label={p.kind === "ct" ? `${kelvinLabel(p.kelvin)} white` : `Color preset`}
        onclick={() => pick(p)}
        oncontextmenu={e => removePreset(e, p)}
      ></button>
    {/each}
    <button
      type="button"
      class="more"
      class:open={expanded}
      title={expanded ? "Hide color sliders" : "Custom color"}
      aria-label="Custom color"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
    >
      <Icon name="chevron" size={14} />
    </button>
  </div>

  {#if expanded}
    <div class="custom">
      {#if canColor && canWhite}
        <div class="segmented" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "hs"} class:sel={tab === "hs"} onclick={() => onchange({ ...value, mode: "hs" }, true)}>Color</button>
          <button type="button" role="tab" aria-selected={tab === "ct"} class:sel={tab === "ct"} onclick={() => onchange({ ...value, mode: "ct" }, true)}>White</button>
        </div>
      {/if}

      {#if tab === "hs"}
        <label class="slider-row">
          <span class="lbl">Hue</span>
          <input
            type="range"
            class="hue"
            min="0"
            max="359"
            value={value.hue}
            aria-label="Hue"
            oninput={e => onchange({ ...value, mode: "hs", hue: +e.currentTarget.value }, false)}
            onchange={e => onchange({ ...value, mode: "hs", hue: +e.currentTarget.value }, true)}
          />
        </label>
        <label class="slider-row">
          <span class="lbl">Sat</span>
          <input
            type="range"
            min="0"
            max="100"
            value={value.sat}
            style:--track-bg={satGradient}
            aria-label="Saturation"
            oninput={e => onchange({ ...value, mode: "hs", sat: +e.currentTarget.value }, false)}
            onchange={e => onchange({ ...value, mode: "hs", sat: +e.currentTarget.value }, true)}
          />
        </label>
      {:else}
        <label class="slider-row">
          <span class="lbl">{kelvinLabel(value.kelvin)}</span>
          <input
            type="range"
            min={minK}
            max={maxK}
            step="50"
            value={value.kelvin}
            style:--track-bg={kelvinGradient}
            aria-label="White temperature"
            oninput={e => onchange({ ...value, mode: "ct", kelvin: +e.currentTarget.value }, false)}
            onchange={e => onchange({ ...value, mode: "ct", kelvin: +e.currentTarget.value }, true)}
          />
        </label>
      {/if}
      <div class="save-row">
        <span class="current" style:background={colorCss(value)}></span>
        <span class="muted">{value.mode === "ct" ? `${value.kelvin} K` : `Hue ${value.hue}° · ${value.sat}%`}</span>
        <button type="button" class="link" onclick={savePreset}>Save as preset</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .color {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    align-items: center;
  }
  .swatch {
    width: 19px;
    height: 19px;
    border-radius: 50%;
    border: 1px solid rgb(0 0 0 / 0.15);
    padding: 0;
    cursor: pointer;
    transition: transform 0.1s;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.15);
  }
  .swatch:hover {
    transform: scale(1.12);
  }
  .swatch.active {
    outline: 2px solid var(--text);
    outline-offset: 2px;
  }
  .more {
    width: 19px;
    height: 19px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    border: 1px dashed var(--line-strong);
    background: transparent;
    color: var(--muted);
    padding: 0;
    cursor: pointer;
  }
  .more.open :global(svg) {
    transform: rotate(180deg);
  }
  .custom {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px;
    border-radius: 10px;
    background: var(--inset);
  }
  .segmented {
    display: flex;
    background: var(--track);
    border-radius: 8px;
    padding: 2px;
  }
  .segmented button {
    flex: 1;
    border: 0;
    background: transparent;
    color: var(--muted);
    padding: 4px 0;
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .segmented button.sel {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  }
  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lbl {
    width: 52px;
    font-size: 11px;
    color: var(--muted);
  }
  .hue {
    --track-bg: linear-gradient(to right, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00);
  }
  .save-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }
  .current {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid rgb(0 0 0 / 0.2);
  }
  .save-row .link {
    margin-left: auto;
  }
</style>
