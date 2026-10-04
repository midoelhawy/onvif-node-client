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
 * By default aligns TimeZone to the host so the OSD local hour matches.
 */
export interface SyncSystemDateAndTimeOptions {
    /** Instant to push as UTC (default: `new Date()`) */
    date?: Date;
    dateTimeType?: OnvifDateTimeType;
    timeZone?: string;
    daylightSavings?: boolean;
    /**
     * When true (and `alignTimeZoneToHost` is false), keep TZ/DST from the camera.
     * Ignored while aligning (the default).
     */
    preserveCameraSettings?: boolean;
    /**
     * When true (default), align TZ/DST so OSD local time matches the host.
     * Tries native DST (`CET-1CEST` + DaylightSavings), then POSIX/vendor fixed offsets.
     * Set false to only push UTC and keep the camera TZ.
     */
    alignTimeZoneToHost?: boolean;
    /** Force TZ string style for fixed-offset attempts (default: auto from camera). */
    timeZoneStyle?: OnvifTimeZoneStyle;
    /** Max |UTC skew| accepted as OK (default 5000 ms). */
    maxUtcSkewMs?: number;
    /** Max |local/OSD skew| accepted as OK when LocalDateTime is present (default 90000 ms). */
    maxLocalSkewMs?: number;
}

/** How the device encodes fixed UTC offsets in `tt:TimeZone/TZ`. */
export type OnvifTimeZoneStyle = "posix" | "vendor";

export interface SyncSystemDateAndTimeAttempt {
    label: string;
    timeZone?: string;
    daylightSavings: boolean;
    utcSkewMs?: number;
    localSkewMs?: number;
}

/** Result of `syncSystemDateAndTime` — clock fields plus verification against the host. */
export interface SyncSystemDateAndTimeResult extends SystemDateAndTime {
    sync: {
        /** False when UTC (and local, if reported) still diverge from the host after attempts. */
        ok: boolean;
        hostUtc: string;
        utcSkewMs?: number;
        localSkewMs?: number;
        attempts: SyncSystemDateAndTimeAttempt[];
    };
}
