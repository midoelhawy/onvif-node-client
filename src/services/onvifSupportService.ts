import { OnvifClient } from "../onvifClient.js";
import type { OnvifDeviceConnectionOptions } from "../core/rtspUrl.js";
import { maskRtspCredentials, prepareRtspUrl } from "../core/rtspUrl.js";
import type { OnvifDeviceSupportReport } from "../types/support.js";
function guessG711FromSdp(sdp?: string): "PCMU" | "PCMA" | undefined {
    if (!sdp)
        return undefined;
    const blocks = sdp.split(/(?=^m=)/m);
    for (const block of blocks) {
        if (!/^m=audio\b/m.test(block))
            continue;
        if (!/a=sendonly/m.test(block))
            continue;
        if (/a=rtpmap:\d+\s+PCMU\//i.test(block))
            return "PCMU";
        if (/a=rtpmap:\d+\s+PCMA\//i.test(block))
            return "PCMA";
    }
    if (/PCMU\//i.test(sdp))
        return "PCMU";
    if (/PCMA\//i.test(sdp))
        return "PCMA";
    return undefined;
}
export class OnvifSupportService {
    private readonly opts: OnvifDeviceConnectionOptions;
    constructor(opts: OnvifDeviceConnectionOptions) {
        this.opts = opts;
    }
    async discover(): Promise<OnvifDeviceSupportReport> {
        const probedAt = new Date().toISOString();
        const hints: string[] = [];
        const client = new OnvifClient(this.opts);
        try {
            await client.init();
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            return {
                reachable: false,
                error: message,
                capabilityEndpoints: [],
                profiles: [],
                streams: [],
                audioOutputs: [],
                backchannel: { supported: false, notes: [`init failed: ${message}`] },
                hints: [
                    "Check host/port, credentials, HTTP vs HTTPS, and httpHostHeader when tunneling.",
                    "RTSP backchannel needs a reachable RTSP port (often 554), separate from ONVIF HTTP."
                ],
                probedAt
            };
        }
        let device: OnvifDeviceSupportReport["device"];
        try {
            device = await client.getDeviceInformation();
        }
        catch (e) {
            hints.push(`GetDeviceInformation failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        const capabilityEndpoints = await client.getAdvertisedCapabilityEndpoints().catch(() => []);
        const dir = await client.getServiceDirectory().catch(() => undefined);
        const serviceDirectory = dir?.map((s) => ({
            namespace: s.namespace,
            ...(s.version ? { version: s.version } : {}),
            xAddr: s.xAddr,
            normalizedXAddr: client.normalizeServiceUrl(s.xAddr)
        }));
        const profiles = await client.getProfilesDetailed().catch(() => []);
        const streams = await client.getStreams().catch(() => []);
        const audioOutputs = await client.getAudioOutputSummaries().catch(() => []);
        if (!profiles.length)
            hints.push("No Media profiles — streaming / backchannel may be unavailable.");
        if (audioOutputs.length) {
            hints.push("Device IO exposes audio output tokens (physical speaker lines).");
        }
        else {
            hints.push("No Device IO audio outputs — talk usually goes through Media RTSP backchannel.");
        }
        const backchannelNotes: string[] = [];
        let preparedRtsp: string | undefined = this.opts.rtspUrl?.trim();
        if (!preparedRtsp) {
            const want = this.opts.profileToken?.trim();
            const pick = want
                ? streams.find((s) => s.profileToken === want)
                : streams.find((s) => Boolean(s.uri)) ?? streams[0];
            if (pick?.uri)
                preparedRtsp = prepareRtspUrl(pick.uri, this.opts);
            else
                backchannelNotes.push("No GetStreamUri RTSP URL and no rtspUrl override.");
        }
        else {
            preparedRtsp = prepareRtspUrl(preparedRtsp, this.opts);
        }
        let probe: OnvifDeviceSupportReport["backchannel"]["probe"];
        let supported = false;
        let g711: "PCMU" | "PCMA" | undefined;
        if (preparedRtsp) {
            try {
                probe = await client.probeRtspAudioBackchannel({
                    rtspUrl: preparedRtsp,
                    timeoutMs: Math.min(this.opts.timeoutMs ?? 15000, 15000)
                });
                if (!probe) {
                    backchannelNotes.push("Backchannel probe returned empty.");
                }
                else {
                    supported = Boolean(probe.sdpSuggestsAudioBackchannel);
                    g711 = guessG711FromSdp(probe.sdpPreview);
                    if (probe.notes?.length)
                        backchannelNotes.push(...probe.notes);
                    if (!supported) {
                        backchannelNotes.push("SDP did not show m=audio + a=sendonly after Require backchannel (or RTSP failed).");
                    }
                    else {
                        hints.push("Backchannel supported: use OnvifBackchannelAudioService to send G.711 PCM to the speaker.");
                    }
                }
            }
            catch (e) {
                backchannelNotes.push(`Backchannel probe error: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
        const resolved = client.getResolvedServices();
        return {
            reachable: true,
            ...(device ? { device } : {}),
            ...(resolved ? { resolvedServices: { ...resolved } } : {}),
            capabilityEndpoints,
            ...(serviceDirectory ? { serviceDirectory } : {}),
            profiles,
            streams: streams.map((s) => ({
                ...s,
                uri: s.uri ? maskRtspCredentials(prepareRtspUrl(s.uri, this.opts)) : s.uri
            })),
            audioOutputs,
            backchannel: {
                supported,
                ...(preparedRtsp ? { rtspUrl: preparedRtsp } : {}),
                ...(g711 ? { g711 } : {}),
                ...(probe ? { probe } : {}),
                notes: backchannelNotes
            },
            hints,
            probedAt
        };
    }
}
