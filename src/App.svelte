<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { app, init, refresh, refreshIfStale, visibleDevices } from "./lib/store.svelte";
  import AddDevice from "./lib/AddDevice.svelte";
  import DeviceCard from "./lib/DeviceCard.svelte";
  import Icon from "./lib/Icon.svelte";
  import ScenesView from "./lib/ScenesView.svelte";
  import Settings from "./lib/Settings.svelte";

  type View = "devices" | "scenes" | "add" | "settings";
  let view = $state<View>("devices");
  let panel: HTMLElement;

  onMount(() => {
    void init();
    // Size the native window to the content so the widget never has empty transparent space.
    const ro = new ResizeObserver(() => {
      void invoke("fit_height", { height: Math.ceil(panel.getBoundingClientRect().height) + 2 });
    });
    ro.observe(panel);
    return () => ro.disconnect();
  });

  const devices = $derived(visibleDevices());
</script>

<main bind:this={panel} class="panel" onpointerenter={() => refreshIfStale()}>
  <header data-tauri-drag-region>
    {#if view === "devices" || view === "scenes"}
      <div class="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === "devices"} class:sel={view === "devices"} onclick={() => (view = "devices")}>Devices</button>
        <button type="button" role="tab" aria-selected={view === "scenes"} class:sel={view === "scenes"} onclick={() => (view = "scenes")}>Scenes</button>
      </div>
    {:else}
      <span class="brand" data-tauri-drag-region>Lightdeck</span>
    {/if}
    <span class="grow" data-tauri-drag-region></span>
    <button type="button" class="icon-btn" class:spin={app.refreshing} aria-label="Refresh" title="Refresh" onclick={() => refresh()}>
      <Icon name="refresh" />
    </button>
    <button type="button" class="icon-btn" aria-label="Add device" title="Add device" onclick={() => (view = "add")}>
      <Icon name="plus" />
    </button>
    <button type="button" class="icon-btn" aria-label="Settings" title="Settings" onclick={() => (view = "settings")}>
      <Icon name="gear" />
    </button>
    {#if app.config.settings.mode !== "desktop"}
      <button type="button" class="icon-btn" aria-label="Hide" title="Hide" onclick={() => invoke("hide_widget")}>
        <Icon name="close" />
      </button>
    {/if}
  </header>

  {#if app.engine === "restarting"}
    <div class="banner">Reconnecting to the Matter engine...</div>
  {:else if app.engine === "error"}
    <div class="banner error">{app.engineError}</div>
  {/if}

  <div class="body">
    {#if view === "add"}
      <AddDevice onclose={() => (view = "devices")} />
    {:else if view === "settings"}
      <Settings onclose={() => (view = "devices")} />
    {:else if view === "scenes"}
      <ScenesView />
    {:else if !app.loaded || (app.engine === "starting" && !app.devices.length)}
      <p class="muted center"><span class="spinner"></span> Starting...</p>
    {:else if !devices.length}
      <div class="empty">
        <Icon name="bulb" size={28} />
        <p>No devices yet.</p>
        <button type="button" class="btn primary" onclick={() => (view = "add")}><Icon name="plus" size={14} /> Add a Matter device</button>
      </div>
    {:else}
      {#each devices as device (device.id)}
        <DeviceCard {device} />
      {/each}
    {/if}
  </div>

  {#if app.toast}
    <div class="toast" role="status">{app.toast}</div>
  {/if}
</main>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    max-height: 716px;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 18px;
    overflow: hidden;
    position: relative;
  }
  header {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 8px 6px 10px;
    cursor: default;
  }
  .grow {
    flex: 1;
    align-self: stretch;
  }
  .brand {
    font-weight: 600;
    padding-left: 2px;
  }
  .tabs {
    display: flex;
    gap: 2px;
    background: var(--track);
    padding: 2px;
    border-radius: 9px;
  }
  .tabs button {
    border: 0;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    padding: 4px 12px;
    border-radius: 7px;
    cursor: pointer;
  }
  .tabs button.sel {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.15);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 10px 10px;
    overflow-y: auto;
    min-height: 0;
  }
  .banner {
    margin: 0 10px 6px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--inset);
    font-size: 12px;
  }
  .banner.error {
    color: var(--danger);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 18px 0 10px;
    color: var(--muted);
  }
  .empty p {
    margin: 0;
  }
  .center {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 18px 0;
  }
  .toast {
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 10px;
    padding: 8px 12px;
    border-radius: 10px;
    background: var(--toast-bg);
    color: var(--toast-text);
    font-size: 12px;
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.25);
  }
  .spin :global(svg) {
    animation: spin 0.9s linear infinite;
  }
</style>
