import dgram from "node:dgram";
import crypto from "node:crypto";
import net from "node:net";
import { expandCidrOrRange } from "../core/cidr.js";
import { extractBlocks, extractTagText } from "../core/xml.js";
import { SimpleHttpClient } from "../core/http.js";
import { parseOnvifScopes, looksLikeMac } from "../core/onvifScopes.js";
import { DeviceService } from "./deviceService.js";
import { OnvifTransport } from "../transport/transport.js";
import type { OnvifClientOptions } from "../types/options.js";
import type {
  OnvifDiscoveredDevice,
  OnvifNetworkScanOptions,
  OnvifNetworkScanProgress,
  OnvifNetworkScanResult
} from "../types/discovery.js";

const WS_DISCOVERY_PORT = 3702;
const WS_DISCOVERY_MULTICAST = "239.255.255.250";

function uuidUrn(): string {
  return `uuid:${crypto.randomUUID()}`;
}

function buildProbeXml(types: string[]): string {
  const typesXml =
    types.length > 0
      ? `<d:Types>${types.map((t) => escapeXml(t)).join(" ")}</d:Types>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"` +
    ` xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"` +
    ` xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"` +
    ` xmlns:dn="http://www.onvif.org/ver10/network/wsdl"` +
    ` xmlns:tds="http://www.onvif.org/ver10/device/wsdl">` +
    `<e:Header>` +
    `<w:MessageID>${uuidUrn()}</w:MessageID>` +
    `<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>` +
    `<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>` +
    `</e:Header>` +
    `<e:Body><d:Probe>${typesXml}</d:Probe></e:Body>` +
    `</e:Envelope>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function splitTokens(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function withScopeInfo(device: OnvifDiscoveredDevice): OnvifDiscoveredDevice {
  const info = parseOnvifScopes(device.scopes);
  const manufacturer = device.manufacturer ?? info.manufacturer;
  const model = device.model ?? info.model;
  const name = device.name ?? info.name;
  const hardware = device.hardware ?? info.hardware;
  const mac = device.mac ?? info.mac;
  const location = device.location ?? info.location;
  const profiles = device.profiles?.length ? device.profiles : info.profiles;
  const scopeTypes = device.scopeTypes?.length ? device.scopeTypes : info.types;
  return {
    ...device,
    ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}),
    ...(name ? { name } : {}),
    ...(hardware ? { hardware } : {}),
    ...(mac ? { mac } : {}),
    ...(location ? { location } : {}),
    ...(profiles.length ? { profiles } : {}),
    ...(scopeTypes.length ? { scopeTypes } : {})
  };
}

function pickPreferredHttpXAddr(xAddrs: string[]): string | undefined {
  const http = xAddrs.find((u) => /^https?:\/\//i.test(u) && !u.includes("["));
  return http ?? xAddrs.find((u) => /^https?:\/\//i.test(u));
}

function httpPortFromXAddrs(xAddrs: string[]): number {
  const xaddr = pickPreferredHttpXAddr(xAddrs);
  if (!xaddr) return 80;
  try {
    const u = new URL(xaddr);
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return 80;
  }
}

function parseProbeMatches(xml: string, fromAddress: string, _fromPort: number): OnvifDiscoveredDevice[] {
  const blocks = extractBlocks(xml, "ProbeMatch");
  if (!blocks.length) {
    if (/ProbeMatch/i.test(xml) || /XAddrs/i.test(xml)) {
      const xAddrs = splitTokens(extractTagText(xml, "XAddrs"));
      if (xAddrs.length) {
        return [
          withScopeInfo({
            address: fromAddress,
            port: httpPortFromXAddrs(xAddrs),
            xAddrs,
            types: splitTokens(extractTagText(xml, "Types")),
            scopes: splitTokens(extractTagText(xml, "Scopes")),
            ...(extractTagText(xml, "MetadataVersion")
              ? { metadataVersion: extractTagText(xml, "MetadataVersion")! }
              : {}),
            rawXml: xml
          })
        ];
      }
    }
    return [];
  }
  return blocks.map((b) => {
    const xAddrs = splitTokens(extractTagText(b.innerXml, "XAddrs"));
    const types = splitTokens(extractTagText(b.innerXml, "Types"));
    const scopes = splitTokens(extractTagText(b.innerXml, "Scopes"));
    const metadataVersion = extractTagText(b.innerXml, "MetadataVersion");
    return withScopeInfo({
      address: fromAddress,
      port: httpPortFromXAddrs(xAddrs),
      xAddrs,
      types,
      scopes,
      ...(metadataVersion ? { metadataVersion } : {}),
      rawXml: xml
    });
  });
}

function hostFromXAddr(xaddr: string): string | undefined {
  try {
    return new URL(xaddr).hostname;
  } catch {
    return undefined;
  }
}

function mergeDevices(into: Map<string, OnvifDiscoveredDevice>, device: OnvifDiscoveredDevice): void {
  const keyHost =
    device.xAddrs.map(hostFromXAddr).find((h) => h && !h.includes(":")) ??
    device.xAddrs.map(hostFromXAddr).find(Boolean) ??
    device.address;
  const enriched = withScopeInfo(device);
  const existing = into.get(keyHost);
  if (!existing) {
    into.set(keyHost, {
      ...enriched,
      address: keyHost,
      xAddrs: [...enriched.xAddrs],
      types: [...enriched.types],
      scopes: [...enriched.scopes]
    });
    return;
  }
  const xAddrs = new Set([...existing.xAddrs, ...enriched.xAddrs]);
  const types = new Set([...existing.types, ...enriched.types]);
  const scopes = new Set([...existing.scopes, ...enriched.scopes]);
  const mergedXAddrs = [...xAddrs];
  into.set(
    keyHost,
    withScopeInfo({
      ...existing,
      ...enriched,
      address: keyHost,
      port: httpPortFromXAddrs(mergedXAddrs),
      xAddrs: mergedXAddrs,
      types: [...types],
      scopes: [...scopes],
      ...(enriched.metadataVersion || existing.metadataVersion
        ? { metadataVersion: enriched.metadataVersion ?? existing.metadataVersion }
        : {}),
      ...(existing.firmwareVersion || enriched.firmwareVersion
        ? { firmwareVersion: existing.firmwareVersion ?? enriched.firmwareVersion }
        : {}),
      ...(existing.serialNumber || enriched.serialNumber
        ? { serialNumber: existing.serialNumber ?? enriched.serialNumber }
        : {}),
      ...(existing.hardwareId || enriched.hardwareId
        ? { hardwareId: existing.hardwareId ?? enriched.hardwareId }
        : {})
    })
  );
}

function clientOptionsFromXAddr(
  xaddr: string,
  auth: OnvifNetworkScanOptions["auth"] | undefined,
  timeoutMs: number
): OnvifClientOptions | undefined {
  try {
    const u = new URL(xaddr);
    let path = u.pathname || "/onvif";
    if (/\/device_service\/?$/i.test(path)) {
      path = path.replace(/\/device_service\/?$/i, "") || "/onvif";
    }
    const port = u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 80;
    return {
      host: u.hostname,
      port,
      path,
      secure: u.protocol === "https:",
      allowInsecureTls: true,
      timeoutMs,
      ...(auth
        ? { auth: { mode: "auto" as const, username: auth.username, password: auth.password } }
        : {})
    };
  } catch {
    return undefined;
  }
}

async function enrichDevice(
  device: OnvifDiscoveredDevice,
  opts: {
    timeoutMs: number;
    auth?: OnvifNetworkScanOptions["auth"];
  }
): Promise<OnvifDiscoveredDevice> {
  const xaddr = pickPreferredHttpXAddr(device.xAddrs);
  if (!xaddr) return device;
  const clientOpts = clientOptionsFromXAddr(xaddr, opts.auth, opts.timeoutMs);
  if (!clientOpts) return device;
  try {
    const transport = new OnvifTransport(clientOpts);
    const svc = new DeviceService(transport, { device: xaddr });
    const info = await svc.getDeviceInformation({ timeoutMs: opts.timeoutMs });
    const macCandidate =
      device.mac ??
      (looksLikeMac(info.serialNumber) ? info.serialNumber.toLowerCase() : undefined) ??
      (looksLikeMac(info.hardwareId) ? info.hardwareId.toLowerCase() : undefined);
    return withScopeInfo({
      ...device,
      ...(info.manufacturer ? { manufacturer: info.manufacturer } : {}),
      ...(info.model ? { model: info.model } : {}),
      ...(info.firmwareVersion ? { firmwareVersion: info.firmwareVersion } : {}),
      ...(info.serialNumber ? { serialNumber: info.serialNumber } : {}),
      ...(info.hardwareId ? { hardwareId: info.hardwareId } : {}),
      ...(macCandidate ? { mac: macCandidate } : {})
    });
  } catch {
    return device;
  }
}
async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) {
      if (signal?.aborted) throw new Error("Scan aborted");
      const idx = i++;
      const item = items[idx]!;
      await fn(item, idx);
    }
  });
  await Promise.all(workers);
}

function tcpConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function httpOnvifProbe(host: string, port: number, timeoutMs: number): Promise<OnvifDiscoveredDevice | undefined> {
  const open = await tcpConnect(host, port, Math.min(timeoutMs, 800));
  if (!open) return undefined;
  const client = new SimpleHttpClient({ allowInsecureTls: true });
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">` +
    `<s:Body><GetSystemDateAndTime xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body>` +
    `</s:Envelope>`;
  const paths = ["/onvif/device_service", "/device_service"];
  for (const p of paths) {
    const url = `http://${host}:${port}${p}`;
    try {
      const res = await client.postXml(url, body, {
        timeoutMs: Math.min(timeoutMs, 2000),
        contentType: "application/soap+xml; charset=utf-8",
        headers: {
          SOAPAction: "http://www.onvif.org/ver10/device/wsdl/GetSystemDateAndTime"
        }
      });
      if (
        (res.status >= 200 && res.status < 300) ||
        res.status === 401 ||
        res.status === 403 ||
        /Envelope/i.test(res.text)
      ) {
        return {
          address: host,
          port,
          xAddrs: [url],
          types: ["tds:Device"],
          scopes: []
        };
      }
    } catch {
      /* try next path */
    }
  }
  return undefined;
}

