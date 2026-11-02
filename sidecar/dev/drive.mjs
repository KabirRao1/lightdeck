// Dev test driver: spawns the sidecar (via tsx) and runs a list of requests, printing responses.
// Usage: node dev/drive.mjs <storageDir> '<json array of {method, params}>'
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const [storage, script] = process.argv.slice(2);
const steps = JSON.parse(script);
const entry = process.env.SIDECAR_BUNDLE ? [process.env.SIDECAR_BUNDLE] : ["--import", "tsx", "src/main.ts"];
const child = spawn(process.env.SIDECAR_NODE ?? process.execPath, [...entry, "--storage", storage], {
    stdio: ["pipe", "pipe", "pipe"],
});
child.stderr.on("data", d => process.stderr.write(`[sidecar] ${d}`));
const rl = createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();
rl.on("line", line => {
    const msg = JSON.parse(line);
    if (msg.event) {
        console.log("EVENT", JSON.stringify(msg));
        if (msg.event === "ready") run();
        return;
    }
    pending.get(msg.id)?.(msg);
});
const call = (method, params) =>
    new Promise(resolve => {
        const id = nextId++;
        pending.set(id, resolve);
        child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });

async function run() {
    for (const step of steps) {
        const t = Date.now();
        const res = await call(step.method, step.params);
        console.log(`${step.method} (${Date.now() - t} ms) ->`, JSON.stringify(res));
    }
    await call("shutdown", {});
}
child.on("exit", code => {
    console.log("sidecar exited", code);
    process.exit(0);
});
