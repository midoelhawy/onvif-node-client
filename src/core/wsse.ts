import crypto from "node:crypto";
export type WssePasswordType = "PasswordDigest" | "PasswordText";
export function buildWsseUsernameTokenHeader(opts: {
    username: string;
    password: string;
    passwordType?: WssePasswordType;
}): string {
    const created = new Date().toISOString();
    const nonceBytes = crypto.randomBytes(16);
    const nonceB64 = nonceBytes.toString("base64");
    const passwordType = opts.passwordType ?? "PasswordDigest";
    if (passwordType === "PasswordText") {
        return `
    <wsse:Security>
      <wsse:UsernameToken>
        <wsse:Username>${escapeXml(opts.username)}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${escapeXml(opts.password)}</wsse:Password>
        <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce>
        <wsu:Created>${created}</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
    `.trim();
    }
    const sha1 = crypto.createHash("sha1");
    sha1.update(Buffer.concat([nonceBytes, Buffer.from(created, "utf8"), Buffer.from(opts.password, "utf8")]));
    const digestB64 = sha1.digest("base64");
    return `
  <wsse:Security>
    <wsse:UsernameToken>
      <wsse:Username>${escapeXml(opts.username)}</wsse:Username>
      <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digestB64}</wsse:Password>
      <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce>
      <wsu:Created>${created}</wsu:Created>
    </wsse:UsernameToken>
  </wsse:Security>
  `.trim();
}
function escapeXml(s: string): string {
    return s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}
