import { URL } from "node:url";
import type { OnvifClientOptions } from "../types/options.js";
export interface OnvifDeviceConnectionOptions extends OnvifClientOptions {
    rtspUrl?: string;
    rtspHost?: string;
    rtspPort?: number;
    profileToken?: string;
}
export function rewriteRtspEndpoint(rtspUrl: string, rewrite?: {
    host?: string;
    port?: number;
}): string {
    if (!rewrite?.host && rewrite?.port === undefined)
        return rtspUrl;
    try {
        const u = new URL(rtspUrl);
        if (rewrite.host)
            u.hostname = rewrite.host;
        if (rewrite.port !== undefined)
            u.port = String(rewrite.port);
        return u.href;
    }
    catch {
        return rtspUrl;
    }
}
export function injectRtspCredentials(rtspUrl: string, username: string, password: string): string {
    try {
        const u = new URL(rtspUrl);
        if (u.username || u.password)
            return rtspUrl;
        u.username = username;
        u.password = password;
        return u.href;
    }
    catch {
        return rtspUrl;
    }
}
export function credentialsFromOnvifAuth(auth: OnvifClientOptions["auth"]): {
    username: string;
    password: string;
} | undefined {
    if (!auth || auth.mode === "none")
        return undefined;
    if (auth.mode === "auto" ||
        auth.mode === "wsse" ||
        auth.mode === "http-basic" ||
        auth.mode === "http-digest") {
        return { username: auth.username, password: auth.password };
    }
    return undefined;
}
export function maskRtspCredentials(rtspUrl: string): string {
    try {
        const u = new URL(rtspUrl);
        if (u.password)
            u.password = "***";
        return u.href;
    }
    catch {
        return rtspUrl;
    }
}
export function prepareRtspUrl(rtspUrl: string, opts: OnvifDeviceConnectionOptions): string {
    let url = rewriteRtspEndpoint(rtspUrl, {
        ...(opts.rtspHost ? { host: opts.rtspHost } : {}),
        ...(opts.rtspPort !== undefined ? { port: opts.rtspPort } : {})
    });
    const creds = credentialsFromOnvifAuth(opts.auth);
    if (creds)
        url = injectRtspCredentials(url, creds.username, creds.password);
    return url;
}