export class OnvifNetworkScanService {
  async scan(
    options: OnvifNetworkScanOptions,
    onProgress?: (p: OnvifNetworkScanProgress) => void
  ): Promise<OnvifNetworkScanResult> {
    const started = Date.now();
    const timeoutMs = options.timeoutMs ?? 2500;
    const concurrency = options.concurrency ?? 64;
    const discoveryPort = options.discoveryPort ?? WS_DISCOVERY_PORT;
    const includeMulticast = options.includeMulticast !== false;
    const multicastAddress = options.multicastAddress ?? WS_DISCOVERY_MULTICAST;
    const probeTypes =
      options.probeTypes ??
      ["dn:NetworkVideoTransmitter", "tds:Device"];
    const httpFallback = Boolean(options.httpFallback);
    const httpPorts = options.httpPorts ?? [80, 8080, 8000, 443];
    const hosts = expandCidrOrRange(options.network);
    const found = new Map<string, OnvifDiscoveredDevice>();
    const probeXmlVariants = [
      buildProbeXml(probeTypes),
      buildProbeXml([])
    ];

    if (includeMulticast) {
      onProgress?.({
        phase: "multicast",
        checked: 0,
        total: hosts.length,
        found: found.size
      });
      await this.multicastProbe({
        probeXmlVariants,
        multicastAddress,
        discoveryPort,
        timeoutMs: Math.max(timeoutMs, 1500),
        ...(options.signal ? { signal: options.signal } : {}),
        onMatch: (d) => mergeDevices(found, d)
      });
    }

    let checked = 0;
    await mapPool(
      hosts,
      concurrency,
      async (host) => {
        if (options.signal?.aborted) throw new Error("Scan aborted");
        await this.unicastProbe({
          host,
          discoveryPort,
          probeXmlVariants,
          timeoutMs,
          ...(options.signal ? { signal: options.signal } : {}),
          onMatch: (d) => mergeDevices(found, d)
        });
        checked += 1;
        if (checked % 8 === 0 || checked === hosts.length) {
          onProgress?.({
            phase: "unicast",
            checked,
            total: hosts.length,
            found: found.size,
            current: host
          });
        }
      },
      options.signal
    );

    if (httpFallback) {
      let httpChecked = 0;
      const totalHttp = hosts.length * httpPorts.length;
      await mapPool(
        hosts,
        Math.min(concurrency, 32),
        async (host) => {
          if (found.has(host)) {
            httpChecked += httpPorts.length;
            return;
          }
          for (const port of httpPorts) {
            if (options.signal?.aborted) throw new Error("Scan aborted");
            const hit = await httpOnvifProbe(host, port, timeoutMs);
            httpChecked += 1;
            if (hit) mergeDevices(found, hit);
            if (httpChecked % 16 === 0) {
              onProgress?.({
                phase: "http",
                checked: httpChecked,
                total: totalHttp,
                found: found.size,
                current: `${host}:${port}`
              });
            }
          }
        },
        options.signal
      );
    }

    let devices = [...found.values()].sort((a, b) =>
      a.address.localeCompare(b.address, undefined, { numeric: true })
    );

    const enrich = options.enrichDeviceInfo !== false;
    if (enrich && devices.length) {
      const enriched: OnvifDiscoveredDevice[] = new Array(devices.length);
      let enrichChecked = 0;
      await mapPool(
        devices,
        Math.min(concurrency, 16),
        async (device, index) => {
          if (options.signal?.aborted) throw new Error("Scan aborted");
          enriched[index] = await enrichDevice(device, {
            timeoutMs: Math.min(timeoutMs, 3000),
            ...(options.auth ? { auth: options.auth } : {})
          });
          enrichChecked += 1;
          onProgress?.({
            phase: "enrich",
            checked: enrichChecked,
            total: devices.length,
            found: devices.length,
            current: device.address
          });
        },
        options.signal
      );
      devices = enriched;
    }

    return {
      network: options.network,
      devices,
      scannedHosts: hosts.length,
      durationMs: Date.now() - started
    };
  }

