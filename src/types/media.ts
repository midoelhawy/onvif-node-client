export interface MediaProfileSummary {
    token: string;
    name?: string;
}
export interface MediaProfile extends MediaProfileSummary {
    video?: {
        encoding?: string;
        width?: number;
        height?: number;
        frameRateLimit?: number;
    };
    audio?: {
        sourceToken?: string;
        encoderToken?: string;
        encoding?: string;
        bitrate?: number;
    };
}
export interface StreamUri {
    profileToken: string;
    uri: string;
    invalidAfterConnect?: boolean;
    invalidAfterReboot?: boolean;
    timeout?: string;
}
