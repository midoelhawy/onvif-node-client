import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import { OnvifSoapError } from "../types/soap.js";
export interface HttpClientOptions {
    allowInsecureTls?: boolean;
}
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export type PostXmlOptions = {
    timeoutMs: number;
    headers?: Record<string, string>;
    contentType?: string;
};
export class SimpleHttpClient {
    private readonly allowInsecureTls: boolean;
    constructor(opts?: HttpClientOptions) {
        this.allowInsecureTls = Boolean(opts?.allowInsecureTls);
    }
    async postXml(url: string, body: string, opts: PostXmlOptions, redirectDepth = 0): Promise<{
        status: number;
        text: string;
        headers: Headers;
    }> {
        if (redirectDepth > 8) {
            throw new OnvifSoapError("HTTP redirect loop or too many redirects");
        }
        const mergedHeaders: Record<string, string> = {
            Connection: "close",
            "Content-Type": opts.contentType ?? "application/soap+xml; charset=utf-8",
            "User-Agent": "onvif-node-client",
            ...(opts.headers ?? {})
        };
        const res = await this.singlePost(url, body, { ...opts, headers: mergedHeaders });
        const loc = res.headers.get("location") ?? res.headers.get("Location");
        if (loc && REDIRECT_STATUSES.has(res.status)) {
            const nextUrl = new URL(loc.trim(), url).href;
            return this.postXml(nextUrl, body, opts, redirectDepth + 1);
        }
        return res;
    }
    private async singlePost(url: string, body: string, opts: {
        timeoutMs: number;
        headers: Record<string, string>;
    }): Promise<{
        status: number;
        text: string;
        headers: Headers;
    }> {
        const u = new URL(url);
        const isHttps = u.protocol === "https:";
        const lib = isHttps ? https : http;
        const portNum = u.port ? Number(u.port) : isHttps ? 443 : 80;
        const bodyBuf = Buffer.from(body, "utf8");
        const headers: Record<string, string> = {
            ...opts.headers,
            "Content-Length": String(bodyBuf.length)
        };
        return await new Promise((resolve, reject) => {
            const req = lib.request({
                protocol: u.protocol,
                hostname: u.hostname,
                port: portNum,
                path: `${u.pathname}${u.search}`,
                method: "POST",
                headers,
                timeout: opts.timeoutMs,
                ...(isHttps
                    ? {
                        rejectUnauthorized: this.allowInsecureTls ? false : true
                    }
                    : {})
            }, (res) => {
                const chunks: Buffer[] = [];
                res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                res.on("end", () => {
                    const text = Buffer.concat(chunks).toString("utf8");
                    const headersOut = nodeHeadersToWebHeaders(res.headers);
                    resolve({ status: res.statusCode ?? 0, text, headers: headersOut });
                });
            });
            if (typeof req.removeHeader === "function") {
                req.removeHeader("Expect");
            }
            req.on("timeout", () => {
                req.destroy(new Error(`Request timed out after ${opts.timeoutMs}ms`));
            });
            req.on("error", (err) => {
                reject(new OnvifSoapError(`HTTP request failed: ${String((err as Error)?.message ?? err)}`, {
                    cause: err
                }));
            });
            req.write(bodyBuf);
            req.end();
        });
    }
}
function nodeHeadersToWebHeaders(h: http.IncomingHttpHeaders): Headers {
    const out = new Headers();
    for (const [key, value] of Object.entries(h)) {
        if (value == null)
            continue;
        if (Array.isArray(value)) {
            for (const v of value) {
                if (v != null)
                    out.append(key, v);
            }
        }
        else {
            out.set(key, value);
        }
    }
    return out;
}
