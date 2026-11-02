/**
 * Development helper: runs a virtual Matter color light (or plug) on this PC so the sidecar can be
 * tested end-to-end without real hardware.
 *
 *   npx tsx dev/virtual-light.ts                 # color light, port 5541, passcode 20202021
 *   npx tsx dev/virtual-light.ts plug 5542 3841  # on/off plug
 */
import { Environment, ServerNode, VendorId } from "@matter/main";
import { ExtendedColorLightDevice, ExtendedColorLightRequirements } from "@matter/main/devices/extended-color-light";
import { OnOffPlugInUnitDevice } from "@matter/main/devices/on-off-plug-in-unit";
import os from "node:os";
import path from "node:path";

const [kind = "light", portArg = "5541", discArg = "3840"] = process.argv.slice(2);
const port = Number(portArg);
const discriminator = Number(discArg);

Environment.default.vars.set("path.root", path.join(os.tmpdir(), `lightdeck-virtual-${kind}-${port}`));

const isPlug = kind === "plug";
const deviceType = isPlug ? OnOffPlugInUnitDevice.deviceType : ExtendedColorLightDevice.deviceType;

const node = await ServerNode.create({
    id: `virtual-${kind}-${port}`,
    network: { port },
    commissioning: { passcode: 20202021, discriminator },
    productDescription: { name: isPlug ? "Virtual Plug" : "Virtual Light", deviceType },
    basicInformation: {
        vendorName: "Lightdeck Dev",
        vendorId: VendorId(0xfff1),
        productName: isPlug ? "Virtual Plug" : "Virtual Color Bulb",
        productLabel: isPlug ? "Virtual Plug" : "Virtual Color Bulb",
        nodeLabel: isPlug ? `Test Plug ${port}` : `Test Bulb ${port}`,
        productId: isPlug ? 0x8001 : 0x8000,
        serialNumber: `vt-${kind}-${port}`,
        uniqueId: `uid-${kind}-${port}`,
    },
});

if (isPlug) {
    await node.add(OnOffPlugInUnitDevice, { id: "plug" });
} else {
    await node.add(
        ExtendedColorLightDevice.with(
            ExtendedColorLightRequirements.ColorControlServer.with("HueSaturation", "Xy", "ColorTemperature"),
        ),
        {
            id: "light",
            levelControl: { currentLevel: 254 },
            colorControl: {
                colorTempPhysicalMinMireds: 153,
                colorTempPhysicalMaxMireds: 500,
                coupleColorTempToLevelMinMireds: 153,
                colorTemperatureMireds: 250,
                startUpColorTemperatureMireds: 250,
                colorMode: 2, // color temperature
                enhancedColorMode: 2,
            },
        } as any,
    );
}

const codes = node.state.commissioning.pairingCodes;
console.log(`\nVirtual ${kind} ready. Manual pairing code: ${codes.manualPairingCode}   QR: ${codes.qrPairingCode}\n`);

await node.run();
