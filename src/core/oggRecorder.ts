import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
export type OggRecorder = {
    filePath: string;
    write(chunk: Buffer): void;
    close(): Promise<string>;
};
function pad2(n: number): string {
    return String(n).padStart(2, "0");
}
export function formatRecordingTimestamp(d = new Date()): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`;
}
export function resolveOggRecordingPath(recordTo: string, startedAt = new Date()): string {
    const trimmed = recordTo.trim();
    if (/\.ogg$/i.test(trimmed)) {
        const dir = path.dirname(trimmed);
        fs.mkdirSync(dir, { recursive: true });
        return trimmed;
    }
    fs.mkdirSync(trimmed, { recursive: true });
    let filePath = path.join(trimmed, `${formatRecordingTimestamp(startedAt)}.ogg`);
    if (fs.existsSync(filePath)) {
        filePath = path.join(trimmed, `${formatRecordingTimestamp(startedAt)}_${startedAt.getMilliseconds()}.ogg`);
    }
    return filePath;
}
export function startOggPcm16Recorder(filePath: string): OggRecorder {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const ff = spawn("ffmpeg", [
        "-nostdin",
        "-loglevel",
        "error",
        "-f",
        "s16le",
        "-ar",
        "8000",
        "-ac",
        "1",
        "-i",
        "pipe:0",
        "-c:a",
        "libopus",
        "-b:a",
        "24k",
        "-application",
        "voip",
        "-y",
        filePath
    ], { stdio: ["pipe", "ignore", "pipe"] });
    const stderrChunks: Buffer[] = [];
    ff.stderr?.on("data", (c) => stderrChunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    let closed = false;
    return {
        filePath,
        write(chunk: Buffer): void {
            if (closed || !ff.stdin || ff.stdin.destroyed)
                return;
            try {
                ff.stdin.write(chunk);
            }
            catch {
            }
        },
        async close(): Promise<string> {
            if (closed)
                return filePath;
            closed = true;
            await new Promise<void>((resolve) => {
                const done = (): void => resolve();
                ff.once("exit", done);
                ff.once("error", done);
                try {
                    ff.stdin?.end();
                }
                catch {
                    ff.kill("SIGTERM");
                }
                setTimeout(() => {
                    if (!ff.killed)
                        ff.kill("SIGKILL");
                    resolve();
                }, 5000);
            });
            const err = Buffer.concat(stderrChunks).toString("utf8").trim();
            if (err) {
                console.warn("[onvif-node-client] ffmpeg recorder:", err.slice(0, 300));
            }
            return filePath;
        }
    };
}
