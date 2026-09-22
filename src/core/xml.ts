export function extractTagText(xml: string, localName: string): string | undefined {
    const re = new RegExp(`<(?:[A-Za-z_][\\w.-]*:)?${escapeRe(localName)}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${escapeRe(localName)}>`, "i");
    const m = xml.match(re);
    if (!m)
        return undefined;
    return decodeXmlEntities(m[1] ?? "").trim() || undefined;
}
export function extractAttribute(tagOpen: string, attrLocalName: string): string | undefined {
    const re = new RegExp(`\\b${escapeRe(attrLocalName)}\\s*=\\s*"([^"]*)"`, "i");
    const m = tagOpen.match(re);
    return m?.[1]?.trim() || undefined;
}
export function extractBlocks(xml: string, localName: string): Array<{
    openTag: string;
    innerXml: string;
}> {
    const re = new RegExp(`<((?:[A-Za-z_][\\w.-]*:)?${escapeRe(localName)})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, "gi");
    const out: Array<{
        openTag: string;
        innerXml: string;
    }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
        const fullOpen = `<${m[1]}${m[2]}>`;
        out.push({ openTag: fullOpen, innerXml: m[3] ?? "" });
    }
    return out;
}
export function getSoapFault(xml: string): {
    subcode?: string;
    reason?: string;
} | undefined {
    const isSoapFault = /<s:Fault\b/i.test(xml) || /<Fault\b/i.test(xml);
    if (!isSoapFault)
        return undefined;
    const subcode = xml.match(/<s:Subcode>\s*<s:Value>([^<]+)<\/s:Value>\s*<\/s:Subcode>/i)?.[1] ??
        xml.match(/<Subcode>\s*<Value>([^<]+)<\/Value>\s*<\/Subcode>/i)?.[1];
    const reason = xml.match(/<s:Reason>\s*<s:Text[^>]*>([\s\S]*?)<\/s:Text>\s*<\/s:Reason>/i)?.[1] ??
        xml.match(/<Reason>\s*<Text[^>]*>([\s\S]*?)<\/Text>\s*<\/Reason>/i)?.[1];
    const out: {
        subcode?: string;
        reason?: string;
    } = {};
    const sc = subcode?.trim();
    const rs = reason?.replace(/\s+/g, " ").trim();
    if (sc)
        out.subcode = sc;
    if (rs)
        out.reason = rs;
    return out;
}
function escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function decodeXmlEntities(s: string): string {
    return s
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'");
}
