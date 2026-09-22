export function parseIpv4(ip: string): number | undefined {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return undefined;
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return undefined;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

export function formatIpv4(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function expandCidrOrRange(network: string): string[] {
  const trimmed = network.trim();
  const range = /^(\d+\.\d+\.\d+\.\d+)\s*-\s*(\d+\.\d+\.\d+\.\d+)$/.exec(trimmed);
  if (range) {
    const a = parseIpv4(range[1]!);
    const b = parseIpv4(range[2]!);
    if (a === undefined || b === undefined) throw new Error(`Invalid IP range: ${network}`);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (end - start > 65_534) throw new Error("IP range too large (max /16 equivalent)");
    const out: string[] = [];
    for (let i = start; i <= end; i++) out.push(formatIpv4(i));
    return out;
  }

  const cidr = /^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/.exec(trimmed);
  if (cidr) {
    const base = parseIpv4(cidr[1]!);
    const prefix = Number(cidr[2]);
    if (base === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new Error(`Invalid CIDR: ${network}`);
    }
    if (prefix < 16) throw new Error("CIDR prefix must be >= 16 (too many hosts)");
    const hostBits = 32 - prefix;
    const size = 1 << hostBits;
    const mask = hostBits === 32 ? 0 : (~0 << hostBits) >>> 0;
    const networkAddr = (base & mask) >>> 0;
    const out: string[] = [];
    const first = prefix === 32 ? networkAddr : networkAddr + 1;
    const last = prefix === 32 ? networkAddr : networkAddr + size - 2;
    for (let i = first; i <= last; i++) out.push(formatIpv4(i >>> 0));
    return out;
  }

  if (parseIpv4(trimmed) !== undefined) return [trimmed];
  throw new Error(`Expected CIDR (192.168.1.0/24), range (192.168.1.1-192.168.1.50), or single IP`);
}
