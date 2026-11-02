/**
 * Lightdeck sidecar.
 *
 * A small Matter controller (built on matter.js) that the desktop app talks to over stdin/stdout using JSON lines:
 *
 *   request : {"id": 1, "method": "list", "params": {...}}
 *   response: {"id": 1, "ok": true, "result": ...} | {"id": 1, "ok": false, "error": "message"}
 *   event   : {"event": "ready" | "status", "data": ...}
 *
 * Usage: node matter-sidecar.mjs --storage <dir>
 */
import { send } from "./stdio.js";

import { ControllerBehavior, Endpoint, Environment, Logger, ServerNode, Seconds } from "@matter/main";
import { QrPairingCodeCodec } from "@matter/types";
import type { ClientNode } from "@matter/main";
import { createInterface } from "node:readline";
import { hsFromMatter, hsToMatter, hsToXy, kelvinToMireds, miredsToKelvin, xyToHs, clamp } from "./color.js";

// ---------------------------------------------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const storageDir = argValue("--storage");
if (storageDir) Environment.default.vars.set("path.root", storageDir);
Logger.level = (argValue("--log-level") ?? "warn") as any;

function argValue(name: string) {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
}

const COMMAND_TIMEOUT_MS = 8000;
const REFRESH_TIMEOUT_MS = 5000;

/** Matter device type ids we treat as plugs / switches. Everything else with OnOff is treated as a light. */
const PLUG_DEVICE_TYPES = new Set([0x010a, 0x010b, 0x0103 /* on/off light switch (as actuator) */]);
const LIGHT_DEVICE_TYPES = new Set([0x0100, 0x0101, 0x010c, 0x010d]);

let controller: ServerNode;

// ---------------------------------------------------------------------------------------------------------------
// Device model sent to the UI
// ---------------------------------------------------------------------------------------------------------------

interface DeviceInfo {
    id: string; // "<nodeId>/<endpoint>"
    nodeId: string;
    endpoint: number;
    kind: "light" | "plug";
    name: string;
    vendor?: string;
    product?: string;
    reachable: boolean;
    caps: {
        dimmable: boolean;
        hs: boolean;
        xy: boolean;
        ct: boolean;
        ctMinKelvin?: number;
        ctMaxKelvin?: number;
    };
    state: {
        on?: boolean;
        level?: number; // 1-100 %
        mode?: "hs" | "ct";
        hue?: number; // 0-360
        sat?: number; // 0-100
        kelvin?: number;
    };
}

interface SetParams {
    id: string;
    on?: boolean;
    level?: number; // 1-100
    hue?: number;
    sat?: number;
    kelvin?: number;
    transition?: number; // tenths of a second
}

const unreachable = new Set<string>();

function nodeIdOf(client: ClientNode) {
    const nodeId = client.peerAddress?.nodeId;
    return nodeId === undefined ? client.id : BigInt(nodeId).toString(16).toUpperCase();
}

function findClient(nodeId: string) {
    return controller.peers.commissioned.find(c => nodeIdOf(c) === nodeId);
}

function findEndpoint(id: string) {
    const [nodeId, ep] = id.split("/");
    const client = findClient(nodeId);
    if (!client) throw new Error(`Unknown device ${nodeId}`);
    const endpoint = client.endpoints.find(e => e.number === Number(ep));
    if (!endpoint) throw new Error(`Device ${nodeId} has no endpoint ${ep}`);
    return { client, endpoint };
}

/** Control endpoints of a node: every non-root endpoint that has an OnOff cluster. */
function controlEndpoints(client: ClientNode) {
    return client.endpoints.filter(e => e.number !== 0 && e.maybeStateOf("onOff") !== undefined);
}

