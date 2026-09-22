export interface PullPointSubscription {
    referenceAddress: string;
    currentTime?: string;
    terminationTime?: string;
}
export interface EventMessage {
    topic?: string;
    utcTime?: string;
    rawXml: string;
}
export interface OnvifSimpleItem {
    name: string;
    value: string;
}
export interface EventMessageJson {
    topic?: string;
    utcTime?: string;
    propertyOperation?: string;
    source?: OnvifSimpleItem[];
    data?: OnvifSimpleItem[];
    key?: OnvifSimpleItem[];
    rawXml: string;
}
export interface PullMessagesResult {
    currentTime?: string;
    terminationTime?: string;
    messages: EventMessage[];
}
export interface EventListenerOptions {
    initialTerminationTime?: string;
    pullTimeout?: string;
    messageLimit?: number;
    requestTimeoutMs?: number;
}
