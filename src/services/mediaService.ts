import { buildSoapEnvelope, throwIfSoapFault } from "../core/soap.js";
import { extractAttribute, extractBlocks, extractTagText } from "../core/xml.js";
import type { MediaProfile, MediaProfileSummary, StreamUri } from "../types/media.js";
import type { OnvifRequestOptions } from "../types/transport.js";
import type { OnvifTransport } from "../transport/transport.js";
export class MediaService {
    constructor(private readonly transport: OnvifTransport, private readonly mediaXAddr: string) { }
    async getProfiles(opts?: OnvifRequestOptions): Promise<MediaProfile[]> {
        const body = `<trt:GetProfiles xmlns:trt="http://www.onvif.org/ver10/media/wsdl"/>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: {
                trt: "http://www.onvif.org/ver10/media/wsdl",
                tt: "http://www.onvif.org/ver10/schema"
            }
        });
        const res = await this.transport.post(this.mediaXAddr, xml, {
            soapAction: opts?.soapAction ?? "http://www.onvif.org/ver10/media/wsdl/GetProfiles",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
        const blocks = extractBlocks(res.text, "Profiles");
        return blocks
            .map(({ openTag, innerXml }): MediaProfile | undefined => {
            const token = extractAttribute(openTag, "token") ?? "";
            const name = extractTagText(innerXml, "Name");
            const venc = extractBlocks(innerXml, "VideoEncoderConfiguration")[0]?.innerXml ?? "";
            const encoding = extractTagText(venc, "Encoding");
            const resolution = extractBlocks(venc, "Resolution")[0]?.innerXml ?? "";
            const width = toNumber(extractTagText(resolution, "Width"));
            const height = toNumber(extractTagText(resolution, "Height"));
            const rateControl = extractBlocks(venc, "RateControl")[0]?.innerXml ?? "";
            const frameRateLimit = toNumber(extractTagText(rateControl, "FrameRateLimit"));
            const audioSrc = extractBlocks(innerXml, "AudioSourceConfiguration")[0];
            const audioEnc = extractBlocks(innerXml, "AudioEncoderConfiguration")[0];
            let audio: MediaProfile["audio"] | undefined;
            if (audioSrc || audioEnc) {
                audio = {};
                if (audioSrc) {
                    const st = extractAttribute(audioSrc.openTag, "token");
                    if (st)
                        audio.sourceToken = st;
                }
                if (audioEnc) {
                    const et = extractAttribute(audioEnc.openTag, "token");
                    if (et)
                        audio.encoderToken = et;
                    const encXml = audioEnc.innerXml;
                    const enc = extractTagText(encXml, "Encoding");
                    const br = toNumber(extractTagText(encXml, "Bitrate"));
                    if (enc !== undefined)
                        audio.encoding = enc;
                    if (br !== undefined)
                        audio.bitrate = br;
                }
                if (Object.keys(audio).length === 0)
                    audio = undefined;
            }
            if (!token)
                return undefined;
            const video: NonNullable<MediaProfile["video"]> = {};
            if (encoding !== undefined)
                video.encoding = encoding;
            if (width !== undefined)
                video.width = width;
            if (height !== undefined)
                video.height = height;
            if (frameRateLimit !== undefined)
                video.frameRateLimit = frameRateLimit;
            const out: MediaProfile = { token };
            if (name !== undefined)
                out.name = name;
            if (Object.keys(video).length > 0)
                out.video = video;
            if (audio)
                out.audio = audio;
            return out;
        })
            .filter((p): p is MediaProfile => Boolean(p));
    }
    async getProfilesSummary(opts?: OnvifRequestOptions): Promise<MediaProfileSummary[]> {
        const profiles = await this.getProfiles(opts);
        return profiles.map((p) => {
            const out: MediaProfileSummary = { token: p.token };
            if (p.name !== undefined)
                out.name = p.name;
            return out;
        });
    }
    async getStreamUri(profileToken: string, opts?: OnvifRequestOptions): Promise<StreamUri> {
        const body = `<trt:GetStreamUri xmlns:trt="http://www.onvif.org/ver10/media/wsdl">
  <trt:StreamSetup>
    <tt:Stream xmlns:tt="http://www.onvif.org/ver10/schema">RTP-Unicast</tt:Stream>
    <tt:Transport xmlns:tt="http://www.onvif.org/ver10/schema">
      <tt:Protocol>RTSP</tt:Protocol>
    </tt:Transport>
  </trt:StreamSetup>
  <trt:ProfileToken>${escapeXml(profileToken)}</trt:ProfileToken>
</trt:GetStreamUri>`;
        const xml = buildSoapEnvelope({
            body,
            extraXmlns: {
                trt: "http://www.onvif.org/ver10/media/wsdl",
                tt: "http://www.onvif.org/ver10/schema"
            }
        });
        const res = await this.transport.post(this.mediaXAddr, xml, {
            soapAction: opts?.soapAction ?? "http://www.onvif.org/ver10/media/wsdl/GetStreamUri",
            ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs })
        });
        throwIfSoapFault(res.text, res.status);
        const mediaUriXml = extractBlocks(res.text, "MediaUri")[0]?.innerXml ?? "";
        const uri = extractTagText(mediaUriXml, "Uri");
        if (!uri) {
            return { profileToken, uri: "" };
        }
        const out: StreamUri = { profileToken, uri: String(uri) };
        const iac = toBool(extractTagText(mediaUriXml, "InvalidAfterConnect"));
        const iar = toBool(extractTagText(mediaUriXml, "InvalidAfterReboot"));
        const to = extractTagText(mediaUriXml, "Timeout");
        if (iac !== undefined)
            out.invalidAfterConnect = iac;
        if (iar !== undefined)
            out.invalidAfterReboot = iar;
        if (to !== undefined)
            out.timeout = to;
        return out;
    }
    async getAllStreamUris(opts?: OnvifRequestOptions): Promise<StreamUri[]> {
        const profiles = await this.getProfilesSummary(opts);
        const out: StreamUri[] = [];
        for (const p of profiles) {
            if (!p.token)
                continue;
            const uri = await this.getStreamUri(p.token, opts);
            if (uri.uri)
                out.push(uri);
        }
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
function toNumber(v: string | undefined): number | undefined {
    if (v == null)
        return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
}
function toBool(v: string | undefined): boolean | undefined {
    if (v == null)
        return undefined;
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1")
        return true;
    if (s === "false" || s === "0")
        return false;
    return undefined;
}