function describe(client: ClientNode, endpoint: Endpoint): DeviceInfo {
    const nodeId = nodeIdOf(client);
    const id = `${nodeId}/${endpoint.number}`;
    const basic = client.maybeStateOf("basicInformation") as Record<string, any> | undefined;
    const bridged = endpoint.maybeStateOf("bridgedDeviceBasicInformation") as Record<string, any> | undefined;
    const descriptor = endpoint.maybeStateOf("descriptor") as Record<string, any> | undefined;
    const onOff = endpoint.maybeStateOf("onOff") as Record<string, any> | undefined;
    const level = endpoint.maybeStateOf("levelControl") as Record<string, any> | undefined;
    const color = endpoint.maybeStateOf("colorControl") as Record<string, any> | undefined;

    const deviceTypes: number[] = (descriptor?.deviceTypeList ?? []).map((d: any) => Number(d.deviceType));
    const isPlug =
        deviceTypes.some(t => PLUG_DEVICE_TYPES.has(t)) && !deviceTypes.some(t => LIGHT_DEVICE_TYPES.has(t));

    const capsBits = color?.colorCapabilities ?? {};
    const caps: DeviceInfo["caps"] = {
        dimmable: level !== undefined,
        hs: color !== undefined && !!capsBits.hueSaturation,
        xy: color !== undefined && !!capsBits.xy,
        ct: color !== undefined && !!capsBits.colorTemperature,
    };
    if (caps.ct) {
        caps.ctMinKelvin = miredsToKelvin(color?.colorTempPhysicalMaxMireds ?? 500);
        caps.ctMaxKelvin = miredsToKelvin(color?.colorTempPhysicalMinMireds ?? 153);
    }

    const state: DeviceInfo["state"] = { on: onOff?.onOff };
    if (level?.currentLevel != null) state.level = clamp(Math.round((level.currentLevel / 254) * 100), 1, 100);
    if (color) {
        const mode = color.colorMode as number | undefined; // 0 = hue/sat, 1 = xy, 2 = color temperature
        if (mode === 2 && caps.ct) {
            state.mode = "ct";
            state.kelvin = miredsToKelvin(color.colorTemperatureMireds);
        } else if (mode === 1 && caps.xy) {
            state.mode = "hs";
            Object.assign(state, renameHs(xyToHs(color.currentX, color.currentY)));
        } else if (caps.hs) {
            state.mode = "hs";
            Object.assign(state, renameHs(hsFromMatter(color.currentHue ?? 0, color.currentSaturation ?? 0)));
        }
    }

    const name =
        bridged?.nodeLabel || bridged?.productName || basic?.nodeLabel || basic?.productLabel || basic?.productName;
    return {
        id,
        nodeId,
        endpoint: endpoint.number,
        kind: isPlug ? "plug" : "light",
        name: name || `Matter device ${nodeId}`,
        vendor: bridged?.vendorName ?? basic?.vendorName,
        product: bridged?.productName ?? basic?.productName,
        reachable: !unreachable.has(nodeId),
        caps,
        state,
    };
}

function renameHs(hs: { hue: number; sat: number }) {
    return { hue: hs.hue, sat: hs.sat };
}

function listDevices(): DeviceInfo[] {
    const devices: DeviceInfo[] = [];
    for (const client of controller.peers.commissioned) {
        for (const endpoint of controlEndpoints(client)) devices.push(describe(client, endpoint));
    }
    return devices;
}

// ---------------------------------------------------------------------------------------------------------------
// Device operations
// ---------------------------------------------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
    let timer: NodeJS.Timeout;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
        }),
    ]);
}

/** Read the live control state of one endpoint into the local cache. */
async function readEndpoint(ep: Endpoint) {
    await ep.getStateOf("onOff", ["onOff"]);
    if (ep.maybeStateOf("levelControl")) await ep.getStateOf("levelControl", ["currentLevel"]);
    if (ep.maybeStateOf("colorControl")) {
        const color = ep.maybeStateOf("colorControl") as Record<string, any>;
        const attrs = ["colorMode"];
        if (color.colorCapabilities?.hueSaturation) attrs.push("currentHue", "currentSaturation");
        if (color.colorCapabilities?.xy) attrs.push("currentX", "currentY");
        if (color.colorCapabilities?.colorTemperature) attrs.push("colorTemperatureMireds");
        await ep.getStateOf("colorControl", attrs).catch(() => undefined); // tolerate partial support
    }
}

/** Read fresh state from the devices (state is otherwise served from the local cache). */
async function refresh(nodeIds?: string[]) {
    const clients = controller.peers.commissioned.filter(c => !nodeIds || nodeIds.includes(nodeIdOf(c)));
    await Promise.all(
        clients.map(async client => {
            const nodeId = nodeIdOf(client);
            try {
                await withTimeout(
                    Promise.all(controlEndpoints(client).map(readEndpoint)),
                    REFRESH_TIMEOUT_MS,
                    `Refreshing ${nodeId}`,
                );
                unreachable.delete(nodeId);
            } catch (error) {
                unreachable.add(nodeId);
                console.warn(`refresh ${nodeId} failed:`, String(error));
            }
        }),
    );
    return listDevices();
}

