<script lang="ts">
  import { allDevices, app, applyScene } from "./store.svelte";
  import { colorCss } from "./color";
  import type { Scene } from "./types";
  import Icon from "./Icon.svelte";
  import SceneEditor from "./SceneEditor.svelte";

  let editing = $state<Scene | "new" | null>(null);
  let running = $state<string | null>(null);

  async function run(scene: Scene) {
    running = scene.id;
    await applyScene(scene);
    running = null;
  }

  function dots(scene: Scene) {
    return scene.actions.slice(0, 6).map(a => (!a.on ? "var(--off)" : a.color ? colorCss(a.color) : "#ffd27a"));
  }
</script>

{#if editing}
  <SceneEditor scene={editing === "new" ? undefined : editing} onclose={() => (editing = null)} />
{:else}
  <div class="quick">
    <button type="button" class="btn" onclick={() => allDevices(true)}><Icon name="power" size={14} /> All on</button>
    <button type="button" class="btn" onclick={() => allDevices(false)}><Icon name="power" size={14} /> All off</button>
  </div>

  <div class="grid">
    {#each app.config.scenes as scene (scene.id)}
      <div class="scene" class:running={running === scene.id}>
        <button type="button" class="run" onclick={() => run(scene)} title={`Apply ${scene.name}`}>
          <span class="dots">
            {#each dots(scene) as c, i (i)}
              <span style:background={c}></span>
            {/each}
          </span>
          <span class="sname">{scene.name}</span>
          <span class="count">{scene.actions.length} device{scene.actions.length === 1 ? "" : "s"}</span>
        </button>
        <button type="button" class="edit icon-btn" aria-label={`Edit ${scene.name}`} onclick={() => (editing = scene)}>
          <Icon name="edit" size={13} />
        </button>
      </div>
    {/each}
    <button type="button" class="scene add" onclick={() => (editing = "new")}>
      <Icon name="plus" size={18} />
      <span>New scene</span>
    </button>
  </div>
  {#if !app.config.scenes.length}
    <p class="muted hint">Scenes set several devices at once: power, brightness and color. Create one with “New scene”.</p>
  {/if}
{/if}

<style>
  .quick {
    display: flex;
    gap: 8px;
  }
  .quick .btn {
    flex: 1;
    justify-content: center;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .scene {
    position: relative;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--surface);
    min-height: 74px;
  }
  .scene.running {
    border-color: var(--accent);
  }
  .run {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 10px 12px;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    border-radius: 14px;
  }
  .run:hover {
    background: var(--hover);
  }
  .dots {
    display: flex;
    gap: 3px;
    height: 12px;
  }
  .dots span {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid rgb(0 0 0 / 0.15);
  }
  .sname {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .count {
    font-size: 11px;
    color: var(--muted);
  }
  .edit {
    position: absolute;
    top: 6px;
    right: 6px;
    opacity: 0;
  }
  .scene:hover .edit,
  .edit:focus-visible {
    opacity: 1;
  }
  .add {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    border-style: dashed;
    color: var(--muted);
    font: inherit;
    cursor: pointer;
  }
  .add:hover {
    color: var(--text);
    background: var(--hover);
  }
  .hint {
    font-size: 12px;
    text-align: center;
    margin: 4px 8px 0;
  }
</style>
