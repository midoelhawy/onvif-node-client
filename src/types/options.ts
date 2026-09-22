export type OnvifAuth = {
    mode: "none";
} | {
    mode: "wsse";
    username: string;
    password: string;
    usePasswordDigest?: boolean;
} | {
    mode: "http-basic";
    username: string;
    password: string;
} | {
    mode: "http-digest";
    username: string;
    password: string;
} | {
    mode: "auto";
    username: string;
    password: string;
    tryWsseFirst?: boolean;
};
export interface OnvifClientOptions {
    host: string;
    port?: number;
    path?: string;
    secure?: boolean;
    auth?: OnvifAuth;
    httpHostHeader?: string;
    allowInsecureTls?: boolean;
    timeoutMs?: number;
}
