import { buildSoapEnvelope, throwIfSoapFault } from "../core/soap.js";
import { extractAttribute, extractBlocks } from "../core/xml.js";
import type { OnvifRequestOptions } from "../types/transport.js";
import type { OnvifTransport } from "../transport/transport.js";
export interface AudioOutputSummary {
    token: string;
}
export class DeviceIoService {
    constructor(private readonly transport: OnvifTransport, private readonly deviceIoXAddr: string) { }
    async getAudioOutputs(opts?: OnvifRequestOptions): Promise<AudioOutputSummary[]> {
        const body = `<tdi:GetAudioOutputs xmlns:tdi="http://www.onvif.org/ver10/deviceIO/wsdl"/>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: { tdi: "http://www.onvif.org/ver10/deviceIO/wsdl" }
        });
        const res = await this.transport.post(this.deviceIoXAddr, xml, {
            soapAction: "http://www.onvif.org/ver10/deviceIO/wsdl/GetAudioOutputs",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
        const blocks = extractBlocks(res.text, "AudioOutput");
        return blocks
            .map(({ openTag }) => {
            const token = extractAttribute(openTag, "token") ?? "";
            return token ? { token } : undefined;
        })
            .filter((x): x is AudioOutputSummary => Boolean(x));
    }
}
