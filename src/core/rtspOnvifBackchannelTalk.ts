import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import { Readable } from "node:stream";
import { URL } from "node:url";
const ONVIF_BACKCHANNEL = "www.onvif.org/ver20/backchannel";
const UA = "onvif-node-client";
export interface ParsedSdpTrack {
    controlUrl: string;
    kind: "video" | "audio" | "other";
    direction: "recvonly" | "sendonly";
    payloadType: number;
    g711?: "PCMU" | "PCMA";
}
export interface TalkOnvifBackchannelResult {
    ok: boolean;
    message: string;
    describeStatusLine?: string;
    sdpHadSendonlyAudio: boolean;
}
interface RtspResponse {
    statusLine: string;
    headers: Record<string, string>;
    body: string;
}
function effectiveJoinBase(describeHeaders: Record<string, string>, sessionUrl: string): string {
    const raw = (describeHeaders["content-base"] ?? sessionUrl).trim();
    if (raw.includes("?"))
        return raw.replace(/\/$/, "");
    const u = new URL(raw);
    if (!u.pathname.endsWith("/")) {
        u.pathname += "/";
    }
    return u.href;
}
function resolveSdpControlUrl(joinBaseUrl: string, controlRaw: string): string {
    const c = controlRaw.trim();
    if (/^rtsps?:\/\//i.test(c))
        return c;
    const base = joinBaseUrl.replace(/\/$/, "");
    if (base.includes("?")) {
        return `${base}/${c}`;
    }
    return new URL(c, joinBaseUrl.endsWith("/") ? joinBaseUrl : `${joinBaseUrl}/`).href;
}
function mergeRtspSessionQueryFromOrigin(originSessionUrl: string, controlUrl: string): string {
    let origin: URL;
    let ctrl: URL;
    try {
        origin = new URL(originSessionUrl);
        ctrl = new URL(controlUrl);
    }
    catch {
        return controlUrl;
    }
    if (/[?].*\//.test(controlUrl.split("@").pop() ?? controlUrl)) {
        return controlUrl;
    }
    const q = origin.search;
    if (!q || ctrl.search)
        return ctrl.href;
    ctrl.search = q;
    return ctrl.href;
}
function stripRtspUserinfoForRequestLine(uri: string): string {
    try {
        const u = new URL(uri);
        u.username = "";
        u.password = "";
        return u.href;
    }
    catch {
        return uri;
    }
}
function inheritRtspAuth(originSessionUrl: string, controlUrl: string): string {
    let o: URL;
    let t: URL;
    try {
        o = new URL(originSessionUrl);
        t = new URL(controlUrl);
    }
    catch {
        return controlUrl;
    }
    if (!t.username && o.username) {
        t.username = o.username;
        t.password = o.password;
    }
    return t.href;
}
function rewriteRtspEndpoint(rtspUrl: string, host: string, port: number): string {
    try {
        const u = new URL(rtspUrl);
        u.hostname = host;
        u.port = String(port);
        return u.href;
    }
    catch {
        return rtspUrl;
    }
}
function parseSdpTracks(sdp: string, joinBaseUrl: string, originSessionUrl: string, host: string, port: number): ParsedSdpTrack[] {
    const lines = sdp.split(/\r\n|\n/);
    const blocks: string[][] = [];
    let cur: string[] = [];
    for (const line of lines) {
        if (line.startsWith("m=")) {
            if (cur.length)
                blocks.push(cur);
            cur = [line];
        }
        else if (cur.length)
            cur.push(line);
    }
    if (cur.length)
        blocks.push(cur);
    const out: ParsedSdpTrack[] = [];
    for (const block of blocks) {
        const m0 = block[0] ?? "";
        if (!m0.startsWith("m="))
            continue;
        const parts = m0.split(/\s+/);
        const kindToken = (parts[0] ?? "m=").slice(2);
        let kind: ParsedSdpTrack["kind"] = "other";
        if (kindToken === "video")
            kind = "video";
        else if (kindToken === "audio")
            kind = "audio";
        else if (kindToken === "application")
            kind = "other";
        else
            continue;
        const sendonly = block.some((l) => l.trim() === "a=sendonly");
        const recvonly = block.some((l) => l.trim() === "a=recvonly");
        let direction: ParsedSdpTrack["direction"] | undefined;
        if (sendonly)
            direction = "sendonly";
        else if (recvonly)
            direction = "recvonly";
        else if (kind === "video")
            direction = "recvonly";
        else if (kind === "audio")
            direction = "recvonly";
        else if (kind === "other")
            direction = "recvonly";
        if (!direction)
            continue;
        const controlLine = block.find((l) => l.startsWith("a=control:"));
        if (!controlLine)
            continue;
        const controlRaw = controlLine.slice("a=control:".length).trim();
        let controlUrl = resolveSdpControlUrl(joinBaseUrl, controlRaw);
        controlUrl = rewriteRtspEndpoint(controlUrl, host, port);
        controlUrl = inheritRtspAuth(originSessionUrl, controlUrl);
        controlUrl = mergeRtspSessionQueryFromOrigin(originSessionUrl, controlUrl);
        const mPayloads = parts
            .slice(3)
            .map((p) => Number(p))
            .filter((n) => Number.isFinite(n) && n >= 0 && n < 128);
        const rtpmap = new Map<number, string>();
        for (const l of block) {
            if (!l.startsWith("a=rtpmap:"))
                continue;
            const rest = l.slice("a=rtpmap:".length);
            const colon = rest.indexOf(" ");
            if (colon < 0)
                continue;
            const pt = Number(rest.slice(0, colon));
            const desc = rest.slice(colon + 1).trim();
            if (Number.isFinite(pt))
                rtpmap.set(pt, desc);
        }
        let payloadType = mPayloads[0] ?? 0;
        let g711: ParsedSdpTrack["g711"];
        for (const [pt, desc] of rtpmap) {
            const up = desc.toUpperCase();
            if (up.startsWith("PCMU")) {
                payloadType = pt;
                g711 = "PCMU";
                break;
            }
            if (up.startsWith("PCMA") && !g711) {
                payloadType = pt;
                g711 = "PCMA";
            }
        }
        if (!g711 && kind === "audio") {
            if (payloadType === 0)
                g711 = "PCMU";
            else if (payloadType === 8)
                g711 = "PCMA";
        }
        out.push({
            controlUrl,
            kind,
            direction,
            payloadType,
            ...(g711 ? { g711 } : {})
        });
    }
    return out;
}
function orderTracksForSetup(tracks: ParsedSdpTrack[]): ParsedSdpTrack[] {
    const recv = tracks.filter((t) => t.direction === "recvonly");
    const send = tracks.filter((t) => t.direction === "sendonly");
    return [...recv, ...send];
}
function parseHeaders(headerLines: string[]): Record<string, string> {
    const h: Record<string, string> = {};
    for (const line of headerLines) {
        const c = line.indexOf(":");
        if (c < 0)
            continue;
        const k = line.slice(0, c).trim().toLowerCase();
        const v = line.slice(c + 1).trim();
        h[k] = v;
    }
    return h;
}
function basicAuthFromUrl(u: URL): string | undefined {
    if (!u.username && !u.password)
        return undefined;
    const user = decodeURIComponent(u.username);
    const pass = decodeURIComponent(u.password);
    const b64 = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
    return `Basic ${b64}`;
}
function parseDigestChallenge(wwwAuth: string): Record<string, string> {
    const d: Record<string, string> = {};
    const i = wwwAuth.indexOf("Digest");
    if (i < 0)
        return d;
    const rest = wwwAuth.slice(i + 6).trim();
    const re = /(\w+)=("([^"]*)"|([^,]*))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest)) !== null) {
        const key = m[1] ?? "";
        const val = (m[3] ?? m[4] ?? "").trim();
        if (key)
            d[key.toLowerCase()] = val;
    }
    return d;
}
function digestAuthHeader(method: string, digestUri: string, user: string, pass: string, ch: Record<string, string>): string {
    const realm = ch.realm ?? "";
    const nonce = ch.nonce ?? "";
    const qop = ch.qop?.split(",")[0]?.trim();
    const algorithm = (ch.algorithm ?? "MD5").toUpperCase();
    const ha1 = crypto.createHash("md5").update(`${user}:${realm}:${pass}`).digest("hex");
    const ha2 = crypto.createHash("md5").update(`${method}:${digestUri}`).digest("hex");
    const cnonce = crypto.randomBytes(8).toString("hex");
    const nc = "00000001";
    let response: string;
    if (qop) {
        response = crypto
            .createHash("md5")
            .update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
            .digest("hex");
    }
    else {
        response = crypto.createHash("md5").update(`${ha1}:${nonce}:${ha2}`).digest("hex");
    }
    const parts = [
        `username="${user}"`,
        `realm="${realm}"`,
        `nonce="${nonce}"`,
        `uri="${digestUri}"`,
        `response="${response}"`,
        `algorithm=${algorithm}`
    ];
    if (qop) {
        parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
    }
    return `Digest ${parts.join(", ")}`;
}
class RtspInterleavedSession {
    private buf = Buffer.alloc(0);
    private cseq = 0;
    private digestChallenge?: Record<string, string>;
    private waitBuf: (() => void) | undefined;
    constructor(private readonly socket: net.Socket, private readonly urlObj: URL) {
        this.socket.on("data", (chunk: Buffer) => {
            this.buf = Buffer.concat([this.buf, chunk]);
            this.waitBuf?.();
        });
    }
    private async waitFor(pred: () => boolean): Promise<void> {
        while (!pred()) {
            await new Promise<void>((resolve, reject) => {
                const to = setTimeout(() => {
                    this.waitBuf = undefined;
                    reject(new Error("RTSP read timeout"));
                }, 60000);
                const wake = (): void => {
                    if (pred()) {
                        clearTimeout(to);
                        this.waitBuf = undefined;
                        resolve();
                    }
                };
                this.waitBuf = wake;
            });
        }
    }
    private authHeader(method: string, digestUri: string): string | undefined {
        if (this.digestChallenge) {
            const user = decodeURIComponent(this.urlObj.username);
            const pass = decodeURIComponent(this.urlObj.password);
            return digestAuthHeader(method, digestUri, user, pass, this.digestChallenge);
        }
        return basicAuthFromUrl(this.urlObj);
    }
    async request(method: string, requestUri: string, extraHeaders: Record<string, string>, opts?: {
        body?: string;
    }): Promise<RtspResponse> {
        const lineUri = stripRtspUserinfoForRequestLine(requestUri);
        const digestUri = lineUri;
        for (let attempt = 0; attempt < 2; attempt++) {
            this.cseq += 1;
            const lines = [
                `${method} ${lineUri} RTSP/1.0`,
                `CSeq: ${this.cseq}`,
                `User-Agent: ${UA}`,
                ...Object.entries(extraHeaders).map(([k, v]) => `${k}: ${v}`)
            ];
            const auth = this.authHeader(method, digestUri);
            if (auth)
                lines.push(`Authorization: ${auth}`);
            if (opts?.body) {
                lines.push(`Content-Type: application/sdp`);
                lines.push(`Content-Length: ${Buffer.byteLength(opts.body, "utf8")}`);
            }
            lines.push("", opts?.body ?? "");
            const payload = lines.join("\r\n");
            await new Promise<void>((resolve, reject) => {
                this.socket.write(payload, (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            const res = await this.readOneRtspMessage();
            if (res.statusLine.includes("401") && res.headers["www-authenticate"]?.includes("Digest") && !this.digestChallenge) {
                this.digestChallenge = parseDigestChallenge(res.headers["www-authenticate"]);
                continue;
            }
            return res;
        }
        return await this.readOneRtspMessage();
    }
    private stripLeadingInterleaved(): void {
        while (this.buf.length >= 4 && this.buf[0] === 0x24) {
            const len = this.buf.readUInt16BE(2);
            const frameLen = 4 + len;
            if (this.buf.length < frameLen)
                return;
            this.buf = this.buf.subarray(frameLen);
        }
    }
    stripInboundMedia(): void {
        this.stripLeadingInterleaved();
    }
    private async readOneRtspMessage(): Promise<RtspResponse> {
        for (;;) {
            this.stripLeadingInterleaved();
            const s = this.buf.toString("latin1");
            const sep = "\r\n\r\n";
            const idx = s.indexOf(sep);
            if (idx < 0) {
                await this.waitFor(() => this.buf.toString("latin1").includes(sep));
                continue;
            }
            const headerEnd = idx + sep.length;
            const head = s.slice(0, idx);
            const lines = head.split(/\r\n|\n/);
            const statusLine = lines[0] ?? "";
            const headers = parseHeaders(lines.slice(1));
            const cl = Number(headers["content-length"] ?? "0");
            if (!Number.isFinite(cl) || cl < 0) {
                throw new Error("Invalid Content-Length in RTSP response");
            }
            const total = headerEnd + cl;
            while (this.buf.length < total) {
                await this.waitFor(() => this.buf.length >= total);
            }
            const body = this.buf.subarray(headerEnd, total).toString("utf8");
            this.buf = this.buf.subarray(total);
            return { statusLine, headers, body };
        }
    }
    writeInterleavedRtp(channel: number, rtp: Buffer): void {
        const hdr = Buffer.alloc(4);
        hdr[0] = 0x24;
        hdr[1] = channel & 0xff;
        hdr.writeUInt16BE(rtp.length, 2);
        this.socket.write(hdr);
        this.socket.write(rtp);
    }
}
function buildRtpPacket(seq: number, ts: number, ssrc: number, pt: number, payload: Buffer): Buffer {
    const hdr = Buffer.alloc(12);
    hdr[0] = 0x80;
    hdr[1] = pt & 0x7f;
    hdr.writeUInt16BE(seq & 0xffff, 2);
    hdr.writeUInt32BE(ts >>> 0, 4);
    hdr.writeUInt32BE(ssrc >>> 0, 8);
    return Buffer.concat([hdr, payload]);
}
type G711AudioSource = {
    stdout: Readable;
    stderr: Readable;
    on(event: "exit" | "error" | string, cb: (...args: never[]) => void): void;
    kill(): void;
};
function asG711AudioSource(child: ChildProcess): G711AudioSource {
    return {
        stdout: child.stdout as Readable,
        stderr: child.stderr as Readable,
        on(event: string, cb: (...args: never[]) => void): void {
            child.on(event as any, cb as any);
        },
        kill(): void {
            child.kill();
        }
    };
}
function spawnG711Source(kind: "tone" | "tick" | "mic" | "numbers", seconds: number, codec: "PCMU" | "PCMA", onNumber?: (n: number) => void): G711AudioSource {
    const acodec = codec === "PCMA" ? "pcm_alaw" : "pcm_mulaw";
    const format = codec === "PCMA" ? "alaw" : "mulaw";
    if (kind === "numbers") {
        return spawnNumbersG711Source(seconds, codec, onNumber);
    }
    if (kind === "tone" || kind === "tick") {
        const lavfi = kind === "tick"
            ? `aevalsrc=exprs='0.9*sin(2*PI*1500*t)*if(lt(mod(t\\,0.5)\\,0.04)\\,1\\,0)':s=8000:d=${seconds}`
            : "sine=frequency=880:sample_rate=8000";
        return asG711AudioSource(spawn("ffmpeg", [
            "-nostdin",
            "-loglevel",
            "error",
            "-re",
            "-f",
            "lavfi",
            "-i",
            lavfi,
            "-t",
            String(seconds),
            "-ac",
            "1",
            "-ar",
            "8000",
            "-acodec",
            acodec,
            "-f",
            format,
            "pipe:1"
        ], { stdio: ["ignore", "pipe", "pipe"] }));
    }
    return asG711AudioSource(spawn("ffmpeg", [
        "-nostdin",
        "-loglevel",
        "error",
        "-f",
        "alsa",
        "-i",
        "default",
        "-t",
        String(seconds),
        "-ac",
        "1",
        "-ar",
        "8000",
        "-acodec",
        acodec,
        "-f",
        format,
        "pipe:1"
    ], { stdio: ["ignore", "pipe", "pipe"] }));
}
function linearToMulaw(sample: number): number {
    const MULAW_MAX = 0x1fff;
    const BIAS = 0x84;
    let s = sample >> 2;
    let sign = 0;
    if (s < 0) {
        s = -s;
        sign = 0x80;
    }
    if (s > MULAW_MAX)
        s = MULAW_MAX;
    s += BIAS;
    let exponent = 7;
    for (let expMask = 0x4000; (s & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    }
    const mantissa = (s >> (exponent + 3)) & 0x0f;
    return ~(sign | (exponent << 4) | mantissa) & 0xff;
}
function linearToAlaw(sample: number): number {
    const ALAW_MAX = 0xfff;
    let s = sample >> 3;
    let sign = 0;
    if (s < 0) {
        s = -s;
        sign = 0x80;
    }
    if (s > ALAW_MAX)
        s = ALAW_MAX;
    let exponent = 7;
    for (let expMask = 0x800; (s & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
    }
    const mantissa = exponent === 0 ? (s >> 1) & 0x0f : (s >> (exponent + 3 - 1)) & 0x0f;
    return (sign | (exponent << 4) | mantissa) ^ 0x55;
}
function spawnNumbersG711Source(seconds: number, codec: "PCMU" | "PCMA", onNumber?: (n: number) => void): G711AudioSource {
    const encode = codec === "PCMA" ? linearToAlaw : linearToMulaw;
    const sampleRate = 8000;
    const totalSamples = Math.max(1, Math.floor(seconds * sampleRate));
    const stdout = new Readable({
        read() {
        }
    });
    const stderr = new Readable({
        read() {
        }
    });
    stderr.push(null);
    let killed = false;
    let sampleIndex = 0;
    let cursorInPattern = 0;
    let currentDigit = 1;
    let announced = false;
    const beepSamples = Math.floor(0.55 * sampleRate);
    const gapSamples = Math.floor(3.0 * sampleRate);
    const trailSamples = Math.floor(3.0 * sampleRate);
    const digitPatternLen = (d: number): number => d * (beepSamples + gapSamples) + trailSamples;
    const isBeepAt = (d: number, pos: number): boolean => {
        const unit = beepSamples + gapSamples;
        const toneRegion = d * unit;
        if (pos >= toneRegion)
            return false;
        return pos % unit < beepSamples;
    };
    const chunkSamples = 160;
    const started = Date.now();
    const timer = setInterval(() => {
        if (killed || sampleIndex >= totalSamples) {
            clearInterval(timer);
            stdout.push(null);
            return;
        }
        const elapsedMs = Date.now() - started;
        const expectedSamples = Math.floor((elapsedMs / 1000) * sampleRate) + chunkSamples * 2;
        while (sampleIndex < totalSamples && sampleIndex < expectedSamples) {
            if (!announced) {
                onNumber?.(currentDigit);
                announced = true;
            }
            const buf = Buffer.alloc(chunkSamples);
            let wrote = 0;
            for (; wrote < chunkSamples && sampleIndex < totalSamples; wrote++, sampleIndex++, cursorInPattern++) {
                const len = digitPatternLen(currentDigit);
                if (cursorInPattern >= len) {
                    cursorInPattern = 0;
                    currentDigit = currentDigit >= 9 ? 1 : currentDigit + 1;
                    announced = false;
                }
                const on = isBeepAt(currentDigit, cursorInPattern);
                const linear = on
                    ? Math.floor(22000 * Math.sin((2 * Math.PI * 1200 * sampleIndex) / sampleRate))
                    : 0;
                buf[wrote] = encode(linear);
            }
            if (wrote > 0)
                stdout.push(wrote === chunkSamples ? buf : buf.subarray(0, wrote));
        }
    }, 20);
    const handlers: {
        exit?: Array<(code: number | null) => void>;
        error?: Array<(e: Error) => void>;
    } = {};
    const fake: G711AudioSource = {
        stdout,
        stderr,
        on(event: string, cb: (...args: never[]) => void): void {
            if (event === "exit") {
                (handlers.exit ??= []).push(cb as (code: number | null) => void);
                stdout.on("end", () => {
                    if (!killed)
                        for (const h of handlers.exit ?? [])
                            h(0);
                });
            }
            else if (event === "error") {
                (handlers.error ??= []).push(cb as (e: Error) => void);
                stdout.on("error", (e) => {
                    for (const h of handlers.error ?? [])
                        h(e);
                });
            }
        },
        kill(): void {
            killed = true;
            clearInterval(timer);
            stdout.push(null);
        }
    };
    return fake;
}
export async function talkOnvifBackchannelPcmu(opts: {
    rtspContentUrl: string;
    audio: "tone" | "tick" | "mic" | "numbers";
    seconds: number;
    connectTimeoutMs?: number;
    skipRecvOnlySetup?: boolean;
    onNumber?: (n: number) => void;
}): Promise<TalkOnvifBackchannelResult> {
    const urlObj = new URL(opts.rtspContentUrl);
    if (urlObj.protocol !== "rtsp:") {
        return { ok: false, message: "Only rtsp:// is supported for talk.", sdpHadSendonlyAudio: false };
    }
    const host = urlObj.hostname;
    const port = urlObj.port ? Number(urlObj.port) : 554;
    const sock = new net.Socket();
    try {
        await new Promise<void>((resolve, reject) => {
            const ms = opts.connectTimeoutMs ?? 15000;
            const t = setTimeout(() => {
                sock.destroy();
                reject(new Error(`RTSP TCP connect timeout (${ms}ms)`));
            }, ms);
            sock.connect(port, host, () => {
                clearTimeout(t);
                resolve();
            });
            sock.once("error", (e) => {
                clearTimeout(t);
                reject(e);
            });
        });
        const session = new RtspInterleavedSession(sock, urlObj);
        const describeRes = await session.request("DESCRIBE", opts.rtspContentUrl, {
            Accept: "application/sdp",
            Require: ONVIF_BACKCHANNEL
        });
        if (describeRes.statusLine.includes("551")) {
            return {
                ok: false,
                describeStatusLine: describeRes.statusLine,
                message: "Server returned 551 Option not supported — firmware may not implement ONVIF RTSP backchannel on this URL.",
                sdpHadSendonlyAudio: false
            };
        }
        if (!describeRes.statusLine.includes("200")) {
            return {
                ok: false,
                describeStatusLine: describeRes.statusLine,
                message: `DESCRIBE failed: ${describeRes.statusLine}`,
                sdpHadSendonlyAudio: false
            };
        }
        const joinBase = effectiveJoinBase(describeRes.headers, opts.rtspContentUrl);
        const tracks = parseSdpTracks(describeRes.body, joinBase, opts.rtspContentUrl, host, port);
        const sdpHadSendonlyAudio = tracks.some((t) => t.direction === "sendonly" && t.kind === "audio");
        let ordered = orderTracksForSetup(tracks);
        if (opts.skipRecvOnlySetup) {
            ordered = ordered.filter((t) => t.direction === "sendonly");
            if (!ordered.length) {
                return {
                    ok: false,
                    describeStatusLine: describeRes.statusLine,
                    message: "skipRecvOnlySetup: no sendonly tracks in SDP.",
                    sdpHadSendonlyAudio
                };
            }
        }
        const sendTracks = ordered.filter((t) => t.direction === "sendonly");
        if (sendTracks.length === 0) {
            return {
                ok: false,
                describeStatusLine: describeRes.statusLine,
                message: "SDP has no a=sendonly audio track — device likely does not expose ONVIF backchannel here, or needs another profile.",
                sdpHadSendonlyAudio: false
            };
        }
        let nextInterleaved = 0;
        let sessionId = "";
        let sendRtpChannel = 0;
        for (const t of ordered) {
            const ch = nextInterleaved;
            const mode = t.direction === "sendonly" ? "record" : "play";
            const transport = `RTP/AVP/TCP;unicast;interleaved=${ch}-${ch + 1};mode=${mode}`;
            const headers: Record<string, string> = { Transport: transport };
            if (sessionId)
                headers.Session = sessionId;
            if (t.direction === "sendonly")
                headers.Require = ONVIF_BACKCHANNEL;
            const setup = await session.request("SETUP", t.controlUrl, headers);
            if (!setup.statusLine.includes("200")) {
                const bodyHint = setup.body?.trim() ? ` body=${setup.body.trim().slice(0, 200)}` : "";
                return {
                    ok: false,
                    describeStatusLine: describeRes.statusLine,
                    message: `SETUP failed for ${stripRtspUserinfoForRequestLine(t.controlUrl)} Transport=${transport}: ${setup.statusLine}${bodyHint}`,
                    sdpHadSendonlyAudio
                };
            }
            const sid = setup.headers.session?.split(";")[0]?.trim();
            if (sid && !sessionId)
                sessionId = sid;
            const tr = setup.headers.transport ?? "";
            const m = /interleaved=([0-9]+)-([0-9]+)/i.exec(tr);
            if (m) {
                nextInterleaved = Number(m[2]) + 1;
                if (t.direction === "sendonly")
                    sendRtpChannel = Number(m[1]);
            }
            else {
                if (t.direction === "sendonly")
                    sendRtpChannel = ch;
                nextInterleaved += 2;
            }
        }
        const play = await session.request("PLAY", opts.rtspContentUrl, {
            ...(sessionId ? { Session: sessionId } : {}),
            Require: ONVIF_BACKCHANNEL
        });
        if (!play.statusLine.includes("200")) {
            return {
                ok: false,
                message: `PLAY failed: ${play.statusLine}`,
                sdpHadSendonlyAudio,
                describeStatusLine: describeRes.statusLine
            };
        }
        const ssrc = crypto.randomBytes(4).readUInt32BE(0) >>> 0;
        let seq = crypto.randomBytes(2).readUInt16BE(0) & 0xffff;
        let ts = crypto.randomBytes(4).readUInt32BE(0) >>> 0;
        const send = sendTracks[0]!;
        const pt = send.payloadType;
        const g711 = send.g711 ?? (pt === 8 ? "PCMA" : "PCMU");
        const samplesPerPacket = 160;
        const ff = spawnG711Source(opts.audio, opts.seconds, g711, opts.onNumber);
        if (!ff.stdout || !ff.stderr) {
            return { ok: false, message: "audio source did not expose stdout/stderr pipes.", sdpHadSendonlyAudio };
        }
        const stderr: Buffer[] = [];
        ff.stderr.on("data", (d: Buffer) => stderr.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
        let audioBuf = Buffer.alloc(0);
        ff.stdout.on("data", (d: Buffer) => {
            audioBuf = Buffer.concat([audioBuf, d]);
        });
        await new Promise<void>((resolve, reject) => {
            ff.on("error", reject);
            const iv = setInterval(() => {
                session.stripInboundMedia();
                while (audioBuf.length >= samplesPerPacket) {
                    const payload = audioBuf.subarray(0, samplesPerPacket);
                    audioBuf = audioBuf.subarray(samplesPerPacket);
                    const rtp = buildRtpPacket(seq, ts, ssrc, pt, payload);
                    session.writeInterleavedRtp(sendRtpChannel, rtp);
                    seq = (seq + 1) & 0xffff;
                    ts = (ts + samplesPerPacket) >>> 0;
                }
            }, 20);
            ff.on("exit", (code) => {
                clearInterval(iv);
                session.stripInboundMedia();
                while (audioBuf.length >= samplesPerPacket) {
                    const payload = audioBuf.subarray(0, samplesPerPacket);
                    audioBuf = audioBuf.subarray(samplesPerPacket);
                    const rtp = buildRtpPacket(seq, ts, ssrc, pt, payload);
                    session.writeInterleavedRtp(sendRtpChannel, rtp);
                    seq = (seq + 1) & 0xffff;
                    ts = (ts + samplesPerPacket) >>> 0;
                }
                if (code !== 0 && code !== null) {
                    reject(new Error(`audio source exited ${code}: ${Buffer.concat(stderr).toString("utf8").slice(0, 500)}`));
                }
                else
                    resolve();
            });
        });
        if (sessionId) {
            await session
                .request("TEARDOWN", opts.rtspContentUrl, { Session: sessionId, Require: ONVIF_BACKCHANNEL })
                .catch(() => undefined);
        }
        return {
            ok: true,
            message: "Session finished: RTP G.711 was sent on the backchannel interleaved port (listen on the device speaker).",
            sdpHadSendonlyAudio,
            describeStatusLine: describeRes.statusLine
        };
    }
    finally {
        sock.destroy();
    }
}
export type LiveOnvifBackchannelTalk = {
    g711: "PCMU" | "PCMA";
    payloadType: number;
    sampleRate: 8000;
    pushPcm16le(chunk: Buffer): void;
    close(): Promise<void>;
};
export async function openLiveOnvifBackchannelTalk(opts: {
    rtspContentUrl: string;
    connectTimeoutMs?: number;
    skipRecvOnlySetup?: boolean;
}): Promise<LiveOnvifBackchannelTalk> {
    const urlObj = new URL(opts.rtspContentUrl);
    if (urlObj.protocol !== "rtsp:") {
        throw new Error("Only rtsp:// is supported for live talk.");
    }
    const host = urlObj.hostname;
    const port = urlObj.port ? Number(urlObj.port) : 554;
    const skipRecv = opts.skipRecvOnlySetup !== false;
    const sock = new net.Socket();
    await new Promise<void>((resolve, reject) => {
        const ms = opts.connectTimeoutMs ?? 15000;
        const t = setTimeout(() => {
            sock.destroy();
            reject(new Error(`RTSP TCP connect timeout (${ms}ms)`));
        }, ms);
        sock.connect(port, host, () => {
            clearTimeout(t);
            resolve();
        });
        sock.once("error", (e) => {
            clearTimeout(t);
            reject(e);
        });
    });
    const session = new RtspInterleavedSession(sock, urlObj);
    let sessionId = "";
    let closed = false;
    try {
        const describeRes = await session.request("DESCRIBE", opts.rtspContentUrl, {
            Accept: "application/sdp",
            Require: ONVIF_BACKCHANNEL
        });
        if (!describeRes.statusLine.includes("200")) {
            throw new Error(`DESCRIBE failed: ${describeRes.statusLine}`);
        }
        const joinBase = effectiveJoinBase(describeRes.headers, opts.rtspContentUrl);
        const tracks = parseSdpTracks(describeRes.body, joinBase, opts.rtspContentUrl, host, port);
        let ordered = orderTracksForSetup(tracks);
        if (skipRecv)
            ordered = ordered.filter((t) => t.direction === "sendonly");
        const sendTracks = ordered.filter((t) => t.direction === "sendonly");
        if (!sendTracks.length) {
            throw new Error("SDP has no a=sendonly audio backchannel track.");
        }
        let nextInterleaved = 0;
        let sendRtpChannel = 0;
        for (const t of ordered) {
            const ch = nextInterleaved;
            const mode = t.direction === "sendonly" ? "record" : "play";
            const transport = `RTP/AVP/TCP;unicast;interleaved=${ch}-${ch + 1};mode=${mode}`;
            const headers: Record<string, string> = { Transport: transport };
            if (sessionId)
                headers.Session = sessionId;
            if (t.direction === "sendonly")
                headers.Require = ONVIF_BACKCHANNEL;
            const setup = await session.request("SETUP", t.controlUrl, headers);
            if (!setup.statusLine.includes("200")) {
                throw new Error(`SETUP failed for ${stripRtspUserinfoForRequestLine(t.controlUrl)}: ${setup.statusLine}`);
            }
            const sid = setup.headers.session?.split(";")[0]?.trim();
            if (sid && !sessionId)
                sessionId = sid;
            const m = /interleaved=([0-9]+)-([0-9]+)/i.exec(setup.headers.transport ?? "");
            if (m) {
                nextInterleaved = Number(m[2]) + 1;
                if (t.direction === "sendonly")
                    sendRtpChannel = Number(m[1]);
            }
            else {
                if (t.direction === "sendonly")
                    sendRtpChannel = ch;
                nextInterleaved += 2;
            }
        }
        const play = await session.request("PLAY", opts.rtspContentUrl, {
            ...(sessionId ? { Session: sessionId } : {}),
            Require: ONVIF_BACKCHANNEL
        });
        if (!play.statusLine.includes("200")) {
            throw new Error(`PLAY failed: ${play.statusLine}`);
        }
        const send = sendTracks[0]!;
        const pt = send.payloadType;
        const g711 = send.g711 ?? (pt === 8 ? "PCMA" : "PCMU");
        const encode = g711 === "PCMA" ? linearToAlaw : linearToMulaw;
        const ssrc = crypto.randomBytes(4).readUInt32BE(0) >>> 0;
        let seq = crypto.randomBytes(2).readUInt16BE(0) & 0xffff;
        let ts = crypto.randomBytes(4).readUInt32BE(0) >>> 0;
        let pcmBuf = Buffer.alloc(0);
        const samplesPerPacket = 160;
        const pump = setInterval(() => {
            if (closed)
                return;
            session.stripInboundMedia();
        }, 50);
        return {
            g711,
            payloadType: pt,
            sampleRate: 8000,
            pushPcm16le(chunk: Buffer): void {
                if (closed || !chunk.length)
                    return;
                pcmBuf = Buffer.concat([pcmBuf, chunk]);
                while (pcmBuf.length >= samplesPerPacket * 2) {
                    const frame = pcmBuf.subarray(0, samplesPerPacket * 2);
                    pcmBuf = pcmBuf.subarray(samplesPerPacket * 2);
                    const payload = Buffer.alloc(samplesPerPacket);
                    for (let i = 0; i < samplesPerPacket; i++) {
                        payload[i] = encode(frame.readInt16LE(i * 2));
                    }
                    const rtp = buildRtpPacket(seq, ts, ssrc, pt, payload);
                    session.writeInterleavedRtp(sendRtpChannel, rtp);
                    seq = (seq + 1) & 0xffff;
                    ts = (ts + samplesPerPacket) >>> 0;
                }
            },
            async close(): Promise<void> {
                if (closed)
                    return;
                closed = true;
                clearInterval(pump);
                if (sessionId) {
                    await Promise.race([
                        session
                            .request("TEARDOWN", opts.rtspContentUrl, { Session: sessionId, Require: ONVIF_BACKCHANNEL })
                            .catch(() => undefined),
                        new Promise<void>((resolve) => setTimeout(resolve, 1500))
                    ]);
                }
                sock.destroy();
            }
        };
    }
    catch (e) {
        sock.destroy();
        throw e;
    }
}
