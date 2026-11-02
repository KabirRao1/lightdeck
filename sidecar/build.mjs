// Bundles the sidecar into a single ESM file and copies the Node.js runtime next to it so the desktop app can ship
// both inside its installer (end users never need Node.js installed).
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tauriDir = path.join(here, "..", "src-tauri");
const outDir = path.join(tauriDir, "sidecar");
mkdirSync(outDir, { recursive: true });

await build({
    entryPoints: [path.join(here, "src", "main.ts")],
    outfile: path.join(outDir, "matter-sidecar.mjs"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    minify: true,
    keepNames: true, // matter.js relies on class/function names at runtime
    legalComments: "linked",
    // Bluetooth support is optional in matter.js and not used (Wi-Fi/Ethernet devices only).
    plugins: [
        {
            // matter.js has an optional Bun-only SQLite backend; replace it with an empty stub under Node.
            name: "stub-bun",
            setup(b) {
                b.onResolve({ filter: /^bun:/ }, args => ({ path: args.path, namespace: "bun-stub" }));
                b.onLoad({ filter: /.*/, namespace: "bun-stub" }, () => ({
                    contents: "export const Database = undefined; export const constants = {}; export default {};",
                    loader: "js",
                }));
            },
        },
    ],
    external: ["@stoprocent/noble", "@stoprocent/bleno", "@abandonware/noble", "@abandonware/bleno"],
    // Allow bundled CommonJS dependencies to use require() inside an ESM bundle.
    banner: {
        js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
    },
    logLevel: "info",
});

// Tauri "externalBin" convention: binaries/<name>-<target-triple>.exe
const binDir = path.join(tauriDir, "binaries");
mkdirSync(binDir, { recursive: true });
const triple = process.env.TAURI_TARGET_TRIPLE ?? "x86_64-pc-windows-msvc";
copyFileSync(process.execPath, path.join(binDir, `lightdeck-engine-${triple}.exe`));
console.log(`Copied Node.js ${process.version} runtime for ${triple}`);
