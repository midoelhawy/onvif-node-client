export type OnvifScopeInfo = {
  manufacturer?: string;
  model?: string;
  name?: string;
  hardware?: string;
  mac?: string;
  location?: string;
  profiles: string[];
  types: string[];
};

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function normalizeOnvifScopes(scopes: string[]): string[] {
  const out: string[] = [];
  for (const raw of scopes) {
    const decoded = decodeXmlEntities(raw);
    for (const part of decoded.split(/[\s\r\n]+/)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function scopePath(scope: string): { key: string; value: string } | undefined {
  const m = /onvif:\/\/www\.onvif\.org\/([^/]+)\/(.+)$/i.exec(scope.trim());
  if (!m) return undefined;
  let value = m[2] ?? "";
  try {
    value = decodeURIComponent(value);
  } catch {
    /* keep raw */
  }
  return { key: (m[1] ?? "").toLowerCase(), value };
}

function splitManufacturerModel(name: string): { manufacturer?: string; model?: string } {
  const cleaned = name.trim().replace(/\+/g, " ");
  if (!cleaned) return {};
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { model: parts[0]! };
  return { manufacturer: parts[0]!, model: parts.slice(1).join(" ") };
}

export function looksLikeMac(value: string): boolean {
  return /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(value.trim());
}

export function parseOnvifScopes(scopes: string[]): OnvifScopeInfo {
  const profiles: string[] = [];
  const types: string[] = [];
  let name: string | undefined;
  let hardware: string | undefined;
  let mac: string | undefined;
  let location: string | undefined;
  let manufacturer: string | undefined;
  let model: string | undefined;

  for (const scope of normalizeOnvifScopes(scopes)) {
    const parsed = scopePath(scope);
    if (!parsed) continue;
    const { key, value } = parsed;
    if (key === "name") name = value;
    else if (key === "hardware") hardware = value;
    else if (key === "mac") mac = value.toLowerCase();
    else if (key === "location") location = value;
    else if (key === "profile") profiles.push(value);
    else if (key === "type") types.push(value);
    else if (key === "manufacturer" || key === "brand") manufacturer = value;
    else if (key === "model") model = value;
  }

  if (name) {
    const split = splitManufacturerModel(name);
    if (!manufacturer && split.manufacturer) manufacturer = split.manufacturer;
    if (!model && split.model) model = split.model;
  }

  if (name && hardware && !/\s/.test(name) && !manufacturer && (!model || model === name)) {
    manufacturer = name;
    model = hardware;
  } else if (!model && hardware) {
    model = hardware;
  }

  if (!mac && hardware && looksLikeMac(hardware)) mac = hardware.toLowerCase();

  return {
    ...(manufacturer ? { manufacturer } : {}),
    ...(model ? { model } : {}),
    ...(name ? { name } : {}),
    ...(hardware ? { hardware } : {}),
    ...(mac ? { mac } : {}),
    ...(location ? { location } : {}),
    profiles,
    types
  };
}
