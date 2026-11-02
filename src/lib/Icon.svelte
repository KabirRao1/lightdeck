<script lang="ts">
  const paths = {
    power: "M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0",
    plus: "M12 5v14M5 12h14",
    gear: "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4L10.6 6a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4z",
    refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
    chevron: "M6 9l6 6 6-6",
    back: "M15 6l-6 6 6 6",
    dots: "M5 12h.01M12 12h.01M19 12h.01",
    close: "M6 6l12 12M18 6L6 18",
    bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3z",
    plug: "M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0zM12 16v5",
    sun: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
    edit: "M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4",
    check: "M5 12l5 5L20 7",
    play: "M8 5v14l11-7z",
    eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    up: "M12 19V5M6 11l6-6 6 6",
    down: "M12 5v14M6 13l6 6 6-6",
    wifi: "M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M2 9a15 15 0 0 1 20 0",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
  } as const;

  let { name, size = 16 }: { name: keyof typeof paths; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={name === "play" ? "currentColor" : "none"}
  stroke="currentColor"
  stroke-width={name === "dots" ? 3.2 : 1.9}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={paths[name]} />
</svg>
