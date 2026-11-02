<script lang="ts">
  import {
    app,
    colorParams,
    control,
    deviceSettings,
    displayName,
    identify,
    moveDevice,
    refresh,
    removeDevice,
    saveConfig,
    throttle,
    toast,
  } from "./store.svelte";
  import { stateCss, stateToColor } from "./color";
  import type { ColorValue, Device } from "./types";
  import ColorControls from "./ColorControls.svelte";
  import Icon from "./Icon.svelte";
  import Toggle from "./Toggle.svelte";

  let { device }: { device: Device } = $props();

  let menuOpen = $state(false);
  let renaming = $state(false);
  let confirmRemove = $state(false);
  let nameDraft = $state("");

  const on = $derived(!!device.state.on);
  const hasColor = $derived(device.caps.hs || device.caps.xy || device.caps.ct);
  const glow = $derived(stateCss(device.state, device.kind === "plug" ? "var(--accent)" : "#ffd27a"));

  const sendLevel = throttle((level: number) => control({ id: device.id, level }));
  // Local value while dragging so device responses can't make the slider jump back.
  let dragLevel = $state<number | null>(null);
  const shownLevel = $derived(dragLevel ?? device.state.level ?? 100);
  const sendColor = throttle((c: ColorValue) => control({ id: device.id, ...colorParams(c) }));

  function startRename() {
    nameDraft = displayName(device);
    renaming = true;
    menuOpen = false;
  }

  function commitRename() {
    const name = nameDraft.trim();
    deviceSettings(device.id).name = name && name !== device.name ? name : undefined;
    saveConfig();
    renaming = false;
  }

  function hide() {
    deviceSettings(device.id).hidden = true;
    saveConfig();
    menuOpen = false;
    toast(`${displayName(device)} hidden. Unhide it in Settings.`);
  }

  async function remove() {
    try {
      await removeDevice(device);
    } catch (error) {
      toast(String(error));
    }
  }
</script>

<article class="card" class:on class:offline={!device.reachable}>
  <header>
    <span class="dot" style:--glow={on ? glow : "transparent"}>
      <Icon name={device.kind === "plug" ? "plug" : "bulb"} size={15} />
    </span>
    {#if renaming}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="rename"
        bind:value={nameDraft}
        autofocus
        maxlength="40"
        onkeydown={e => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") renaming = false;
        }}
        onblur={commitRename}
      />
    {:else}
      <div class="title">
        <span class="name" title={device.product}>{displayName(device)}</span>
        {#if !device.reachable}
          <button type="button" class="badge" title="Try again" onclick={() => refresh()}>Offline · retry</button>
        {:else if device.kind === "light" && on && device.state.level !== undefined}
          <span class="sub">{device.state.level}%</span>
        {/if}
      </div>
    {/if}
    <button type="button" class="icon-btn" aria-label="Device options" onclick={() => (menuOpen = !menuOpen)}>
      <Icon name="dots" />
    </button>
    <Toggle checked={on} label={`Turn ${displayName(device)} ${on ? "off" : "on"}`} onchange={v => control({ id: device.id, on: v })} />
  </header>

  {#if menuOpen}
    <div class="menu" role="menu">
      <button type="button" role="menuitem" onclick={startRename}><Icon name="edit" size={14} />Rename</button>
      <button type="button" role="menuitem" onclick={() => { identify(device); menuOpen = false; }}><Icon name="sparkle" size={14} />Blink to identify</button>
      <button type="button" role="menuitem" onclick={() => moveDevice(device.id, -1)}><Icon name="up" size={14} />Move up</button>
      <button type="button" role="menuitem" onclick={() => moveDevice(device.id, 1)}><Icon name="down" size={14} />Move down</button>
      <button type="button" role="menuitem" onclick={hide}><Icon name="eye" size={14} />Hide from widget</button>
      {#if confirmRemove}
        <button type="button" role="menuitem" class="danger" onclick={remove}><Icon name="trash" size={14} />Really remove?</button>
      {:else}
        <button type="button" role="menuitem" class="danger" onclick={() => (confirmRemove = true)}><Icon name="trash" size={14} />Remove device</button>
      {/if}
      <p class="meta">{[device.vendor, device.product].filter(Boolean).join(" · ")} · node {device.nodeId}{device.endpoint !== 1 ? ` · endpoint ${device.endpoint}` : ""}</p>
    </div>
  {/if}

  {#if device.caps.dimmable}
    <div class="level">
      <Icon name="sun" size={14} />
      <input
        type="range"
        min="1"
        max="100"
        value={shownLevel}
        aria-label="Brightness"
        style:--fill={`${on || dragLevel !== null ? shownLevel : 0}%`}
        class="fill"
        oninput={e => {
          dragLevel = +e.currentTarget.value;
          sendLevel(dragLevel);
        }}
        onchange={e => {
          sendLevel(+e.currentTarget.value);
          dragLevel = null;
        }}
      />
    </div>
  {/if}

  {#if hasColor}
    <ColorControls value={stateToColor(device.state)} caps={device.caps} onchange={c => sendColor(c)} />
  {/if}
</article>

<style>
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .card.offline {
    opacity: 0.75;
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .dot {
    width: 30px;
    height: 30px;
    flex: none;
    border-radius: 50%;
    display: grid;
    place-items: center;
    color: var(--muted);
    background: var(--inset);
    box-shadow: 0 0 0 0 var(--glow);
    transition: box-shadow 0.25s, background 0.25s, color 0.25s;
  }
  .on .dot {
    background: var(--glow);
    color: rgb(0 0 0 / 0.65);
    box-shadow: 0 0 14px 1px var(--glow);
  }
  .title {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 11px;
    color: var(--muted);
  }
  .badge {
    align-self: flex-start;
    font: inherit;
    font-size: 11px;
    color: var(--danger);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .rename {
    flex: 1;
    min-width: 0;
  }
  .level {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }
  .menu {
    display: flex;
    flex-direction: column;
    padding: 4px;
    border-radius: 10px;
    background: var(--inset);
  }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    text-align: left;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
  }
  .menu button:hover {
    background: var(--hover);
  }
  .menu .danger {
    color: var(--danger);
  }
  .meta {
    margin: 4px 8px 2px;
    font-size: 10.5px;
    color: var(--muted);
  }
</style>
