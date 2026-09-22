import type { EventMessage, EventMessageJson, OnvifSimpleItem } from "../types/events.js";
import { extractBlocks, extractTagText } from "./xml.js";
export function eventMessageToJson(msg: EventMessage): EventMessageJson {
    const raw = msg.rawXml;
    const messageOpen = raw.match(/<(?:[A-Za-z_][\w.-]*:)?Message\b([^>]*)>/i)?.[1] ?? "";
    const utcTime = msg.utcTime ?? extractAttr(messageOpen, "UtcTime");
    const propertyOperation = extractAttr(messageOpen, "PropertyOperation");
    const sourceItems = extractSimpleItemsFromSection(raw, "Source");
    const dataItems = extractSimpleItemsFromSection(raw, "Data");
    const keyItems = extractSimpleItemsFromSection(raw, "Key");
    const out: EventMessageJson = { rawXml: raw };
    if (msg.topic !== undefined)
        out.topic = msg.topic;
    if (utcTime !== undefined)
        out.utcTime = utcTime;
    if (propertyOperation !== undefined)
        out.propertyOperation = propertyOperation;
    if (sourceItems.length)
        out.source = sourceItems;
    if (dataItems.length)
        out.data = dataItems;
    if (keyItems.length)
        out.key = keyItems;
    return out;
}
function extractSimpleItemsFromSection(rawXml: string, sectionLocalName: string): OnvifSimpleItem[] {
    const sectionXml = extractBlocks(rawXml, sectionLocalName)[0]?.innerXml ?? "";
    if (!sectionXml)
        return [];
    const out: OnvifSimpleItem[] = [];
    const re = /<(?:[A-Za-z_][\w.-]*:)?SimpleItem\b([^/>]*?)\/>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sectionXml))) {
        const attrs = m[1] ?? "";
        const name = extractAttr(attrs, "Name");
        const value = extractAttr(attrs, "Value");
        if (!name || value === undefined)
            continue;
        out.push({ name, value });
    }
    const blocks = extractBlocks(sectionXml, "SimpleItem");
    for (const b of blocks) {
        const name = extractAttr(b.openTag, "Name");
        const value = extractAttr(b.openTag, "Value") ?? extractTagText(b.innerXml, "Value") ?? b.innerXml.trim();
        if (!name || !value)
            continue;
        if (!out.some((i) => i.name === name && i.value === value))
            out.push({ name, value });
    }
    return out;
}
function extractAttr(attrsFragment: string, name: string): string | undefined {
    const re = new RegExp(`\\b${escapeRe(name)}\\s*=\\s*"([^"]*)"`, "i");
    const m = attrsFragment.match(re);
    const v = m?.[1]?.trim();
    return v ? v : undefined;
}
function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
