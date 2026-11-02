// Regenerates the README screenshots in docs/screenshots from the real UI, using a mocked backend.
//
//   npm run dev                  # in one terminal (serves the UI on http://localhost:1420)
//   npm run screenshots          # in another; uses your installed Microsoft Edge
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "docs", "screenshots");
mkdirSync(out, { recursive: true });
const mock = readFileSync(path.join(here, "mock-tauri.js"), "utf8");
const url = process.env.UI_URL ?? "http://localhost:1420";

const browser = await chromium.launch({ channel: "msedge" });

async function open(theme, { width = 342, height = 900, background } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme });
  await page.addInitScript(mock);
  await page.goto(`${url}/?theme=${theme}`);
  await page.waitForSelector(".card");
  // No animations/caret in screenshots.
  await page.addStyleTag({ content: "*,*::before,*::after{transition:none!important;animation:none!important;caret-color:transparent!important}" });
  if (background) await page.addStyleTag({ content: `body::before{content:"";position:fixed;inset:0;z-index:-1;background:${background}}` });
  return page;
}

async function shotPanel(page, name) {
  await page.waitForTimeout(150);
  await page.locator("main.panel").screenshot({ path: path.join(out, `${name}.png`), omitBackground: true });
  console.log("saved", name);
}

for (const theme of ["dark", "light"]) {
  const page = await open(theme);
  await shotPanel(page, `devices-${theme}`);
  await page.close();
}

const dark = await open("dark");
// Color picker: expand the custom sliders on the second bulb (in "Color" mode).
await dark.locator(".card").nth(1).locator(".more").click();
await shotPanel(dark, "color-picker");
await dark.locator(".card").nth(1).locator(".more").click();

await dark.getByRole("tab", { name: "Scenes" }).click();
await shotPanel(dark, "scenes");

await dark.locator(".scene").first().hover();
await dark.getByRole("button", { name: "Edit Movie night" }).click();
await shotPanel(dark, "scene-editor");
await dark.getByRole("button", { name: "Cancel" }).click();

await dark.getByRole("button", { name: "Add device" }).click();
await dark.locator(".add input").fill("3497-011-2332");
await shotPanel(dark, "add-device");
await dark.getByRole("button", { name: "Back" }).click();

await dark.getByRole("button", { name: "Settings" }).click();
await shotPanel(dark, "settings");
await dark.close();

// Hero image: the widget sitting on a desktop wallpaper.
const hero = await open("dark", {
  width: 760,
  height: 420,
  background: "radial-gradient(circle at 20% 30%, #6b5bd6 0%, transparent 45%), radial-gradient(circle at 80% 80%, #e0794a 0%, transparent 50%), linear-gradient(135deg, #1d2b64, #2b1d4f)",
});
await hero.addStyleTag({ content: "html,body{overflow:visible!important} #app{width:342px;margin:24px 0 0 auto;padding:0 24px 40px 0;box-sizing:content-box} main.panel{box-shadow:0 18px 50px rgb(0 0 0 / .45)}" });
await hero.waitForTimeout(150);
const box = await hero.locator("main.panel").boundingBox();
await hero.screenshot({ path: path.join(out, "hero.png"), clip: { x: 0, y: 0, width: 760, height: Math.ceil(box.y + box.height + 24) } });
console.log("saved hero");

await browser.close();