const OPTIONS = { optionsMask: { executeIfOff: true }, optionsOverride: { executeIfOff: true } };

async function setDevice(p: SetParams) {
    const { client, endpoint } = findEndpoint(p.id);
    const nodeId = nodeIdOf(client);
    const transitionTime = p.transition ?? 4;
    const color = endpoint.maybeStateOf("colorControl") as Record<string, any> | undefined;
    const run = async () => {
        // Turning off: just do that (ignore color/level so lights fade out cleanly).
        if (p.on === false) {
            await endpoint.commandsOf("onOff").off(undefined);
            return;
        }
        if (p.on === true && p.level === undefined) await endpoint.commandsOf("onOff").on(undefined);
        if (p.level !== undefined && endpoint.maybeStateOf("levelControl")) {
            const level = clamp(Math.round((p.level / 100) * 254), 1, 254);
            await endpoint
                .commandsOf("levelControl")
                .moveToLevelWithOnOff({ level, transitionTime, optionsMask: {}, optionsOverride: {} });
        } else if (p.level !== undefined) {
            await endpoint.commandsOf("onOff").on(undefined);
        }
        if (color && p.kelvin !== undefined) {
            const colorTemperatureMireds = kelvinToMireds(
                p.kelvin,
                color.colorTempPhysicalMinMireds ?? 153,
                color.colorTempPhysicalMaxMireds ?? 500,
            );
            await endpoint
                .commandsOf("colorControl")
                .moveToColorTemperature({ colorTemperatureMireds, transitionTime, ...OPTIONS });
        } else if (color && p.hue !== undefined) {
            const hs = { hue: p.hue, sat: p.sat ?? 100 };
            if (color.colorCapabilities?.hueSaturation) {
                await endpoint
                    .commandsOf("colorControl")
                    .moveToHueAndSaturation({ ...hsToMatter(hs), transitionTime, ...OPTIONS });
            } else {
                await endpoint.commandsOf("colorControl").moveToColor({ ...hsToXy(hs), transitionTime, ...OPTIONS });
            }
        }
    };
    try {
        await withTimeout(run(), COMMAND_TIMEOUT_MS, `Controlling ${client.id}`);
        unreachable.delete(nodeId);
        // Read back what the device actually did (e.g. clamped values) so the UI shows the truth.
        await withTimeout(readEndpoint(endpoint), REFRESH_TIMEOUT_MS, "Reading state").catch(() => undefined);
    } catch (error) {
        unreachable.add(nodeId);
        throw error;
    }
    return describe(client, endpoint);
}

async function commission(code: string) {
    // QR payloads ("MT:...") are used as-is; manual codes may be typed with spaces or dashes.
    const trimmed = code.trim();
    const pairingCode = trimmed.toUpperCase().startsWith("MT:") ? trimmed : trimmed.replace(/\D/g, "");
    if (!pairingCode.startsWith("MT:") && pairingCode.length !== 11 && pairingCode.length !== 21) {
        throw new Error("Pairing codes are 11 or 21 digits (or a QR payload starting with MT:)");
    }
    // QR payloads carry the full discriminator plus vendor/product, which makes discovery unambiguous.
    let codeOptions: Record<string, unknown>;
    if (pairingCode.startsWith("MT:")) {
        const [qr] = QrPairingCodeCodec.decode(pairingCode.toUpperCase());
        if (!qr) throw new Error("Could not read that QR code payload");
        codeOptions = {
            passcode: qr.passcode,
            longDiscriminator: qr.discriminator,
            discriminator: qr.discriminator,
            ...(qr.vendorId ? { vendorId: qr.vendorId } : {}),
            ...(qr.productId ? { productId: qr.productId } : {}),
        };
    } else {
        codeOptions = { pairingCode };
    }
    const before = new Set(controller.peers.commissioned.map(nodeIdOf));
    send({ event: "status", data: { phase: "searching", message: "Looking for the device on your network..." } });
    const client = (await controller.peers.commission({
        ...codeOptions,
        autoSubscribe: false,
        timeout: Seconds(90),
    } as any)) as ClientNode;
    send({ event: "status", data: { phase: "done", message: "Paired" } });
    const nodeId = nodeIdOf(client);
    if (before.has(nodeId)) console.warn(`node ${nodeId} was already commissioned`);
    return controlEndpoints(client).map(ep => describe(client, ep));
}

