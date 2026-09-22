import { buildSoapEnvelope, throwIfSoapFault } from "../core/soap.js";
import { extractBlocks, extractTagText } from "../core/xml.js";
import type { CameraDeviceInformation } from "../types/device.js";
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
