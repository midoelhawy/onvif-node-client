# onvif-node-client

Node.js / TypeScript library for **ONVIF** devices: **LAN network scan** (WS-Discovery), capability discovery, media profiles, events, and **audio backchannel** (PC → speaker) with optional Ogg recording.

Typed ESM package. Zero runtime dependencies (`ffmpeg` on PATH is required only for Ogg recording).

> **Compatibility note.** ONVIF is a standard, but vendors often ship **non-literal / quirky** implementations (custom RTSP paths, odd SDP, auth quirks, half-working backchannel, etc.). This library aims to **grow support for those unconventional cases over time**. It does **not** guarantee that every device or firmware will work out of the box.
>
> If something fails, please **[open an issue](https://github.com/midoelhawy/onvif-node-client/issues)** and include everything useful to reproduce and support it: **manufacturer / brand**, **model**, **firmware version**, ONVIF/profile info if known, how you connect (host, ports, HTTP vs RTSP), relevant logs/SDP/SOAP faults, and steps to reproduce.
>
> **Every contribution is welcome** — bug reports, device notes, tests, and pull requests.

If this library helps you, you can support the project:

<p>
  <a href="https://www.buymeacoffee.com/ahekal3697" target="_blank" rel="noopener noreferrer">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="41" width="174" />
  </a>
  &nbsp;
  <a href="https://paypal.me/midoelhawy" rel="nofollow noopener noreferrer">
    <img src="https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="PayPal" />
  </a>
</p>

---

## Table of contents

1. [Install](#install)
2. [Requirements](#requirements)
3. [Concepts](#concepts)
4. [Connection options](#connection-options)
5. [OnvifNetworkScanService](#onvifnetworkscanservice) — scan a LAN
6. [OnvifSupportService](#onvifsupportservice) — discovery
7. [OnvifBackchannelAudioService](#onvifbackchannelaudioservice) — talk to the speaker
8. [Audio format](#audio-format)
9. [Recording](#recording)
10. [Tunnel / NAT / port-forward](#tunnel--nat--port-forward)
11. [OnvifClient](#onvifclient) — low-level API
12. [ONVIF events](#onvif-events)
13. [Complete examples](#complete-examples)
14. [API exports](docs/README.md)
15. [Build & release](#build--release)
16. [Troubleshooting](#troubleshooting)

---



## Install

Install from a **GitHub Release** asset (built `dist/`, **no token**, no npm registry):

```bash
npm i https://github.com/midoelhawy/onvif-node-client/releases/download/v1.3.0/onvif-node-client-1.3.0.tgz
```

Or from source (CI/`prepare` builds `dist/` if missing):

```bash
npm i github:midoelhawy/onvif-node-client#v1.3.0
```

```ts
import {
  OnvifNetworkScanService,
  OnvifSupportService,
  OnvifBackchannelAudioService,
  OnvifClient
} from "onvif-node-client";
```

**ESM** module (`"type": "module"`). Node.js 18+ recommended.

---



## Requirements


| Component                                    | When needed                           |
| -------------------------------------------- | ------------------------------------- |
| Reachable ONVIF HTTP (typically port 80/443) | Always                                |
| Reachable **RTSP** (typically port **554**)  | Backchannel / talk                    |
| Device credentials                           | Almost always (`auth`)                |
| `ffmpeg` on PATH                             | Only when using `recordTo` (Ogg Opus) |


ONVIF SOAP and RTSP use different ports: an HTTP-only tunnel is **not** enough to talk to the speaker.

---



## Concepts

![Architecture: app SOAP/HTTP and RTSP backchannel to ONVIF device](docs/concepts-architecture.png)

- **Discovery** (`OnvifSupportService`): what the device exposes (services, profiles, backchannel yes/no).
- **Talk** (`OnvifBackchannelAudioService`): opens an RTSP backchannel session and sends PCM audio.
- **OnvifClient**: granular SOAP client (media, events, device IO, …) when you need fine control.

Recommended flow:

```text
discover() → if backchannel.supported → open({ support }) → pushPcm16le() → close()
```

---



## Connection options

Type: `OnvifDeviceConnectionOptions` (extends `OnvifClientOptions`).

```ts
import type { OnvifDeviceConnectionOptions } from "onvif-node-client";

const conn: OnvifDeviceConnectionOptions = {
  host: "192.168.1.50",
  port: 80,
  path: "/onvif",
  secure: false,
  auth: {
    mode: "auto",
    username: "admin",
    password: "secret"
  },
  timeoutMs: 15_000,

  // RTSP (backchannel)
  rtspHost: "192.168.1.50",
  rtspPort: 554,
  // or a full URL:
  // rtspUrl: "rtsp://192.168.1.50:554/stream?mode=real&idc=1&ids=1",
  // profileToken: "Profile0s0",

  // Tunnel: Host header expected by the device
  // httpHostHeader: "192.168.1.50",
  allowInsecureTls: true
};
```



### Main fields


| Field                   | Default           | Description                                               |
| ----------------------- | ----------------- | --------------------------------------------------------- |
| `host`                  | —                 | Host/IP as seen by Node (also `127.0.0.1` when tunneling) |
| `port`                  | 80 / 443          | ONVIF HTTP(S) port                                        |
| `path`                  | `/onvif`          | Service base path (`…/device_service`)                    |
| `secure`                | `false`           | HTTPS                                                     |
| `auth.mode`             | —                 | `none` | `auto` | `wsse` | `http-basic` | `http-digest`   |
| `auth.mode: "auto"`     | —                 | Tries multiple auth methods (recommended)                 |
| `httpHostHeader`        | —                 | Override `Host` header (tunnels / picky firmware)         |
| `allowInsecureTls`      | `false`           | Accept self-signed certificates                           |
| `timeoutMs`             | transport default | Request timeout                                           |
| `rtspUrl`               | —                 | Skip `GetStreamUri`, use this RTSP URL                    |
| `rtspHost` / `rtspPort` | —                 | Rewrite host/port from `GetStreamUri`                     |
| `profileToken`          | first stream      | Preferred Media profile                                   |


---



## OnvifNetworkScanService

Scan a LAN subnet (or IP range) for ONVIF devices using **WS-Discovery** (UDP `3702`), with optional HTTP fallback.

```ts
import { OnvifNetworkScanService } from "onvif-node-client";

const scanner = new OnvifNetworkScanService();

const result = await scanner.scan(
  {
    network: "192.168.1.0/24",   // also: "192.168.1.1-192.168.1.50" or a single IP
    timeoutMs: 2000,
    concurrency: 64,
    includeMulticast: true,     // default true — also probes 239.255.255.250:3702
    httpFallback: false,        // optional: HTTP GetSystemDateAndTime on :80/:8080/…
    enrichDeviceInfo: true,     // default true — parse scopes + optional GetDeviceInformation
    // auth: { username: "admin", password: "secret" }, // helps enrich when the device requires auth
    // signal: AbortSignal.timeout(30_000)
  },
  (p) => {
    console.log(p.phase, `${p.checked}/${p.total}`, "found=", p.found, p.current ?? "");
  }
);

for (const d of result.devices) {
  console.log(d.address, d.manufacturer, d.model, d.mac, d.xAddrs);
}
```



### How it works

1. **Multicast WS-Discovery** Probe → `239.255.255.250:3702` (devices on the same L2/L3 that route multicast).
2. **Unicast WS-Discovery** Probe to every host in the CIDR/range on UDP `3702`.
3. Optional **HTTP fallback**: TCP + SOAP `GetSystemDateAndTime` on common ports for devices that ignore discovery.
4. **Identity enrichment** (default): parse ONVIF scopes (`name`, `hardware`, `MAC`, …) and, when possible, call `GetDeviceInformation` for manufacturer / model / firmware / serial.



### `scan()` options


| Option             | Default            | Description                                                                   |
| ------------------ | ------------------ | ----------------------------------------------------------------------------- |
| `network`          | —                  | CIDR (`192.168.1.0/24`), range (`a-b`), or single IP (prefix must be `>= 16`) |
| `timeoutMs`        | `2500`             | Per-host wait / HTTP timeout budget                                           |
| `concurrency`      | `64`               | Parallel unicast probes                                                       |
| `discoveryPort`    | `3702`             | WS-Discovery UDP port                                                         |
| `includeMulticast` | `true`             | Send multicast Probe first                                                    |
| `multicastAddress` | `239.255.255.250`  | Multicast group                                                               |
| `probeTypes`       | NVT + Device       | WS-Discovery `Types` filter                                                   |
| `httpFallback`     | `false`            | Also probe HTTP ONVIF endpoints                                               |
| `httpPorts`        | `80,8080,8000,443` | Ports for HTTP fallback                                                       |
| `enrichDeviceInfo` | `true`             | Parse scopes + `GetDeviceInformation` when possible                           |
| `auth`             | —                  | Optional credentials for enrich (`username` / `password`)                     |
| `signal`           | —                  | Abort mid-scan                                                                |




### Result

```ts
{
  network: string;
  scannedHosts: number;
  durationMs: number;
  devices: Array<{
    address: string;
    port: number;
    xAddrs: string[];   // e.g. http://192.168.1.50/onvif/device_service
    types: string[];
    scopes: string[];
    manufacturer?: string;
    model?: string;
    name?: string;
    hardware?: string;
    mac?: string;
    location?: string;
    profiles?: string[];
    firmwareVersion?: string;
    serialNumber?: string;
    hardwareId?: string;
    metadataVersion?: string;
  }>;
}
```

After a scan, feed a found XAddr host into `OnvifSupportService` / talk:

```ts
const hit = result.devices[0];
if (hit) {
  const host = hit.address;
  const report = await new OnvifSupportService({
    host,
    port: 80,
    auth: { mode: "auto", username: "admin", password: "secret" },
    rtspHost: host,
    rtspPort: 554
  }).discover();
}
```

---



## OnvifSupportService

Discovers identity, services, media profiles, Device IO audio outputs, and **RTSP backchannel support**.

```ts
import { OnvifSupportService } from "onvif-node-client";

const support = new OnvifSupportService(conn);
const report = await support.discover();

if (!report.reachable) {
  console.error(report.error, report.hints);
  process.exit(1);
}

console.log(report.device);
// { manufacturer, model, firmwareVersion, serialNumber, hardwareId }

console.log(report.backchannel.supported); // true/false
console.log(report.backchannel.g711);       // "PCMU" | "PCMA" | undefined
console.log(report.profiles);
console.log(report.streams);
console.log(report.audioOutputs);
console.log(report.hints);
```



### `OnvifDeviceSupportReport`


| Field                   | Type           | Meaning                              |
| ----------------------- | -------------- | ------------------------------------ |
| `reachable`             | `boolean`      | `init()` / GetCapabilities succeeded |
| `error`                 | `string?`      | Error when unreachable               |
| `device`                | device info    | From `GetDeviceInformation`          |
| `resolvedServices`      | XAddr map      | Device / Media / Events / Analytics  |
| `capabilityEndpoints`   | list           | All XAddrs from GetCapabilities      |
| `serviceDirectory`      | list?          | From `GetServices` (if supported)    |
| `profiles`              | Media profiles | Video/audio encoder when present     |
| `streams`               | `GetStreamUri` | RTSP URIs (credentials masked)       |
| `audioOutputs`          | token[]        | Device IO `GetAudioOutputs`          |
| `backchannel.supported` | `boolean`      | SDP has `m=audio` + `a=sendonly`     |
| `backchannel.rtspUrl`   | `string?`      | Prepared RTSP URL (for talk reuse)   |
| `backchannel.g711`      | `PCMU`/`PCMA`? | Codec from SDP                       |
| `backchannel.notes`     | `string[]`     | Probe details                        |
| `hints`                 | `string[]`     | Operational hints                    |
| `probedAt`              | ISO string     | Timestamp                            |


The report is **reusable**: pass it to `OnvifBackchannelAudioService.open({ support })` without probing again.

---



## OnvifBackchannelAudioService

Opens an ONVIF RTSP backchannel session (TCP interleaved), accepts PCM, and sends it to the speaker.

```ts
import { OnvifBackchannelAudioService } from "onvif-node-client";

const audio = new OnvifBackchannelAudioService(conn);

const session = await audio.open({
  support: report,          // optional: reuse discover()
  verifySupport: false,     // default: true if `support` is missing
  recordTo: "/tmp/talks",   // dir → timestamp.ogg  or a full .ogg path
  skipRecvOnlySetup: true,  // default true (sendonly track only)
  connectTimeoutMs: 15_000
});

console.log(session.g711, session.sampleRate, session.recordingPath);

// Mono PCM signed 16-bit LE @ 8 kHz
session.pushPcm16le(pcmChunk);

const { recordingPath } = await session.close();
```



### `open()` options


| Option              | Default           | Description                          |
| ------------------- | ----------------- | ------------------------------------ |
| `support`           | —                 | Report from `discover()`             |
| `verifySupport`     | `!support`        | If true, runs discover again         |
| `recordTo`          | —                 | `.ogg` file path or directory        |
| `skipRecvOnlySetup` | `true`            | Skip SETUP for recv-only video/audio |
| `connectTimeoutMs`  | `timeoutMs` / 15s | RTSP TCP connect timeout             |




### Session


| Member             | Description                          |
| ------------------ | ------------------------------------ |
| `g711`             | `PCMU` or `PCMA` negotiated from SDP |
| `sampleRate`       | Always `8000`                        |
| `payloadType`      | RTP payload type                     |
| `rtspUrl`          | URL in use (password masked)         |
| `recordingPath`    | Ogg path when `recordTo` is set      |
| `support`          | Report used for this session         |
| `pushPcm16le(buf)` | Send (and record) PCM                |
| `close()`          | TEARDOWN + flush recording           |


If the device has no backchannel, `open()` throws:

```text
ONVIF audio backchannel not supported: …
```

---



## Audio format

The library expects:

```text
PCM signed 16-bit little-endian
mono
8000 Hz
```

The RTP codec toward the device (μ-law / A-law) is chosen automatically from SDP (`PCMU` / `PCMA`).

### Generate test PCM with ffmpeg

```bash
ffmpeg -f lavfi -i "sine=frequency=880:sample_rate=8000" -t 3 \
  -ac 1 -ar 8000 -f s16le pipe:1
```



### From WebM/Opus (browser MediaRecorder)

In your app (same pattern as the local `web-talk` sample):

```text
WebM chunks → ffmpeg → s16le 8 kHz → session.pushPcm16le()
```

```bash
ffmpeg -f webm -i pipe:0 -ac 1 -ar 8000 -f s16le pipe:1
```

---



## Recording

Requires **ffmpeg** with the `libopus` encoder.

```ts
// Exact file
await audio.open({ recordTo: "/tmp/call-2026.ogg" });

// Directory → /tmp/talks/YYYY-MM-DD_HH-mm-ss.ogg
await audio.open({ recordTo: "/tmp/talks" });
```

The recording is the **same PCM** sent to the speaker (before G.711 RTP encoding).

Exported helpers:

```ts
import {
  resolveOggRecordingPath,
  startOggPcm16Recorder,
  formatRecordingTimestamp
} from "onvif-node-client";
```

---



## Tunnel / NAT / port-forward

Typical setup: ONVIF HTTP on `127.0.0.1:2020` → device `192.168.1.50:80`, RTSP on `127.0.0.1:554` → device `:554`.

```ts
const conn = {
  host: "127.0.0.1",
  port: 2020,
  auth: { mode: "auto" as const, username: "admin", password: "secret" },
  // many firmwares want Host = real LAN IP
  httpHostHeader: "192.168.1.50",
  rtspHost: "127.0.0.1",
  rtspPort: 554
};
```

`GetStreamUri` often returns `rtsp://192.168.1.50:554/...`. With `rtspHost` / `rtspPort` the library rewrites host/port for the tunnel.

Helpers:

```ts
import { prepareRtspUrl, maskRtspCredentials } from "onvif-node-client";

const url = prepareRtspUrl(rawFromDevice, conn);
console.log(maskRtspCredentials(url));
```

---



## OnvifClient

Low-level SOAP client (lazy `init()`).

```ts
import { OnvifClient } from "onvif-node-client";

const client = new OnvifClient(conn);
await client.init();

const info = await client.getDeviceInformation();
const profiles = await client.getProfilesDetailed();
const streams = await client.getStreams();
const caps = await client.getAdvertisedCapabilityEndpoints();
const services = await client.getServiceDirectory();
const outputs = await client.getAudioOutputSummaries();

const bc = await client.probeRtspAudioBackchannel({
  // rtspUrl: "...",
  // profileToken: "Profile0s0",
  timeoutMs: 10_000
});
console.log(bc?.sdpSuggestsAudioBackchannel, bc?.sdpPreview);
```



### Main methods


| Method                                    | Description                         |
| ----------------------------------------- | ----------------------------------- |
| `init()`                                  | Resolve XAddrs from GetCapabilities |
| `getDeviceInformation()`                  | Device identity                     |
| `getProfiles()` / `getProfilesDetailed()` | Media profiles                      |
| `getStreams()`                            | All `GetStreamUri` results          |
| `getAdvertisedCapabilityEndpoints()`      | XAddr table                         |
| `getServiceDirectory()`                   | GetServices                         |
| `getAudioOutputSummaries()`               | Device IO audio outputs             |
| `probeRtspAudioBackchannel()`             | DESCRIBE-only backchannel probe     |
| `createPullPointSubscription()`           | Events PullPoint                    |
| `pullMessages()`                          | Pull events                         |
| `listenToEvents()`                        | Async iterator for events           |
| `normalizeServiceUrl()`                   | Rewrite XAddr to local host/port    |
| `getResolvedServices()`                   | Resolved service map                |


---



## ONVIF events

```ts
import { OnvifClient, eventMessageToJson } from "onvif-node-client";

const client = new OnvifClient(conn);
const controller = new AbortController();

setTimeout(() => controller.abort(), 30_000);

for await (const msg of client.listenToEvents({
  signal: controller.signal,
  pullTimeout: "PT5S",
  messageLimit: 10
})) {
  console.log(eventMessageToJson(msg));
}
```

Or manual PullPoint:

```ts
const sub = await client.createPullPointSubscription({
  initialTerminationTime: "PT60S"
});
if (!sub) throw new Error("Events not available");

const pulled = await client.pullMessages(sub.referenceAddress, {
  timeout: "PT5S",
  messageLimit: 10
});
```

---



## Complete examples



### 0. Scan a network, then discover each device

```ts
import {
  OnvifNetworkScanService,
  OnvifSupportService
} from "onvif-node-client";

const { devices } = await new OnvifNetworkScanService().scan({
  network: "192.168.1.0/24",
  httpFallback: true
});

for (const d of devices) {
  const report = await new OnvifSupportService({
    host: d.address,
    auth: { mode: "auto", username: "admin", password: "secret" },
    rtspPort: 554
  }).discover();
  console.log(d.address, report.device?.model, report.backchannel.supported);
}
```



### 1. Discovery only

```ts
import { OnvifSupportService } from "onvif-node-client";

const report = await new OnvifSupportService({
  host: "192.168.1.50",
  port: 80,
  auth: { mode: "auto", username: "admin", password: "secret" },
  rtspPort: 554
}).discover();

console.log(JSON.stringify({
  device: report.device,
  backchannel: report.backchannel.supported,
  g711: report.backchannel.g711,
  profiles: report.profiles.map((p) => ({
    token: p.token,
    name: p.name,
    video: p.video,
    audio: p.audio
  }))
}, null, 2));
```



### 2. Discover + talk + record

```ts
import { spawn } from "node:child_process";
import {
  OnvifSupportService,
  OnvifBackchannelAudioService
} from "onvif-node-client";

const conn = {
  host: "192.168.1.50",
  port: 80,
  auth: { mode: "auto" as const, username: "admin", password: "secret" },
  rtspPort: 554
};

const report = await new OnvifSupportService(conn).discover();
if (!report.backchannel.supported) {
  throw new Error(report.backchannel.notes.join("; "));
}

const session = await new OnvifBackchannelAudioService(conn).open({
  support: report,
  recordTo: "/tmp/suka"
});

const ff = spawn(
  "ffmpeg",
  [
    "-nostdin", "-loglevel", "error", "-re",
    "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=8000",
    "-t", "3", "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);

await new Promise<void>((resolve, reject) => {
  ff.stdout!.on("data", (c: Buffer) => session.pushPcm16le(c));
  ff.on("error", reject);
  ff.on("exit", (code) => (code ? reject(new Error(`ffmpeg ${code}`)) : resolve()));
});

const { recordingPath } = await session.close();
console.log("saved", recordingPath);
```



### 3. Talk without an explicit discover

`open()` verifies support itself when `support` is omitted:

```ts
const session = await new OnvifBackchannelAudioService(conn).open({
  recordTo: "/tmp/out.ogg"
});
session.pushPcm16le(chunk);
await session.close();
```



### 4. WebM pipeline (browser-like app)

```ts
import { spawn } from "node:child_process";
import { OnvifBackchannelAudioService } from "onvif-node-client";

const session = await new OnvifBackchannelAudioService(conn).open({
  recordTo: "/tmp/suka"
});

const ff = spawn(
  "ffmpeg",
  [
    "-nostdin", "-loglevel", "error",
    "-fflags", "+genpts+discardcorrupt",
    "-f", "webm", "-i", "pipe:0",
    "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1"
  ],
  { stdio: ["pipe", "pipe", "pipe"] }
);

ff.stdout!.on("data", (pcm: Buffer) => session.pushPcm16le(pcm));

// From your app: each MediaRecorder chunk
function onWebmChunk(chunk: Buffer) {
  ff.stdin!.write(chunk);
}

async function stop() {
  ff.stdin!.end();
  await new Promise((r) => ff.on("exit", r));
  await session.close();
}
```



### 5. Low-level live session

When you already have an RTSP URL:

```ts
import { openLiveOnvifBackchannelTalk } from "onvif-node-client";

const live = await openLiveOnvifBackchannelTalk({
  rtspContentUrl: "rtsp://admin:secret@127.0.0.1:554/stream?mode=real&idc=1&ids=1",
  skipRecvOnlySetup: true
});

live.pushPcm16le(pcm);
await live.close();
```



### 6. One-shot backchannel probe

```ts
import { probeRtspBackchannelDescribe } from "onvif-node-client";

const r = await probeRtspBackchannelDescribe(
  "rtsp://admin:secret@192.168.1.50:554/stream?mode=real&idc=1&ids=1",
  { timeoutMs: 8000 }
);
console.log(r.sdpSuggestsAudioBackchannel, r.rtspStatusLine, r.notes);
```



### 7. Built-in tone / numbers helper

```ts
import { talkOnvifBackchannelPcmu } from "onvif-node-client";

const r = await talkOnvifBackchannelPcmu({
  rtspContentUrl: "rtsp://admin:secret@127.0.0.1:554/stream?mode=real&idc=1&ids=1",
  audio: "numbers", // "tone" | "tick" | "numbers" | "mic"
  seconds: 10,
  skipRecvOnlySetup: true,
  onNumber: (n) => console.log("digit", n)
});
console.log(r.ok, r.message);
```

---



## API exports

Full list of public exports: **[docs/README.md](docs/README.md)**.

---



## Build & release

> Registry publish (npmjs / GitHub Packages) is **disabled**. On tag `v*`, GitHub Actions builds the package, runs `npm pack`, and creates a **GitHub Release** with the `.tgz` asset. **`dist/` is not committed.**

```bash
# working tree clean, on main
npm run release:patch    # bump → tag vX.Y.Z → push (CI publishes the Release)
```

Then install from the release asset:

```bash
npm i https://github.com/midoelhawy/onvif-node-client/releases/download/v1.3.0/onvif-node-client-1.3.0.tgz
```

Local build:

```bash
npm ci
npm run build
```

---



## Troubleshooting


| Symptom                                              | Check                                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Scan finds nothing                                   | Multicast filtered by Wi‑Fi AP? Try `httpFallback: true`. Ensure UDP 3702 is allowed. Run from the same LAN/VLAN. |
| Scan too slow                                        | Lower `timeoutMs`, raise `concurrency`, use a tighter CIDR (`/28` instead of `/24`)                               |
| `reachable: false`                                   | host/port, credentials, HTTP vs HTTPS, `httpHostHeader` when tunneling                                            |
| `backchannel.supported: false` + `ECONNREFUSED :554` | Forward RTSP; set `rtspHost` / `rtspPort`                                                                         |
| SETUP `400 Bad Request`                              | Some firmware (e.g. Qualvision) needs `…?query/audioback` URLs — handled by this library                          |
| No sound                                             | SDP codec (PCMA vs PCMU) is automatic; confirm PCM is 8 kHz mono and device volume                                |
| Recording fails                                      | Is `ffmpeg` installed? Is `libopus` available?                                                                    |
| Empty events                                         | Not all speakers expose Events; NVT cameras often do                                                              |




### Qualvision / similar firmware notes

Some NVTs require a non-standard control URL:

```text
rtsp://host/stream?mode=real&idc=1&ids=1/audioback
```

(the library performs this join). Vendor web UIs sometimes also document:

```text
rtsp://IP:554/mode=real&idc=1&ids=1
```

Both can work as presentation URLs when the device accepts them on DESCRIBE.

---



## License

[GPL-3.0](./LICENSE) (GNU General Public License v3.0)

If this library helps you, you can support the project:

<p>
  <a href="https://www.buymeacoffee.com/ahekal3697" target="_blank" rel="noopener noreferrer">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="41" width="174" />
  </a>
  &nbsp;
  <a href="https://paypal.me/midoelhawy" rel="nofollow noopener noreferrer">
    <img src="https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white" alt="PayPal" />
  </a>
</p>
