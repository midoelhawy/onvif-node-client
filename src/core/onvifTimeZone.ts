import type { OnvifDateTimeParts, OnvifTimeZoneStyle } from "../types/device.js";

/** Host UTC offset as ONVIF TZ. POSIX signs are inverted vs wall-clock (UTC+2 → `GMT-2`). */
export function formatHostGmtOffsetTimeZone(date = new Date(), style: OnvifTimeZoneStyle = "posix"): string {
    const utcPlusMinutes = -date.getTimezoneOffset();
    const abs = Math.abs(utcPlusMinutes);
    const hh = String(Math.floor(abs / 60)).padStart(2, "0");
    const mm = String(abs % 60).padStart(2, "0");
    if (style === "vendor") {
        const sign = utcPlusMinutes >= 0 ? "+" : "-";
        return `GMT${sign}${hh}:${mm}`;
    }
    const sign = utcPlusMinutes >= 0 ? "-" : "+";
    return mm === "00" ? `GMT${sign}${Number(hh)}` : `GMT${sign}${hh}:${mm}`;
}

/** Guess TZ encoding from a device's current `tt:TZ` value. */
export function detectTimeZoneStyle(tz?: string): OnvifTimeZoneStyle {
    if (!tz)
        return "posix";
    const t = tz.trim();
    if (/^(GMT|UTC)[+-]\d{1,2}:\d{2}$/i.test(t))
        return "vendor";
    return "posix";
}

export interface TimeZoneApplyAttempt {
    timeZone: string;
    daylightSavings: boolean;
    label: string;
}

/**
 * Build TZ/DST attempts so OSD local time matches the host.
 * Prefers enabling DST on the camera's native `CET-1CEST`-style zone when that fits.
 */
export function buildTimeZoneAlignAttempts(
    host: Date,
    currentTz: string | undefined,
    style?: OnvifTimeZoneStyle
): TimeZoneApplyAttempt[] {
    const hostUtcPlus = -host.getTimezoneOffset();
    const out: TimeZoneApplyAttempt[] = [];

    const native = nativeDstAttempt(currentTz, hostUtcPlus);
    if (native)
        out.push(native);

    const primary = style ?? detectTimeZoneStyle(currentTz);
    const secondary: OnvifTimeZoneStyle = primary === "posix" ? "vendor" : "posix";
    out.push({
        timeZone: formatHostGmtOffsetTimeZone(host, primary),
        daylightSavings: false,
        label: `fixed-${primary}`
    });
    out.push({
        timeZone: formatHostGmtOffsetTimeZone(host, secondary),
        daylightSavings: false,
        label: `fixed-${secondary}`
    });

    return dedupeAttempts(out);
}

/** Parse POSIX-like `CET-1CEST` / `GMT-2` / `FNT2` into UTC+ minutes for the standard side. */
export function parsePosixStdUtcPlusMinutes(tz: string): {
    utcPlusMinutes: number;
    dstName?: string;
} | undefined {
    const base = tz.trim().split(",")[0];
    if (!base)
        return undefined;
    if (/^(GMT|UTC)[+-]\d{1,2}:\d{2}$/i.test(base))
        return undefined;
    const m = base.match(/^([A-Za-z]+)([+-]?\d+)(?::(\d{2}))?([A-Za-z]+)?$/);
    if (!m)
        return undefined;
    const hourToken = m[2] ?? "0";
    const hoursAbs = Math.abs(Number.parseInt(hourToken, 10));
    if (!Number.isFinite(hoursAbs))
        return undefined;
    const mins = m[3] ? Number.parseInt(m[3], 10) : 0;
    if (!Number.isFinite(mins))
        return undefined;
    const posixMinutes = (hourToken.startsWith("-") ? -1 : 1) * (hoursAbs * 60 + mins);
    const utcPlusMinutes = -posixMinutes;
    const dstName = m[4];
    return dstName ? { utcPlusMinutes, dstName } : { utcPlusMinutes };
}

export function toLocalDateTimeParts(date: Date): OnvifDateTimeParts {
    return {
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds()
    };
}

/** Compare two wall-clock stamps (local or UTC parts) in milliseconds. */
export function wallClockSkewMs(a: OnvifDateTimeParts, b: OnvifDateTimeParts): number {
    const am = Date.UTC(a.year, a.month - 1, a.day, a.hour, a.minute, a.second);
    const bm = Date.UTC(b.year, b.month - 1, b.day, b.hour, b.minute, b.second);
    return am - bm;
}

function nativeDstAttempt(currentTz: string | undefined, hostUtcPlus: number): TimeZoneApplyAttempt | undefined {
    if (!currentTz)
        return undefined;
    const parsed = parsePosixStdUtcPlusMinutes(currentTz);
    if (!parsed?.dstName)
        return undefined;
    const std = parsed.utcPlusMinutes;
    const dst = std + 60;
    if (Math.abs(hostUtcPlus - dst) <= 15) {
        return { timeZone: currentTz.split(",")[0]!, daylightSavings: true, label: "native-dst-on" };
    }
    if (Math.abs(hostUtcPlus - std) <= 15) {
        return { timeZone: currentTz.split(",")[0]!, daylightSavings: false, label: "native-dst-off" };
    }
    return undefined;
}

function dedupeAttempts(attempts: TimeZoneApplyAttempt[]): TimeZoneApplyAttempt[] {
    const seen = new Set<string>();
    const out: TimeZoneApplyAttempt[] = [];
    for (const a of attempts) {
        const key = `${a.timeZone}|${a.daylightSavings ? 1 : 0}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        out.push(a);
    }
    return out;
}
