import { buildSoapEnvelope, throwIfSoapFault } from "../core/soap.js";
import { extractBlocks, extractTagText } from "../core/xml.js";
import type {
    CameraDeviceInformation,
    OnvifDateTimeParts,
    SetSystemDateAndTimeOptions,
    SystemDateAndTime
} from "../types/device.js";
import type { OnvifServices } from "../types/services.js";
import type { OnvifRequestOptions } from "../types/transport.js";
import type { OnvifTransport } from "../transport/transport.js";
export interface OnvifServiceDirectoryEntry {
    namespace: string;
    xAddr: string;
    version?: string;
}
export class DeviceService {
    constructor(private readonly transport: OnvifTransport, private readonly services: OnvifServices) { }
    async getDeviceInformation(opts?: OnvifRequestOptions): Promise<CameraDeviceInformation> {
        const body = `<tds:GetDeviceInformation xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: { tds: "http://www.onvif.org/ver10/device/wsdl" }
        });
        const res = await this.transport.post(this.services.device, xml, {
            soapAction: opts?.soapAction ?? "http://www.onvif.org/ver10/device/wsdl/GetDeviceInformation",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
        return {
            manufacturer: extractTagText(res.text, "Manufacturer") ?? "",
            model: extractTagText(res.text, "Model") ?? "",
            firmwareVersion: extractTagText(res.text, "FirmwareVersion") ?? "",
            serialNumber: extractTagText(res.text, "SerialNumber") ?? "",
            hardwareId: extractTagText(res.text, "HardwareId") ?? ""
        };
    }
    async getSystemDateAndTime(opts?: OnvifRequestOptions): Promise<SystemDateAndTime> {
        const body = `<tds:GetSystemDateAndTime xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: { tds: "http://www.onvif.org/ver10/device/wsdl" }
        });
        const res = await this.transport.post(this.services.device, xml, {
            soapAction: opts?.soapAction ?? "http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
        return parseSystemDateAndTime(res.text);
    }
    async setSystemDateAndTime(params: SetSystemDateAndTimeOptions, opts?: OnvifRequestOptions): Promise<void> {
        const utc = params.utcDateTime === undefined ? undefined : toDateTimeParts(params.utcDateTime);
        const body = `<tds:SetSystemDateAndTime xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">
  <tds:DateTimeType>${escapeXml(params.dateTimeType)}</tds:DateTimeType>
  <tds:DaylightSavings>${params.daylightSavings ? "true" : "false"}</tds:DaylightSavings>
  ${params.timeZone !== undefined ? `<tds:TimeZone><tt:TZ>${escapeXml(params.timeZone)}</tt:TZ></tds:TimeZone>` : ""}
  ${utc ? `<tds:UTCDateTime>${formatDateTimeXml(utc)}</tds:UTCDateTime>` : ""}
</tds:SetSystemDateAndTime>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: {
                tds: "http://www.onvif.org/ver10/device/wsdl",
                tt: "http://www.onvif.org/ver10/schema"
            }
        });
        const res = await this.transport.post(this.services.device, xml, {
            soapAction: opts?.soapAction ?? "http://www.onvif.org/ver10/device/wsdl/SetSystemDateAndTime",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
    }
    /**
     * Soft-reboot the device (`tds:SystemReboot`).
     * Many cameras drop the TCP connection before a full SOAP response; callers should treat
     * network errors after a successful send as likely reboot-in-progress.
     */
    async systemReboot(opts?: OnvifRequestOptions): Promise<{ message?: string }> {
        const body = `<tds:SystemReboot xmlns:tds="http://www.onvif.org/ver10/device/wsdl"/>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: { tds: "http://www.onvif.org/ver10/device/wsdl" }
        });
        const res = await this.transport.post(this.services.device, xml, {
            soapAction: opts?.soapAction ?? "http://www.onvif.org/ver10/device/wsdl/SystemReboot",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
        const message = extractTagText(res.text, "Message");
        return message === undefined ? {} : { message };
    }
    async getCapabilities(opts?: OnvifRequestOptions): Promise<{
        mediaXAddr?: string;
        eventsXAddr?: string;
        analyticsXAddr?: string;
    }> {
        const body = `<tds:GetCapabilities xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <tds:Category>All</tds:Category>
</tds:GetCapabilities>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: { tds: "http://www.onvif.org/ver10/device/wsdl" }
        });
        const res = await this.transport.post(this.services.device, xml, {
            soapAction: opts?.soapAction ?? "http://www.onvif.org/ver10/device/wsdl/GetCapabilities",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
        const mediaBlock = extractBlocks(res.text, "Media")[0]?.innerXml;
        const mediaXAddr = (mediaBlock ? extractTagText(mediaBlock, "XAddr") : undefined) ?? extractTagText(res.text, "XAddr");
        const eventsBlock = extractBlocks(res.text, "Events")[0]?.innerXml;
        const eventsXAddr = eventsBlock ? extractTagText(eventsBlock, "XAddr") : undefined;
        const analyticsBlock = extractBlocks(res.text, "Analytics")[0]?.innerXml;
        const analyticsXAddr = analyticsBlock ? extractTagText(analyticsBlock, "XAddr") : undefined;
        const out: {
            mediaXAddr?: string;
            eventsXAddr?: string;
            analyticsXAddr?: string;
        } = {};
        if (mediaXAddr)
            out.mediaXAddr = mediaXAddr;
        if (eventsXAddr)
            out.eventsXAddr = eventsXAddr;
        if (analyticsXAddr)
            out.analyticsXAddr = analyticsXAddr;
        return out;
    }
    async getCapabilitiesResponseXml(opts?: OnvifRequestOptions): Promise<string> {
        const body = `<tds:GetCapabilities xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <tds:Category>All</tds:Category>
</tds:GetCapabilities>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: { tds: "http://www.onvif.org/ver10/device/wsdl" }
        });
        const res = await this.transport.post(this.services.device, xml, {
            soapAction: opts?.soapAction ?? "http://www.onvif.org/ver10/device/wsdl/GetCapabilities",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
        return res.text;
    }
    async getServices(opts?: OnvifRequestOptions): Promise<OnvifServiceDirectoryEntry[] | undefined> {
        const body = `<tds:GetServices xmlns:tds="http://www.onvif.org/ver10/device/wsdl">
  <tds:IncludeCapability>false</tds:IncludeCapability>
</tds:GetServices>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: { tds: "http://www.onvif.org/ver10/device/wsdl" }
        });
        const res = await this.transport.post(this.services.device, xml, {
            soapAction: "http://www.onvif.org/ver10/device/wsdl/GetServices",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        if (res.status === 400 || res.status === 404)
            return undefined;
        try {
            throwIfSoapFault(res.text, res.status);
        }
        catch {
            return undefined;
        }
        const entries: OnvifServiceDirectoryEntry[] = [];
        const services = extractBlocks(res.text, "Service");
        for (const s of services) {
            const ns = extractTagText(s.innerXml, "Namespace");
            const xa = extractTagText(s.innerXml, "XAddr");
            if (!ns || !xa)
                continue;
            const verInner = extractBlocks(s.innerXml, "Version")[0]?.innerXml ?? "";
            const major = extractTagText(verInner, "Major");
            const minor = extractTagText(verInner, "Minor");
            const version = major !== undefined && minor !== undefined ? `${major}.${minor}` : major !== undefined ? major : undefined;
            const e: OnvifServiceDirectoryEntry = { namespace: ns, xAddr: xa };
            if (version !== undefined)
                e.version = version;
            entries.push(e);
        }
        return entries.length ? entries : undefined;
    }
}

function parseSystemDateAndTime(xml: string): SystemDateAndTime {
    const root = extractBlocks(xml, "SystemDateAndTime")[0]?.innerXml ?? xml;
    const dateTimeType = extractTagText(root, "DateTimeType");
    const dsRaw = extractTagText(root, "DaylightSavings");
    const tzBlock = extractBlocks(root, "TimeZone")[0]?.innerXml;
    const timeZone = tzBlock ? extractTagText(tzBlock, "TZ") : extractTagText(root, "TZ");
    const utcParts = parseDateTimeBlock(extractBlocks(root, "UTCDateTime")[0]?.innerXml);
    const localParts = parseDateTimeBlock(extractBlocks(root, "LocalDateTime")[0]?.innerXml);
    const out: SystemDateAndTime = {};
    if (dateTimeType !== undefined)
        out.dateTimeType = dateTimeType;
    if (dsRaw !== undefined)
        out.daylightSavings = parseOnvifBoolean(dsRaw);
    if (timeZone !== undefined)
        out.timeZone = timeZone;
    if (utcParts) {
        out.utcDateTime = utcParts;
        out.utc = partsToUtcDate(utcParts);
    }
    if (localParts) {
        out.localDateTime = localParts;
        out.local = partsToUtcDate(localParts);
    }
    return out;
}

function parseDateTimeBlock(inner: string | undefined): OnvifDateTimeParts | undefined {
    if (!inner)
        return undefined;
    const timeInner = extractBlocks(inner, "Time")[0]?.innerXml ?? inner;
    const dateInner = extractBlocks(inner, "Date")[0]?.innerXml ?? inner;
    const year = toInt(extractTagText(dateInner, "Year"));
    const month = toInt(extractTagText(dateInner, "Month"));
    const day = toInt(extractTagText(dateInner, "Day"));
    const hour = toInt(extractTagText(timeInner, "Hour"));
    const minute = toInt(extractTagText(timeInner, "Minute"));
    const second = toInt(extractTagText(timeInner, "Second"));
    if (
        year === undefined ||
        month === undefined ||
        day === undefined ||
        hour === undefined ||
        minute === undefined ||
        second === undefined
    ) {
        return undefined;
    }
    return { year, month, day, hour, minute, second };
}

function formatDateTimeXml(parts: OnvifDateTimeParts): string {
    return `<tt:Time>
    <tt:Hour>${parts.hour}</tt:Hour>
    <tt:Minute>${parts.minute}</tt:Minute>
    <tt:Second>${parts.second}</tt:Second>
  </tt:Time>
  <tt:Date>
    <tt:Year>${parts.year}</tt:Year>
    <tt:Month>${parts.month}</tt:Month>
    <tt:Day>${parts.day}</tt:Day>
  </tt:Date>`;
}

export function toDateTimeParts(value: OnvifDateTimeParts | Date): OnvifDateTimeParts {
    if (!(value instanceof Date))
        return value;
    return {
        year: value.getUTCFullYear(),
        month: value.getUTCMonth() + 1,
        day: value.getUTCDate(),
        hour: value.getUTCHours(),
        minute: value.getUTCMinutes(),
        second: value.getUTCSeconds()
    };
}

function partsToUtcDate(parts: OnvifDateTimeParts): Date {
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
}

function parseOnvifBoolean(v: string): boolean {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1";
}

function toInt(v: string | undefined): number | undefined {
    if (v == null)
        return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
}

function escapeXml(s: string): string {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
