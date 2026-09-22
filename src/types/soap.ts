export interface SoapFault {
    subcode?: string;
    reason?: string;
    raw?: string;
}
export class OnvifSoapError extends Error {
    readonly fault: SoapFault | undefined;
    readonly status: number | undefined;
    constructor(message: string, opts?: {
        fault?: SoapFault;
        status?: number;
        cause?: unknown;
    }) {
        super(message, { cause: opts?.cause as unknown });
        this.name = "OnvifSoapError";
        this.fault = opts?.fault;
        this.status = opts?.status;
    }
}
