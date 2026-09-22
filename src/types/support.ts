import type { CameraDeviceInformation } from "./device.js";
import type { MediaProfile, StreamUri } from "./media.js";
import type { RtspBackchannelProbeResult } from "../core/rtspBackchannelProbe.js";
export type OnvifCapabilityEndpointSummary = {
    scope: string;
    xAddr: string;
    normalizedXAddr: string;
};
export type OnvifServiceDirectorySummary = {
    namespace: string;
    version?: string;
    xAddr: string;
    normalizedXAddr: string;
};
export type OnvifBackchannelSupport = {
    supported: boolean;
    rtspUrl?: string;
    g711?: "PCMU" | "PCMA";
    probe?: RtspBackchannelProbeResult;
    notes: string[];
};
export interface OnvifDeviceSupportReport {
    reachable: boolean;
    error?: string;
    device?: CameraDeviceInformation;
    resolvedServices?: {
        device?: string;
        media?: string;
        events?: string;
        analytics?: string;
    };
    capabilityEndpoints: OnvifCapabilityEndpointSummary[];
    serviceDirectory?: OnvifServiceDirectorySummary[];
    profiles: MediaProfile[];
    streams: StreamUri[];
    audioOutputs: Array<{
        token: string;
    }>;
    backchannel: OnvifBackchannelSupport;
    hints: string[];
    probedAt: string;
}