  private async multicastProbe(opts: {
    probeXmlVariants: string[];
    multicastAddress: string;
    discoveryPort: number;
    timeoutMs: number;
    signal?: AbortSignal;
    onMatch: (d: OnvifDiscoveredDevice) => void;
  }): Promise<void> {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, () => {
        try {
          socket.setBroadcast(true);
          socket.setMulticastTTL(2);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });

    const onMessage = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      const xml = msg.toString("utf8");
      for (const d of parseProbeMatches(xml, rinfo.address, rinfo.port)) {
        opts.onMatch(d);
      }
    };
    socket.on("message", onMessage);

    try {
      for (const xml of opts.probeXmlVariants) {
        const buf = Buffer.from(xml, "utf8");
        await new Promise<void>((resolve, reject) => {
          socket.send(buf, opts.discoveryPort, opts.multicastAddress, (err) =>
            err ? reject(err) : resolve()
          );
        });
      }
      await waitMs(opts.timeoutMs, opts.signal);
    } finally {
      socket.off("message", onMessage);
      socket.close();
    }
  }

  private async unicastProbe(opts: {
    host: string;
    discoveryPort: number;
    probeXmlVariants: string[];
    timeoutMs: number;
    signal?: AbortSignal;
    onMatch: (d: OnvifDiscoveredDevice) => void;
  }): Promise<void> {
    const socket = dgram.createSocket("udp4");
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, () => resolve());
    });

    const onMessage = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      const xml = msg.toString("utf8");
      for (const d of parseProbeMatches(xml, rinfo.address || opts.host, rinfo.port)) {
        opts.onMatch(d);
      }
    };
    socket.on("message", onMessage);

    try {
      for (const xml of opts.probeXmlVariants) {
        const buf = Buffer.from(xml, "utf8");
        await new Promise<void>((resolve) => {
          socket.send(buf, opts.discoveryPort, opts.host, () => resolve());
        });
      }
      await waitMs(Math.min(opts.timeoutMs, 1200), opts.signal);
    } catch {
      /* ignore per-host failures */
    } finally {
      socket.off("message", onMessage);
      socket.close();
    }
  }
}

function waitMs(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Scan aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("Scan aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
