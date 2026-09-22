import net from "node:net";
import { URL } from "node:url";
export interface RtspBackchannelProbeOptions {
    timeoutMs?: number;
}
export interface RtspBackchannelProbeResult {
    rtspUrl: string;
    sdpSuggestsAudioBackchannel: boolean;
    rtspStatusLine?: string;
    unsupportedFeatureTags?: string;
    sdpPreview?: string;
    notes: string[];
}
export async function probeRtspBackchannelDescribe(rtspUrl: string, opts?: RtspBackchannelProbeOptions): Promise<RtspBackchannelProbeResult> {
    const timeoutMs = opts?.timeoutMs ?? 8000;
    const notes: string[] = [];
    let u: URL;
    try {
        u = new URL(rtspUrl);
    }
    catch {
        return {
            rtspUrl,
            sdpSuggestsAudioBackchannel: false,
            notes: ["Invalid RTSP URL."]
        };
    }
    if (u.protocol !== "rtsp:" && u.protocol !== "rtsps:") {
        return { rtspUrl, sdpSuggestsAudioBackchannel: false, notes: ["URL is not rtsp:// or rtsps://"] };
    }
    if (u.protocol === "rtsps:") {
        notes.push("rtsps:// is not implemented in this probe; use rtsp:// or extend with TLS.");
        return { rtspUrl, sdpSuggestsAudioBackchannel: false, notes };
    }
    const host = u.hostname;
    const port = u.port ? Number(u.port) : 554;
    const describeUri = (() => {
        const x = new URL(rtspUrl);
        x.username = "";
        x.password = "";
        return x.href;
    })();
    const lines = [
        `DESCRIBE ${describeUri} RTSP/1.0`,
        `CSeq: 1`,
        `Require: www.onvif.org/ver20/backchannel`,
        `User-Agent: onvif-node-client`
    ];
    if (u.username || u.password) {
        const user = decodeURIComponent(u.username);
        const pass = decodeURIComponent(u.password);
        const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64");
        lines.push(`Authorization: Basic ${token}`);
    }
    lines.push("", "");
    const payload = lines.join("\r\n");
    let raw: string;
    try {
        raw = await rtspReadResponse(host, port, payload, timeoutMs);
    }
    catch (e) {
        notes.push(String((e as Error).message));
        return { rtspUrl, sdpSuggestsAudioBackchannel: false, notes };
    }
    const { statusLine, headers, body } = parseRtspMessage(raw);
    const unsupported = headers["unsupported"] ?? headers["www.onvif.org/ver20/backchannel"];
    if (unsupported) {
        notes.push(`Unsupported / limitation header: ${unsupported}`);
    }
    if (statusLine?.includes("401")) {
        notes.push("RTSP 401 — add credentials to the RTSP URL (rtsp://user:pass@host:port/...) if the device requires RTSP auth.");
    }
    if (statusLine?.includes("404")) {
        notes.push("RTSP 404 — stream path invalid for this probe; try another profile / GetStreamUri.");
    }
    const sdpPreview = body ? body.slice(0, 600).replace(/\r\n/g, "\n") : undefined;
    const sdpSuggests = body ? sdpHasAudioSendonlyBackchannel(body) : false;
    const result: RtspBackchannelProbeResult = {
        rtspUrl,
        sdpSuggestsAudioBackchannel: Boolean(statusLine?.includes("200") && sdpSuggests),
        notes
    };
    if (statusLine !== undefined)
        result.rtspStatusLine = statusLine;
    if (unsupported)
        result.unsupportedFeatureTags = unsupported;
    if (sdpPreview !== undefined)
        result.sdpPreview = sdpPreview;
    return result;
}
function sdpHasAudioSendonlyBackchannel(sdp: string): boolean {
    const lines = sdp.split(/\r\n|\n/);
    let inAudio = false;
    let audioHasSendonly = false;
    for (const line of lines) {
        if (line.startsWith("m=audio")) {
            if (inAudio && audioHasSendonly)
                return true;
            inAudio = true;
            audioHasSendonly = false;
            continue;
        }
        if (line.startsWith("m=")) {
            if (inAudio && audioHasSendonly)
                return true;
            inAudio = false;
            continue;
        }
        if (inAudio && line.trim() === "a=sendonly") {
            audioHasSendonly = true;
        }
    }
    return inAudio && audioHasSendonly;
}
function parseRtspMessage(raw: string): {
    statusLine?: string;
    headers: Record<string, string>;
    body: string;
} {
    const sep = raw.includes("\r\n\r\n") ? "\r\n\r\n" : "\n\n";
    const idx = raw.indexOf(sep);
    if (idx < 0) {
        return { headers: {}, body: raw };
    }
    const head = raw.slice(0, idx);
    let body = raw.slice(idx + sep.length);
    const headerLines = head.split(/\r\n|\n/);
    const statusLine = headerLines[0]?.trim();
    const headers: Record<string, string> = {};
    for (let i = 1; i < headerLines.length; i++) {
        const hl = headerLines[i];
        if (hl === undefined)
            continue;
        const c = hl.indexOf(":");
        if (c < 0)
            continue;
        const k = hl.slice(0, c).trim();
        const v = hl.slice(c + 1).trim();
        headers[k.toLowerCase()] = v;
    }
    const cl = headers["content-length"];
    if (cl) {
        const n = Number(cl);
        if (Number.isFinite(n) && n >= 0) {
            body = body.slice(0, n);
        }
    }
    const out: {
        headers: Record<string, string>;
        body: string;
        statusLine?: string;
    } = { headers, body };
    if (statusLine !== undefined && statusLine.length > 0)
        out.statusLine = statusLine;
    return out;
}
function rtspReadResponse(host: string, port: number, payload: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const sock = net.createConnection({ host, port }, () => {
            sock.write(payload);
        });
        const chunks: Buffer[] = [];
        let settled = false;
        const t = setTimeout(() => {
            if (!settled) {
                settled = true;
                sock.destroy();
                reject(new Error(`RTSP TCP timeout after ${timeoutMs}ms`));
            }
        }, timeoutMs);
        const tryFinish = () => {
            if (settled)
                return;
            const text = Buffer.concat(chunks).toString("utf8");
            const sep = text.includes("\r\n\r\n") ? "\r\n\r\n" : text.includes("\n\n") ? "\n\n" : null;
            if (!sep)
                return;
            const idx = text.indexOf(sep);
            const headersPart = text.slice(0, idx);
            const bodyStart = idx + sep.length;
            const m = /\bContent-Length:\s*(\d+)/i.exec(headersPart);
            if (!m) {
                settled = true;
                clearTimeout(t);
                sock.destroy();
                resolve(text);
                return;
            }
            const len = Number(m[1]);
            if (text.length - bodyStart >= len) {
                settled = true;
                clearTimeout(t);
                sock.destroy();
                resolve(text.slice(0, bodyStart + len));
            }
        };
        sock.on("data", (d) => {
            chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d));
            tryFinish();
        });
        sock.on("error", (e) => {
            clearTimeout(t);
            if (!settled) {
                settled = true;
                reject(e);
            }
        });
        sock.on("close", () => {
            clearTimeout(t);
            if (!settled) {
                settled = true;
                resolve(Buffer.concat(chunks).toString("utf8"));
            }
        });
    });
}
