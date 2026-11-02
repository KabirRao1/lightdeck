<script lang="ts">
  import { actionToParams, app, deleteScene, displayName, newId, runActions, saveScene, sortedDevices } from "./store.svelte";
  import { stateToColor } from "./color";
  import type { ColorValue, Device, Scene, SceneAction } from "./types";
  import ColorControls from "./ColorControls.svelte";
  import Icon from "./Icon.svelte";
  import Toggle from "./Toggle.svelte";

  let { scene, onclose }: { scene?: Scene; onclose: () => void } = $props();

  const isNew = !scene;
  let name = $state(scene?.name ?? "");
  // Draft action per device; `included` tracks which devices are part of the scene.
  let drafts = $state<Record<string, SceneAction & { included: boolean }>>({});

  for (const d of sortedDevices()) {
    const existing = scene?.actions.find(a => a.id === d.id);
    drafts[d.id] = existing
      ? { ...($state.snapshot(existing) as SceneAction), included: true }
      : { ...fromDevice(d), included: isNew };
  }

  function fromDevice(d: Device): SceneAction {
    const hasColor = d.caps.hs || d.caps.xy || d.caps.ct;
    return {
      id: d.id,
      on: d.state.on ?? true,
      level: d.caps.dimmable ? d.state.level ?? 100 : undefined,
      color: hasColor ? stateToColor(d.state) : undefined,
    };
  }

  function captureCurrent() {
    for (const d of app.devices) {
      if (drafts[d.id]?.included) drafts[d.id] = { ...fromDevice(d), included: true };
    }
  }

  function actions(): SceneAction[] {
    return Object.values(drafts)
      .filter(a => a.included)
      .map(({ included: _, ...a }) => $state.snapshot(a) as SceneAction);
  }

  function preview() {
    void runActions(actions().map(a => actionToParams(a, app.devices.find(d => d.id === a.id))));
  }

  function save() {
    saveScene({ id: scene?.id ?? newId(), name: name.trim() || "Scene", actions: actions() });
    onclose();
  }

  const count = $derived(Object.values(drafts).filter(a => a.included).length);
</script>

<section class="editor">
  <div class="top">
    <button type="button" class="icon-btn" aria-label="Back" onclick={onclose}><Icon name="back" /></button>
    <!-- svelte-ignore a11y_autofocus -->
    <input class="name" placeholder="Scene name (e.g. Movie night)" bind:value={name} maxlength="32" autofocus={isNew} />
  </div>

  <div class="tools">
    <button type="button" class="link" onclick={captureCurrent}>Use current light settings</button>
    <button type="button" class="link" onclick={preview}><Icon name="play" size={10} /> Preview</button>
  </div>

  {#if !app.devices.length}
    <p class="muted empty">Add a device first, then build scenes from it.</p>
  {/if}

  <div class="list">
    {#each sortedDevices() as d (d.id)}
      {@const a = drafts[d.id]}
      {#if a}
        <div class="row" class:included={a.included}>
          <label class="head">
            <input type="checkbox" bind:checked={a.included} />
            <span class="dname">{displayName(d)}</span>
            {#if a.included}
              <span class="state">{a.on ? "On" : "Off"}</span>
              <Toggle checked={a.on} label="On in this scene" onchange={v => (a.on = v)} />
            {/if}
          </label>
          {#if a.included && a.on}
            {#if d.caps.dimmable}
              <div class="level">
                <Icon name="sun" size={14} />
                <input
                  type="range"
                  min="1"
                  max="100"
                  class="fill"
                  value={a.level ?? 100}
                  style:--fill={`${a.level ?? 100}%`}
                  aria-label="Brightness in this scene"
                  oninput={e => (a.level = +e.currentTarget.value)}
                />
                <span class="pct">{a.level ?? 100}%</span>
              </div>
            {/if}
            {#if a.color}
              <ColorControls value={a.color} caps={d.caps} compact onchange={(c: ColorValue) => (a.color = c)} />
            {/if}
          {/if}
        </div>
      {/if}
    {/each}
  </div>

  <div class="actions">
    {#if !isNew && scene}
      <button type="button" class="btn ghost danger" onclick={() => { deleteScene(scene.id); onclose(); }}>
        <Icon name="trash" size={14} /> Delete
      </button>
    {/if}
    <span class="spacer"></span>
    <button type="button" class="btn ghost" onclick={onclose}>Cancel</button>
    <button type="button" class="btn primary" disabled={!count} onclick={save}>
      <Icon name="check" size={14} /> Save scene
    </button>
  </div>
</section>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .name {
    flex: 1;
    font-weight: 600;
  }
  .tools {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--surface);
    opacity: 0.7;
  }
  .row.included {
    opacity: 1;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  .dname {
    flex: 1;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .state {
    font-size: 11px;
    color: var(--muted);
  }
  .level {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
  }
  .pct {
    width: 34px;
    text-align: right;
    font-size: 11px;
  }
  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .spacer {
    flex: 1;
  }
  .empty {
    text-align: center;
    padding: 12px;
  }
</style>
