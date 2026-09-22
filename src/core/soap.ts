import { OnvifSoapError, type SoapFault } from "../types/soap.js";
import { getSoapFault } from "./xml.js";
export function buildSoapEnvelope(opts: {
    body: string;
    header?: string;
    extraXmlns?: Record<string, string>;
}): string {
    const xmlns = {
        soap: "http://www.w3.org/2003/05/soap-envelope",
        wsse: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd",
        wsu: "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd",
        ...opts.extraXmlns
    };
    const xmlnsStr = Object.entries(xmlns)
        .map(([k, v]) => `xmlns:${k}="${v}"`)
        .join(" ");
    return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope ${xmlnsStr}>
  ${opts.header ? `<soap:Header>${opts.header}</soap:Header>` : ""}
  <soap:Body>
    ${opts.body}
  </soap:Body>
</soap:Envelope>`;
}
export function throwIfSoapFault(xml: string, status?: number): void {
    const fault = getSoapFault(xml);
    if (!fault)
        return;
    const soapFault: SoapFault = { ...fault, raw: xml };
    throw new OnvifSoapError("ONVIF SOAP Fault", {
        fault: soapFault,
        ...(status === undefined ? {} : { status })
    });
}
