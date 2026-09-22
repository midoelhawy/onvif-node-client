import { extractBlocks, extractTagText } from "./xml.js";
export interface CapabilityEndpoint {
    scope: string;
    xAddr: string;
}
export function parseCapabilityEndpointsFromGetCapabilitiesXml(xml: string): CapabilityEndpoint[] {
    const out: CapabilityEndpoint[] = [];
    const caps = extractBlocks(xml, "Capabilities")[0]?.innerXml ?? "";
    if (!caps)
        return out;
    const topTags = ["Analytics", "Device", "Events", "Imaging", "Media", "PTZ"] as const;
    for (const tag of topTags) {
        pushIfXAddr(caps, tag, tag, out);
    }
    const ext = extractBlocks(caps, "Extension")[0]?.innerXml;
    if (ext) {
        const extTags = [
            "DeviceIO",
            "Recording",
            "Search",
            "Replay",
            "Receiver",
            "Display",
            "Thermal",
            "AnalyticsDevice",
            "Guard"
        ] as const;
        for (const tag of extTags) {
            pushIfXAddr(ext, tag, `Extension/${tag}`, out);
        }
    }
    for (const tag of ["Recording", "Search", "Replay", "Receiver"] as const) {
        pushIfXAddr(caps, tag, tag, out);
    }
    return dedupeByScopeAndAddr(out);
}
function pushIfXAddr(innerXml: string, tag: string, scope: string, out: CapabilityEndpoint[]): void {
    const b = extractBlocks(innerXml, tag)[0];
    if (!b)
        return;
    const x = extractTagText(b.innerXml, "XAddr");
    if (x)
        out.push({ scope, xAddr: x });
}
function dedupeByScopeAndAddr(items: CapabilityEndpoint[]): CapabilityEndpoint[] {
    const seen = new Set<string>();
    const res: CapabilityEndpoint[] = [];
    for (const it of items) {
        const k = `${it.scope}|${it.xAddr}`;
        if (seen.has(k))
            continue;
        seen.add(k);
        res.push(it);
    }
    return res;
}
