export type OnvifServiceName = "device" | "media" | "events" | "analytics";
export interface OnvifServices {
    device: string;
    media?: string;
    events?: string;
    analytics?: string;
}
