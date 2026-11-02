<script lang="ts">
  import { app, commission, deviceSettings, saveConfig } from "./store.svelte";
  import type { Device } from "./types";
  import Icon from "./Icon.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let code = $state("");
  let busy = $state(false);
  let error = $state("");
  let added = $state<Device[]>([]);
  let names = $state<Record<string, string>>({});

  const cleaned = $derived(code.trim().toUpperCase().startsWith("MT:") ? code.trim() : code.replace(/\D/g, ""));
  const valid = $derived(cleaned.startsWith("MT:") ? cleaned.length > 10 : cleaned.length === 11 || cleaned.length === 21);

  async function pair() {
    if (!valid || busy) return;
    busy = true;
    error = "";
    try {
      added = await commission(cleaned);
      for (const d of added) names[d.id] = d.name;
      if (!added.length) error = "Paired, but the device has no lights or outlets this app can control.";
    } catch (e) {
      error = friendly(String(e));
    } finally {
      busy = false;
    }
  }

  function friendly(message: string) {
    if (/timed out|not found|no device|discover/i.test(message))
      return "Couldn't find the device. Make sure pairing mode is still open (codes from Alexa/Google expire after a few minutes), the device is on the same network as this PC, and that Windows allowed “Node.js JavaScript Runtime” (Lightdeck's engine) on private networks.";
    if (/checksum|invalid/i.test(message)) return "That code doesn't look right. Double-check the digits.";
    if (/passcode|PASE|authentication/i.test(message)) return "The device rejected the code. Generate a fresh code and try again.";
    return message;
  }

  function finish() {
    for (const d of added) {
      const name = names[d.id]?.trim();
      if (name && name !== d.name) deviceSettings(d.id).name = name;
    }
    saveConfig();
    onclose();
  }
</script>

<section class="add">
  <div class="top">
    <button type="button" class="icon-btn" aria-label="Back" onclick={onclose} disabled={busy}><Icon name="back" /></button>
    <h2>Add a Matter device</h2>
  </div>

  {#if added.length}
    <p class="ok"><Icon name="check" size={14} /> Paired! Give {added.length === 1 ? "it" : "them"} a name:</p>
    {#each added as d (d.id)}
      <label class="field">
        <span class="muted">{d.kind === "plug" ? "Plug" : "Light"} · {d.product ?? d.vendor ?? ""}</span>
        <input bind:value={names[d.id]} maxlength="40" />
      </label>
    {/each}
    <div class="actions"><span class="spacer"></span><button type="button" class="btn primary" onclick={finish}>Done</button></div>
  {:else}
    <ol class="steps">
      <li>
        <strong>Already in Alexa, Google Home, Apple Home or SmartThings?</strong>
        Open the device's settings in that app and choose <em>Other assistants and apps</em> / <em>Linked Matter apps</em> → <em>Add</em>. It shows a fresh 11-digit code.
      </li>
      <li>
        <strong>Brand-new device?</strong> Use the 11-digit code printed on the device or its box (or the QR code text, starting with <code>MT:</code>).
      </li>
    </ol>

    <label class="field">
      <span class="muted">Pairing code</span>
      <input
        placeholder="1234-567-8901"
        bind:value={code}
        disabled={busy}
        spellcheck="false"
        autocomplete="off"
        onkeydown={e => e.key === "Enter" && pair()}
      />
    </label>

    {#if busy}
      <p class="status"><span class="spinner"></span>{app.pairingStatus || "Pairing..."} This can take up to a minute.</p>
    {/if}
    {#if error}
      <p class="error">{error}</p>
    {/if}

    <div class="actions">
      <span class="muted small"><Icon name="wifi" size={13} /> Same network as this PC</span>
      <span class="spacer"></span>
      <button type="button" class="btn primary" disabled={!valid || busy} onclick={pair}>{busy ? "Pairing..." : "Pair device"}</button>
    </div>
  {/if}
</section>

<style>
  .add {
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
  .steps {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .steps strong {
    color: var(--text);
    display: block;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }
  .field input {
    font-size: 15px;
    letter-spacing: 0.04em;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    margin: 0;
  }
  .error {
    margin: 0;
    font-size: 12px;
    color: var(--danger);
  }
  .ok {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--ok);
    font-weight: 600;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .spacer {
    flex: 1;
  }
  .small {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }
</style>