async function remove(nodeId: string) {
    const client = findClient(nodeId);
    if (!client) return { removed: false };
    try {
        await withTimeout(client.decommission(), COMMAND_TIMEOUT_MS, "Removing device");
    } catch (error) {
        // Unreachable devices can't confirm; drop them locally anyway.
        console.warn(`decommission failed, deleting locally: ${error}`);
        await client.delete();
    }
    unreachable.delete(nodeId);
    return { removed: true };
}

async function identify(id: string) {
    const { endpoint } = findEndpoint(id);
    if (endpoint.maybeStateOf("identify")) {
        await withTimeout(
            endpoint.commandsOf("identify").identify({ identifyTime: 5 }),
            COMMAND_TIMEOUT_MS,
            "Identify",
        );
        return { ok: true };
    }
    // Fallback: blink by toggling twice.
    const onOff = endpoint.commandsOf("onOff");
    for (let i = 0; i < 4; i++) {
        await onOff.toggle(undefined);
        await new Promise(r => setTimeout(r, 400));
    }
    return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------------------------------------------

type Handler = (params: any) => Promise<unknown> | unknown;

const handlers: Record<string, Handler> = {
    ping: () => "pong",
    list: () => listDevices(),
    refresh: (p: { nodeIds?: string[] }) => refresh(p?.nodeIds),
    commission: (p: { code: string }) => commission(p.code),
    remove: (p: { nodeId: string }) => remove(p.nodeId),
    set: (p: SetParams) => setDevice(p),
    /** Apply many settings at once (a scene). Partial failures are reported per device. */
    setMany: async (p: { actions: SetParams[] }) => {
        const results = await Promise.allSettled(p.actions.map(a => setDevice(a)));
        return results.map((r, i) => ({
            id: p.actions[i].id,
            ok: r.status === "fulfilled",
            error: r.status === "rejected" ? errorMessage(r.reason) : undefined,
            device: r.status === "fulfilled" ? r.value : undefined,
        }));
    },
    identify: (p: { id: string }) => identify(p.id),
    shutdown: async () => {
        setTimeout(() => void shutdown(), 10);
        return true;
    },
};

function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
}

async function handleLine(line: string) {
    if (!line.trim()) return;
    let request: { id?: number; method?: string; params?: unknown };
    try {
        request = JSON.parse(line);
    } catch {
        send({ id: null, ok: false, error: "Invalid JSON" });
        return;
    }
    const { id, method = "", params } = request;
    const handler = handlers[method];
    if (!handler) {
        send({ id, ok: false, error: `Unknown method ${method}` });
        return;
    }
    try {
        send({ id, ok: true, result: await handler(params ?? {}) });
    } catch (error) {
        console.error(`${method} failed:`, error instanceof Error ? error.stack : error);
        send({ id, ok: false, error: errorMessage(error) });
    }
}

let shuttingDown = false;
async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
        await withTimeout(controller?.close() ?? Promise.resolve(), 3000, "shutdown");
    } catch {
        // ignore
    }
    process.exit(0);
}

async function main() {
    controller = await ServerNode.create(ServerNode.RootEndpoint.with(ControllerBehavior), {
        id: "lightdeck",
        network: { ble: false },
        commissioning: { enabled: false },
        subscriptions: { persistenceEnabled: false },
        controller: { adminFabricLabel: "Lightdeck" },
        basicInformation: {
            vendorName: "Lightdeck",
            productName: "Lightdeck",
            nodeLabel: "Lightdeck",
            hardwareVersion: 1,
            softwareVersion: 1,
            softwareVersionString: "0.1.0",
        },
    } as any);
    await controller.start();

    const rl = createInterface({ input: process.stdin });
    rl.on("line", line => void handleLine(line));
    rl.on("close", () => void shutdown()); // parent app exited
    process.on("SIGINT", () => void shutdown());
    process.on("SIGTERM", () => void shutdown());

    send({ event: "ready", data: { devices: listDevices() } });
}

main().catch(error => {
    send({ event: "fatal", data: { error: errorMessage(error) } });
    console.error(error);
    process.exit(1);
});
