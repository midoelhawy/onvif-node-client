import type { OnvifAuth, OnvifClientOptions } from "../types/options.js";
import type { OnvifRequestOptions } from "../types/transport.js";
import { SimpleHttpClient } from "../core/http.js";
import { buildWsseUsernameTokenHeader } from "../core/wsse.js";
import crypto from "node:crypto";
export interface OnvifTransportResponse {
    status: number;
    text: string;
}
export class OnvifTransport {
    private readonly http: SimpleHttpClient;
    private readonly auth: OnvifAuth | undefined;
    private readonly defaultTimeoutMs: number;
    private readonly httpHostHeader: string | undefined;
    constructor(opts: OnvifClientOptions) {
        this.http = new SimpleHttpClient({ allowInsecureTls: Boolean(opts.allowInsecureTls) });
        this.auth = opts.auth;
        this.defaultTimeoutMs = opts.timeoutMs ?? 10000;
        this.httpHostHeader = opts.httpHostHeader?.trim() || undefined;
    }
    async post(url: string, envelopeXml: string, opts?: OnvifRequestOptions): Promise<OnvifTransportResponse> {
        const timeoutMs = opts?.timeoutMs ?? this.defaultTimeoutMs;
        const baseHeaders: Record<string, string> = {};
        if (opts?.soapAction) {
            baseHeaders.SOAPAction = opts.soapAction;
        }
        const auth = this.auth ?? { mode: "none" as const };
        const attempts = this.buildAttempts(auth);
        let last: {
            status: number;
            text: string;
        } | undefined;
        for (const attempt of attempts) {
            const attemptHeaders: Record<string, string> = {
                ...baseHeaders,
                ...(("headers" in attempt && attempt.headers) ? attempt.headers : {}),
                ...(this.httpHostHeader ? { Host: this.httpHostHeader } : {})
            };
            const xml = attempt.kind === "wsse" ? this.injectWsseHeader(envelopeXml, attempt.wsse) : envelopeXml;
            const res = await this.http.postXml(url, xml, { timeoutMs, headers: attemptHeaders });
            last = { status: res.status, text: res.text };
            if (res.status !== 401) {
                return last;
            }
            const www = res.headers.get("www-authenticate") ?? res.headers.get("WWW-Authenticate") ?? "";
            if (attempt.kind === "http-digest" && attempt.digest && www) {
                const challenge = parseDigestChallenge(www);
                if (challenge) {
                    const authz = buildDigestAuthorizationHeader({
                        username: attempt.digest.username,
                        password: attempt.digest.password,
                        method: "POST",
                        url,
                        challenge
                    });
                    const retryHeaders = { ...attemptHeaders, Authorization: authz };
                    const retryRes = await this.http.postXml(url, xml, { timeoutMs, headers: retryHeaders });
                    last = { status: retryRes.status, text: retryRes.text };
                    if (retryRes.status !== 401)
                        return last;
                }
            }
        }
        return last ?? { status: 0, text: "" };
    }
    private buildAttempts(auth: OnvifAuth): Attempt[] {
        if (auth.mode === "none")
            return [{ kind: "none" }];
        if (auth.mode === "wsse") {
            return [
                {
                    kind: "wsse",
                    wsse: { username: auth.username, password: auth.password, usePasswordDigest: auth.usePasswordDigest ?? true }
                }
            ];
        }
        if (auth.mode === "http-basic") {
            return [{ kind: "http-basic", headers: { Authorization: buildBasicAuthHeader(auth.username, auth.password) } }];
        }
        if (auth.mode === "http-digest") {
            return [{ kind: "http-digest", digest: { username: auth.username, password: auth.password } }];
        }
        const tryWsseFirst = auth.tryWsseFirst ?? true;
        const wsseAttempts: Attempt[] = [
            {
                kind: "wsse",
                wsse: { username: auth.username, password: auth.password, usePasswordDigest: true }
            },
            {
                kind: "wsse",
                wsse: { username: auth.username, password: auth.password, usePasswordDigest: false }
            }
        ];
        const httpAttempts: Attempt[] = [
            { kind: "http-digest", digest: { username: auth.username, password: auth.password } },
            { kind: "http-basic", headers: { Authorization: buildBasicAuthHeader(auth.username, auth.password) } }
        ];
        const out: Attempt[] = [{ kind: "none" }];
        if (tryWsseFirst)
            out.push(...wsseAttempts, ...httpAttempts);
        else
            out.push(...httpAttempts, ...wsseAttempts);
        return out;
    }
    private injectWsseHeader(envelopeXml: string, creds: {
        username: string;
        password: string;
        usePasswordDigest: boolean;
    }): string {
        const header = buildWsseUsernameTokenHeader({
            username: creds.username,
            password: creds.password,
            passwordType: creds.usePasswordDigest ? "PasswordDigest" : "PasswordText"
        });
        if (/<soap:Header>/i.test(envelopeXml)) {
            return envelopeXml.replace(/<soap:Header>/i, `<soap:Header>${header}`);
        }
        return envelopeXml.replace(/<soap:Envelope\b([^>]*)>/i, `<soap:Envelope$1><soap:Header>${header}</soap:Header>`);
    }
}
type Attempt = {
    kind: "none";
} | {
    kind: "wsse";
    wsse: {
        username: string;
        password: string;
        usePasswordDigest: boolean;
    };
} | {
    kind: "http-basic";
    headers: Record<string, string>;
} | {
    kind: "http-digest";
    digest: {
        username: string;
        password: string;
    };
};
function buildBasicAuthHeader(username: string, password: string): string {
    const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
    return `Basic ${token}`;
}
function parseDigestChallenge(header: string): DigestChallenge | undefined {
    const idx = header.toLowerCase().indexOf("digest ");
    if (idx < 0)
        return undefined;
    const params = header.slice(idx + 7);
    const out: Record<string, string> = {};
    const re = /([a-z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))\s*(?:,|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(params))) {
        const k = m[1]?.toLowerCase();
        if (!k)
            continue;
        const v = (m[2] ?? m[3] ?? "").trim();
        out[k] = v;
    }
    if (!out.realm || !out.nonce)
        return undefined;
    const qop = out.qop?.split(",")?.map((s) => s.trim().toLowerCase());
    const challenge: DigestChallenge = {
        realm: out.realm,
        nonce: out.nonce
    };
    if (out.opaque)
        challenge.opaque = out.opaque;
    if (out.algorithm)
        challenge.algorithm = out.algorithm;
    if (qop && qop.length > 0)
        challenge.qop = qop;
    return challenge;
}
type DigestChallenge = {
    realm: string;
    nonce: string;
    opaque?: string;
    algorithm?: string;
    qop?: string[];
};
function buildDigestAuthorizationHeader(opts: {
    username: string;
    password: string;
    method: "POST";
    url: string;
    challenge: DigestChallenge;
}): string {
    const u = new URL(opts.url);
    const uri = `${u.pathname}${u.search}`;
    const qop = opts.challenge.qop?.includes("auth") ? "auth" : undefined;
    const nc = "00000001";
    const cnonce = crypto.randomBytes(16).toString("hex");
    const ha1 = md5(`${opts.username}:${opts.challenge.realm}:${opts.password}`);
    const ha2 = md5(`${opts.method}:${uri}`);
    const response = qop
        ? md5(`${ha1}:${opts.challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        : md5(`${ha1}:${opts.challenge.nonce}:${ha2}`);
    const parts: string[] = [];
    parts.push(`username="${opts.username}"`);
    parts.push(`realm="${opts.challenge.realm}"`);
    parts.push(`nonce="${opts.challenge.nonce}"`);
    parts.push(`uri="${uri}"`);
    parts.push(`response="${response}"`);
    if (opts.challenge.opaque)
        parts.push(`opaque="${opts.challenge.opaque}"`);
    if (qop) {
        parts.push(`qop=${qop}`);
        parts.push(`nc=${nc}`);
        parts.push(`cnonce="${cnonce}"`);
    }
    if (opts.challenge.algorithm)
        parts.push(`algorithm=${opts.challenge.algorithm}`);
    return `Digest ${parts.join(", ")}`;
}
function md5(s: string): string {
    return crypto.createHash("md5").update(s, "utf8").digest("hex");
}
