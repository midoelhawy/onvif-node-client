export interface CameraDeviceInformation {
    manufacturer: string;
    model: string;
    firmwareVersion: string;
    serialNumber: string;
    hardwareId: string;
}

/** ONVIF `tt:SetDateTimeType` / `DateTimeType` */
export type OnvifDateTimeType = "Manual" | "NTP";

export interface OnvifDateTimeParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

/** Parsed `tds:GetSystemDateAndTimeResponse` / `tt:SystemDateAndTime` */
export interface SystemDateAndTime {
    dateTimeType?: OnvifDateTimeType | string;
    daylightSavings?: boolean;
    /** POSIX TZ string from `tt:TimeZone/TZ` */
    timeZone?: string;
    utcDateTime?: OnvifDateTimeParts;
    localDateTime?: OnvifDateTimeParts;
    /** Convenience: UTC Date when `utcDateTime` is complete */
    utc?: Date;
    /** Convenience: local Date when `localDateTime` is complete (wall clock, no TZ offset applied) */
    local?: Date;
}

export interface SetSystemDateAndTimeOptions {
    dateTimeType: OnvifDateTimeType;
    daylightSavings: boolean;
    /** POSIX TZ, e.g. `CET-1CEST,M3.5.0,M10.5.0/3` */
    timeZone?: string;
    /** Required by most devices when `dateTimeType` is `Manual` */
    utcDateTime?: OnvifDateTimeParts | Date;
}

/**
 * Sync camera clock from the host (or an explicit `date`).
 * By default preserves camera TimeZone + DaylightSavings from GetSystemDateAndTime.
 */
export interface SyncSystemDateAndTimeOptions {
    /** Instant to push as UTC (default: `new Date()`) */
    date?: Date;
    dateTimeType?: OnvifDateTimeType;
    timeZone?: string;
    daylightSavings?: boolean;
    /** When true (default), keep TZ/DST from the camera unless overridden above */
    preserveCameraSettings?: boolean;
    /**
     * When true, set TimeZone from the host UTC offset and force DaylightSavings=false
     * (offset already includes DST). Overrides preserve for TZ/DST.
     * Style is auto-detected from the camera's current TZ when possible:
     * vendor `GMT+02:00` vs POSIX `GMT-2` / `CET-1CEST` (signs are opposite).
     */
    alignTimeZoneToHost?: boolean;
    /** Force TZ string style for `alignTimeZoneToHost` (default: auto from camera). */
    timeZoneStyle?: OnvifTimeZoneStyle;
}

/** How the device encodes fixed UTC offsets in `tt:TimeZone/TZ`. */
export type OnvifTimeZoneStyle = "posix" | "vendor";
