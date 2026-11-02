<script lang="ts">
  let {
    checked,
    onchange,
    label,
    disabled = false,
  }: { checked: boolean; onchange: (value: boolean) => void; label: string; disabled?: boolean } = $props();
</script>

<button
  type="button"
  class="toggle"
  class:on={checked}
  role="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => onchange(!checked)}
>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    position: relative;
    width: 38px;
    height: 22px;
    flex: none;
    border-radius: 11px;
    border: 1px solid var(--line-strong);
    background: var(--track);
    padding: 0;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .toggle.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--knob);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
    transition: transform 0.15s;
  }
  .on .knob {
    transform: translateX(16px);
    background: #fff;
  }
  .toggle:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
