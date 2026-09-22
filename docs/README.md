# API exports

Public surface of `onvif-node-client`. Import from the package root:

```ts
import { … } from "onvif-node-client";
```

← [Back to main README](../README.md)

---

## High-level

- `OnvifNetworkScanService`
- `OnvifSupportService`
- `OnvifBackchannelAudioService`
- `parseOnvifScopes` / `OnvifScopeInfo`
- types: `OnvifDiscoveredDevice`, `OnvifNetworkScanOptions`, `OnvifNetworkScanResult`, `OnvifDeviceSupportReport`, `OnvifBackchannelAudioSession`, `OnvifBackchannelAudioOpenOptions`, `OnvifDeviceConnectionOptions`
- `expandCidrOrRange`

## Client & types

- `OnvifClient`
- `OnvifClientOptions`, `OnvifAuth`
- media / events / device / soap types

## RTSP / recording utils

- `prepareRtspUrl`, `rewriteRtspEndpoint`, `injectRtspCredentials`, `maskRtspCredentials`, `credentialsFromOnvifAuth`
- `openLiveOnvifBackchannelTalk`, `talkOnvifBackchannelPcmu`
- `probeRtspBackchannelDescribe`
- `resolveOggRecordingPath`, `startOggPcm16Recorder`, `formatRecordingTimestamp`
- `eventMessageToJson`
- `parseCapabilityEndpointsFromGetCapabilitiesXml`

---

## TODO (roadmap)

- [ ] **Video / media parameters** — APIs to change stream resolution, encoding, bitrate, framerate, and other ONVIF media profile settings (`SetVideoEncoderConfiguration`, profile configuration, etc.).
- [ ] **Broader ONVIF parameter control** — read/write device and imaging options beyond discovery and audio backchannel (e.g. imaging, PTZ where available, audio output level via Media).
