import { openLiveOnvifBackchannelTalk } from "../core/rtspOnvifBackchannelTalk.js";
import { resolveOggRecordingPath, startOggPcm16Recorder, type OggRecorder } from "../core/oggRecorder.js";
import type { OnvifDeviceConnectionOptions } from "../core/rtspUrl.js";
import { maskRtspCredentials, prepareRtspUrl } from "../core/rtspUrl.js";
import type { OnvifDeviceSupportReport } from "../types/support.js";
import { OnvifSupportService } from "./onvifSupportService.js";
import { OnvifClient } from "../onvifClient.js";
export type OnvifBackchannelAudioOpenOptions = {
    support?: OnvifDeviceSupportReport;
    verifySupport?: boolean;
    recordTo?: string;
    skipRecvOnlySetup?: boolean;
    connectTimeoutMs?: number;
};
export type OnvifBackchannelAudioSession = {
    g711: "PCMU" | "PCMA";
    payloadType: number;
    sampleRate: 8000;
    rtspUrl: string;
    recordingPath?: string;
    support: OnvifDeviceSupportReport;
    pushPcm16le(chunk: Buffer): void;
    close(): Promise<{
        recordingPath?: string;
    }>;
};
export class OnvifBackchannelAudioService {
    private readonly opts: OnvifDeviceConnectionOptions;
    constructor(opts: OnvifDeviceConnectionOptions) {
        this.opts = opts;
    }
    async open(options?: OnvifBackchannelAudioOpenOptions): Promise<OnvifBackchannelAudioSession> {
        const verify = options?.verifySupport !== undefined ? options.verifySupport : options?.support === undefined;
        let support = options?.support;
        if (verify || !support) {
            const probe = new OnvifSupportService(this.opts);
            support = await probe.discover();
        }
        if (!support.reachable) {
            throw new Error(`Device not reachable: ${support.error ?? "unknown error"}`);
        }
        if (!support.backchannel.supported) {
            const notes = support.backchannel.notes.join("; ") || "no sendonly audio in SDP";
            throw new Error(`ONVIF audio backchannel not supported: ${notes}`);
        }
        const streamInvalidAfterConnect = support.streams.some((s) => s.invalidAfterConnect);
        let rtspUrl: string;
        if (this.opts.rtspUrl?.trim()) {
            rtspUrl = prepareRtspUrl(this.opts.rtspUrl.trim(), this.opts);
        }
        else if (streamInvalidAfterConnect) {
            rtspUrl = await this.resolveRtspUrl();
        }
        else if (support.backchannel.rtspUrl && !support.backchannel.rtspUrl.includes(":***@")) {
            rtspUrl = prepareRtspUrl(support.backchannel.rtspUrl, this.opts);
        }
        else {
            rtspUrl = await this.resolveRtspUrl();
        }
        const live = await openLiveOnvifBackchannelTalk({
            rtspContentUrl: rtspUrl,
            skipRecvOnlySetup: options?.skipRecvOnlySetup !== false,
            connectTimeoutMs: options?.connectTimeoutMs ?? this.opts.timeoutMs ?? 15000
        });
        let recorder: OggRecorder | undefined;
        let recordingPath: string | undefined;
        if (options?.recordTo?.trim()) {
            recordingPath = resolveOggRecordingPath(options.recordTo.trim());
            recorder = startOggPcm16Recorder(recordingPath);
        }
        let closed = false;
        return {
            g711: live.g711,
            payloadType: live.payloadType,
            sampleRate: live.sampleRate,
            rtspUrl: maskRtspCredentials(rtspUrl),
            ...(recordingPath ? { recordingPath } : {}),
            support,
            pushPcm16le(chunk: Buffer): void {
                live.pushPcm16le(chunk);
                recorder?.write(chunk);
            },
            async close(): Promise<{
                recordingPath?: string;
            }> {
                if (closed)
                    return recordingPath ? { recordingPath } : {};
                closed = true;
                await live.close();
                if (recorder) {
                    recordingPath = await recorder.close();
                }
                return recordingPath ? { recordingPath } : {};
            }
        };
    }
    private async resolveRtspUrl(): Promise<string> {
        if (this.opts.rtspUrl?.trim()) {
            return prepareRtspUrl(this.opts.rtspUrl.trim(), this.opts);
        }
        const client = new OnvifClient(this.opts);
        await client.init();
        const streams = await client.getStreams();
        const want = this.opts.profileToken?.trim();
        const pick = want
            ? streams.find((s) => s.profileToken === want)
            : streams.find((s) => Boolean(s.uri)) ?? streams[0];
        if (!pick?.uri)
            throw new Error("No GetStreamUri RTSP URL (set rtspUrl on connection options)");
        return prepareRtspUrl(pick.uri, this.opts);
    }
}
