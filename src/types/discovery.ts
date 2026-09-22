export type OnvifDiscoveredDevice = {
  address: string;
  port: number;
  xAddrs: string[];
  types: string[];
  scopes: string[];
  manufacturer?: string;
  model?: string;
  name?: string;
  hardware?: string;
  mac?: string;
  location?: string;
  profiles?: string[];
  scopeTypes?: string[];
  metadataVersion?: string;
  firmwareVersion?: string;
  serialNumber?: string;
  hardwareId?: string;
  rawXml?: string;
};

export type OnvifNetworkScanOptions = {
  network: string;
  timeoutMs?: number;
  concurrency?: number;
  discoveryPort?: number;
  probeTypes?: string[];
  includeMulticast?: boolean;
  multicastAddress?: string;
  httpFallback?: boolean;
  httpPorts?: number[];
  enrichDeviceInfo?: boolean;
  auth?: {
    username: string;
    password: string;
  };
  signal?: AbortSignal;
};

export type OnvifNetworkScanProgress = {
  phase: "multicast" | "unicast" | "http" | "enrich";
  checked: number;
  total: number;
  found: number;
  current?: string;
};

export type OnvifNetworkScanResult = {
  network: string;
  devices: OnvifDiscoveredDevice[];
  scannedHosts: number;
  durationMs: number;
};
