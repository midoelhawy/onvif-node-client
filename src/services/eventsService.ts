import { buildSoapEnvelope, throwIfSoapFault } from "../core/soap.js";
import { extractBlocks, extractTagText } from "../core/xml.js";
import type { EventMessage, PullMessagesResult, PullPointSubscription } from "../types/events.js";
import type { OnvifRequestOptions } from "../types/transport.js";
import type { OnvifTransport } from "../transport/transport.js";
export class EventsService {
    constructor(private readonly transport: OnvifTransport, private readonly eventsXAddr: string) { }
    async createPullPointSubscription(opts?: {
        initialTerminationTime?: string;
        timeoutMs?: number;
    }): Promise<PullPointSubscription> {
        const body = `<tev:CreatePullPointSubscription xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
  ${opts?.initialTerminationTime ? `<tev:InitialTerminationTime>${escapeXml(opts.initialTerminationTime)}</tev:InitialTerminationTime>` : ""}
</tev:CreatePullPointSubscription>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: { tev: "http://www.onvif.org/ver10/events/wsdl" }
        });
        const res = await this.transport.post(this.eventsXAddr, xml, {
            soapAction: "http://www.onvif.org/ver10/events/wsdl/CreatePullPointSubscription",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
        const subRefBlock = extractBlocks(res.text, "SubscriptionReference")[0]?.innerXml ??
            extractBlocks(res.text, "subscriptionreference")[0]?.innerXml ??
            "";
        const address = extractTagText(subRefBlock, "Address") ??
            extractTagText(res.text, "Address") ??
            "";
        const out: PullPointSubscription = { referenceAddress: address };
        const ct = extractTagText(res.text, "CurrentTime");
        const tt = extractTagText(res.text, "TerminationTime");
        if (ct !== undefined)
            out.currentTime = ct;
        if (tt !== undefined)
            out.terminationTime = tt;
        return out;
    }
    async pullMessages(pullPointXAddr: string, opts?: {
        timeout?: string;
        messageLimit?: number;
        timeoutMs?: number;
    }): Promise<PullMessagesResult> {
        const timeout = opts?.timeout ?? "PT5S";
        const messageLimit = opts?.messageLimit ?? 10;
        const body = `<tev:PullMessages xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
  <tev:Timeout>${escapeXml(timeout)}</tev:Timeout>
  <tev:MessageLimit>${messageLimit}</tev:MessageLimit>
</tev:PullMessages>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: { tev: "http://www.onvif.org/ver10/events/wsdl" }
        });
        const res = await this.transport.post(pullPointXAddr, xml, {
            soapAction: "http://www.onvif.org/ver10/events/wsdl/PullMessages",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
        const messages: EventMessage[] = [];
        const notificationBlocks = extractBlocks(res.text, "NotificationMessage");
        for (const b of notificationBlocks) {
            const topic = extractTagText(b.innerXml, "Topic");
            const utcTime = extractTagText(b.innerXml, "UtcTime") ??
                extractAttrFromFirstTag(b.innerXml, "Message", "UtcTime");
            const msg: EventMessage = { rawXml: b.innerXml };
            if (topic !== undefined)
                msg.topic = topic;
            if (utcTime !== undefined)
                msg.utcTime = utcTime;
            messages.push(msg);
        }
        const out: PullMessagesResult = { messages };
        const ct = extractTagText(res.text, "CurrentTime");
        const tt = extractTagText(res.text, "TerminationTime");
        if (ct !== undefined)
            out.currentTime = ct;
        if (tt !== undefined)
            out.terminationTime = tt;
        return out;
    }
}
function escapeXml(s: string): string {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
function extractAttrFromFirstTag(xml: string, localName: string, attr: string): string | undefined {
    const m = xml.match(new RegExp(`<([A-Za-z_][\\w.-]*:)?${escapeRe(localName)}\\b([^>]*)>`, "i"));
    if (!m)
        return undefined;
    const attrs = m[2] ?? "";
    const v = attrs.match(new RegExp(`\\b${escapeRe(attr)}\\s*=\\s*"([^"]*)"`, "i"))?.[1]?.trim();
    return v || undefined;
}
function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
