import type { OnvifClientOptions } from "./types/options.js";
import type {
    CameraDeviceInformation,
    SetSystemDateAndTimeOptions,
    SyncSystemDateAndTimeOptions,
    SystemDateAndTime
} from "./types/device.js";
import type { MediaProfile, MediaProfileSummary, StreamUri } from "./types/media.js";
import type { OnvifServices } from "./types/services.js";
import { DeviceService } from "./services/deviceService.js";
import { MediaService } from "./services/mediaService.js";
import { EventsService } from "./services/eventsService.js";
import { DeviceIoService } from "./services/deviceIoService.js";
import { OnvifTransport } from "./transport/transport.js";
import type { EventListenerOptions, PullMessagesResult, PullPointSubscription } from "./types/events.js";
import { parseCapabilityEndpointsFromGetCapabilitiesXml } from "./core/capabilitiesParse.js";
import type { OnvifServiceDirectoryEntry } from "./services/deviceService.js";
import { probeRtspBackchannelDescribe, type RtspBackchannelProbeResult } from "./core/rtspBackchannelProbe.js";
import type { OnvifRequestOptions } from "./types/transport.js";
export class OnvifClient {
    readonly options: Required<Pick<OnvifClientOptions, "host">> & OnvifClientOptions;
    private readonly transport: OnvifTransport;
    private services?: OnvifServices;
    private deviceSvc?: DeviceService;
    private mediaSvc?: MediaService;
    private eventsSvc?: EventsService;
    constructor(opts: OnvifClientOptions) {
        this.options = { ...opts };
        this.transport = new OnvifTransport(opts);
    }
    async init(): Promise<void> {
        const deviceXAddr = this.buildDefaultDeviceXAddr();
        this.services = { device: deviceXAddr };
        this.deviceSvc = new DeviceService(this.transport, this.services);
        const caps = await this.deviceSvc.getCapabilities(this.options.timeoutMs === undefined ? undefined : { timeoutMs: this.options.timeoutMs });
        if (caps.mediaXAddr) {
            const normalized = this.normalizeXAddr(caps.mediaXAddr);
            this.services.media = normalized;
            this.mediaSvc = new MediaService(this.transport, normalized);
        }
        if (caps.eventsXAddr) {
            const normalized = this.normalizeXAddr(caps.eventsXAddr);
            this.services.events = normalized;
            this.eventsSvc = new EventsService(this.transport, normalized);
        }
        if (caps.analyticsXAddr) {
            this.services.analytics = this.normalizeXAddr(caps.analyticsXAddr);
        }
    }
    async getDeviceInformation(): Promise<CameraDeviceInformation> {
        await this.ensureInit();
        return this.deviceSvc!.getDeviceInformation();
    }
    /** Read camera clock / NTP mode (`GetSystemDateAndTime`). */
    async getSystemDateAndTime(opts?: OnvifRequestOptions): Promise<SystemDateAndTime> {
        await this.ensureInit();
        return this.deviceSvc!.getSystemDateAndTime(opts);
    }
    /** Set camera clock or switch to NTP (`SetSystemDateAndTime`). */
    async setSystemDateAndTime(params: SetSystemDateAndTimeOptions, opts?: OnvifRequestOptions): Promise<void> {
        await this.ensureInit();
        return this.deviceSvc!.setSystemDateAndTime(params, opts);
    }
    /**
     * Fix a broken camera clock by pushing host (or explicit) UTC time in Manual mode.
     * Preserves camera TimeZone + DaylightSavings by default, then re-reads the clock.
     * Pass `alignTimeZoneToHost: true` when the OSD local hour is wrong (e.g. winter TZ in summer).
     */
    async syncSystemDateAndTime(opts?: SyncSystemDateAndTimeOptions & OnvifRequestOptions): Promise<SystemDateAndTime> {
        await this.ensureInit();
        const reqOpts: OnvifRequestOptions | undefined =
            opts?.timeoutMs === undefined && opts?.soapAction === undefined
                ? undefined
                : {
                    ...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
                    ...(opts?.soapAction === undefined ? {} : { soapAction: opts.soapAction })
                };
        const syncAt = opts?.date ?? new Date();
        let timeZone = opts?.timeZone;
        let daylightSavings = opts?.daylightSavings;
        if (opts?.alignTimeZoneToHost) {
            if (timeZone === undefined)
                timeZone = formatHostGmtOffsetTimeZone(syncAt);
            if (daylightSavings === undefined)
                daylightSavings = false;
        }
        else {
            const preserve = opts?.preserveCameraSettings !== false;
            if (preserve && (timeZone === undefined || daylightSavings === undefined)) {
                const current = await this.deviceSvc!.getSystemDateAndTime(reqOpts);
                if (timeZone === undefined)
                    timeZone = current.timeZone;
                if (daylightSavings === undefined)
                    daylightSavings = current.daylightSavings ?? false;
            }
        }
        await this.deviceSvc!.setSystemDateAndTime(
            {
                dateTimeType: opts?.dateTimeType ?? "Manual",
                daylightSavings: daylightSavings ?? false,
                ...(timeZone === undefined ? {} : { timeZone }),
                utcDateTime: syncAt
            },
            reqOpts
        );
        return this.deviceSvc!.getSystemDateAndTime(reqOpts);
    }
    /**
     * Reboot the camera (`SystemReboot`).
     * Returns an optional device `Message`. Some firmwares close the connection instead of
     * answering — that usually still means reboot started.
     */
    async systemReboot(opts?: OnvifRequestOptions): Promise<{ message?: string }> {
        await this.ensureInit();
        return this.deviceSvc!.systemReboot(opts);
    }
    async getProfiles(): Promise<MediaProfileSummary[]> {
        await this.ensureInit();
        if (!this.mediaSvc)
            return [];
        return this.mediaSvc.getProfilesSummary({ timeoutMs: 20000 });
    }
    async getProfilesDetailed(): Promise<MediaProfile[]> {
        await this.ensureInit();
        if (!this.mediaSvc)
            return [];
        return this.mediaSvc.getProfiles({ timeoutMs: 20000 });
    }
    async getStreams(): Promise<StreamUri[]> {
        await this.ensureInit();
        if (!this.mediaSvc)
            return [];
        return this.mediaSvc.getAllStreamUris({ timeoutMs: 25000 });
    }
    async createPullPointSubscription(opts?: {
        initialTerminationTime?: string;
        timeoutMs?: number;
    }): Promise<PullPointSubscription | undefined> {
        await this.ensureInit();
        if (!this.eventsSvc || !this.services?.events)
            return undefined;
        const sub = await this.eventsSvc.createPullPointSubscription({
            initialTerminationTime: opts?.initialTerminationTime ?? "PT60S",
            timeoutMs: opts?.timeoutMs ?? 20000
        });
        const normalized = this.normalizeXAddr(sub.referenceAddress);
        return { ...sub, referenceAddress: normalized };
    }
    async pullMessages(pullPointXAddr: string, opts?: {
        timeout?: string;
        messageLimit?: number;
        timeoutMs?: number;
    }): Promise<PullMessagesResult | undefined> {
        await this.ensureInit();
        if (!this.eventsSvc)
            return undefined;
        return this.eventsSvc.pullMessages(pullPointXAddr, { timeoutMs: 25000, ...opts });
    }
    async *listenToEvents(opts?: EventListenerOptions & {
        signal?: AbortSignal;
    }): AsyncGenerator<NonNullable<PullMessagesResult["messages"]>[number], void, void> {
        await this.ensureInit();
        if (!this.eventsSvc)
            return;
        const signal = opts?.signal;
        const initialTerminationTime = opts?.initialTerminationTime ?? "PT60S";
        const pullTimeout = opts?.pullTimeout ?? "PT5S";
        const messageLimit = opts?.messageLimit ?? 10;
        const requestTimeoutMs = opts?.requestTimeoutMs ?? 25000;
        let pullPoint: string | undefined;
        while (!signal?.aborted) {
            if (!pullPoint) {
                const sub = await this.createPullPointSubscription({ initialTerminationTime, timeoutMs: requestTimeoutMs });
                if (!sub?.referenceAddress)
                    return;
                pullPoint = sub.referenceAddress;
            }
            try {
                const res = await this.pullMessages(pullPoint, {
                    timeout: pullTimeout,
                    messageLimit,
                    timeoutMs: requestTimeoutMs
                });
                const msgs = res?.messages ?? [];
                for (const m of msgs) {
                    if (signal?.aborted)
                        return;
                    yield m;
                }
            }
            catch (err) {
                pullPoint = undefined;
                await sleep(500);
            }
        }
    }
    getResolvedServices(): OnvifServices | undefined {
        return this.services ? { ...this.services } : undefined;
    }
    normalizeServiceUrl(xaddr: string): string {
        return this.normalizeXAddr(xaddr);
    }
    async getAdvertisedCapabilityEndpoints(): Promise<Array<{
        scope: string;
        xAddr: string;
        normalizedXAddr: string;
    }>> {
        await this.ensureInit();
        const xml = await this.deviceSvc!.getCapabilitiesResponseXml(this.options.timeoutMs === undefined ? undefined : { timeoutMs: this.options.timeoutMs });
        const list = parseCapabilityEndpointsFromGetCapabilitiesXml(xml);
        return list.map((e) => ({
            scope: e.scope,
            xAddr: e.xAddr,
            normalizedXAddr: this.normalizeXAddr(e.xAddr)
        }));
    }
    async getServiceDirectory(): Promise<OnvifServiceDirectoryEntry[] | undefined> {
        await this.ensureInit();
        return this.deviceSvc!.getServices(this.options.timeoutMs === undefined ? undefined : { timeoutMs: this.options.timeoutMs });
    }
    async getAudioOutputSummaries(): Promise<Array<{
        token: string;
    }>> {
        await this.ensureInit();
        const xml = await this.deviceSvc!.getCapabilitiesResponseXml(this.options.timeoutMs === undefined ? undefined : { timeoutMs: this.options.timeoutMs });
        const endpoints = parseCapabilityEndpointsFromGetCapabilitiesXml(xml);
        let deviceIo = endpoints.find((e) => e.scope === "Extension/DeviceIO" || e.scope === "DeviceIO");
        if (!deviceIo) {
            const dir = await this.getServiceDirectory();
            const fromServices = dir?.find((s) => /deviceIO\/wsdl/i.test(s.namespace));
            if (fromServices) {
                deviceIo = { scope: "DeviceIO", xAddr: fromServices.xAddr };
            }
        }
        if (!deviceIo)
            return [];
        const url = this.normalizeXAddr(deviceIo.xAddr);
        const dio = new DeviceIoService(this.transport, url);
        try {
            return await dio.getAudioOutputs({ timeoutMs: 20000 });
        }
        catch {
            return [];
        }
    }
    async probeRtspAudioBackchannel(opts?: {
        profileToken?: string;
        rtspUrl?: string;
        timeoutMs?: number;
    }): Promise<RtspBackchannelProbeResult | undefined> {
        await this.ensureInit();
        let uri = opts?.rtspUrl;
        if (!uri) {
            const streams = await this.getStreams();
            const pick = opts?.profileToken
                ? streams.find((s) => s.profileToken === opts.profileToken)
                : streams.find((s) => Boolean(s.uri)) ?? streams[0];
            uri = pick?.uri;
        }
        if (!uri)
            return undefined;
        return probeRtspBackchannelDescribe(uri, { timeoutMs: opts?.timeoutMs ?? 10000 });
    }
    private async ensureInit(): Promise<void> {
        if (this.deviceSvc)
            return;
        await this.init();
    }
    private buildDefaultDeviceXAddr(): string {
        const port = this.options.port ?? (this.options.secure ? 443 : 80);
        const basePath = this.options.path ?? "/onvif";
        const scheme = this.options.secure ? "https" : "http";
        const trimmed = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
        return `${scheme}://${this.options.host}:${port}${trimmed}/device_service`;
    }
    private normalizeXAddr(xaddr: string): string {
        try {
            const u = new URL(xaddr);
            const scheme = this.options.secure ? "https" : "http";
            const port = this.options.port ?? (this.options.secure ? 443 : 80);
            const host = this.options.host;
            if (u.hostname === host && (u.port ? Number(u.port) === port : true) && u.protocol.replace(":", "") === scheme) {
                return xaddr;
            }
            return `${scheme}://${host}:${port}${u.pathname}${u.search}`;
        }
        catch {
            return xaddr;
        }
    }
}
export type { OnvifClientOptions } from "./types/options.js";
/** Host local offset as vendor-style `GMT±HH:MM` (matches many ONVIF OSD clocks). */
export function formatHostGmtOffsetTimeZone(date = new Date()): string {
    const totalMinutes = -date.getTimezoneOffset();
    const sign = totalMinutes >= 0 ? "+" : "-";
    const abs = Math.abs(totalMinutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    return `GMT${sign}${hh}:${mm}`;
}
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
