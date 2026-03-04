import { spawn, ChildProcess, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const DEFAULTS = {
    outputPath: "./videos",
    timeLimitSeconds: 180,
    quality: "low" as RecordingQuality,
    pollIntervalMs: 200,
    fileReadyTimeoutMs: 15_000,
    stableCheckMs: 3_000,
} as const;

const QUALITY_BITRATE: Record<RecordingQuality, number> = {
    low: 2,
    medium: 4,
    high: 8,
};

export type RecordingQuality = "low" | "medium" | "high";

export interface RecordingOptions {
    quality?: RecordingQuality;
    outputPath?: string;
    filename?: string;
    timeLimitSeconds?: number;
}

/**
 * Plug in your own logger if you don't want console output.
 * Every method is optional — missing ones are silently skipped.
 */
export interface Logger {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
}

// These are the only states the recorder can be in.
type RecorderState =
    | { status: "idle" }
    | {
    status: "recording";
    process: ChildProcess;
    localPath: string;
    devicePath: string;
};

// Errors
export class RecordingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RecordingError";
    }
}

export class AdbError extends Error {
    constructor(message: string, public readonly stderr: string) {
        super(message);
        this.name = "AdbError";
    }
}

/**
 * Thin wrapper around the `adb` binary.
 *
 * Extracted so (a) the recorder doesn't have raw spawn calls everywhere,
 * and (b) you could swap in a mock for tests.
 */
class AdbClient {
    constructor(private serial: string | null) {}

    /** Run a synchronous adb command. Throws AdbError on non-zero exit. */
    exec(args: string[]): string {
        const serialArgs = this.serial ? ["-s", this.serial] : [];
        const result = spawnSync("adb", [...serialArgs, ...args], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });

        if (result.status !== 0) {
            throw new AdbError(`adb ${args[0]} failed`, result.stderr);
        }

        return result.stdout;
    }

    /** Spawn a long-running adb command (like screenrecord). */
    spawn(args: string[]): ChildProcess {
        const serialArgs = this.serial ? ["-s", this.serial] : [];
        return spawn("adb", [...serialArgs, ...args], { stdio: "inherit" });
    }

    /** Get file size on device. Returns -1 if the file doesn't exist yet. */
    getDeviceFileSize(devicePath: string): number {
        // We don't use exec() here because a missing file isn't an "error" —
        // the stat command is designed to return -1 via the `|| echo -1` fallback.
        const serialArgs = this.serial ? ["-s", this.serial] : [];
        const result = spawnSync(
            "adb",
            [...serialArgs, "shell", `stat -c %s ${devicePath} 2>/dev/null || echo -1`],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        );
        return parseInt(result.stdout.trim(), 10) ?? -1;
    }
}

// Helpers
function generateFilename(): string {
    return (
        "recording_" +
        new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .replace("T", "_")
            .slice(0, 19) +
        ".mp4"
    );
}

/**
 * Resolves when the child process exits.
 * We need this because screenrecord only finishes writing
 * the mp4 container AFTER the adb process fully exits.
 */
function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        if (proc.exitCode !== null) return resolve();

        const timer = setTimeout(
            () => reject(new RecordingError("Process exit timed out")),
            timeoutMs
        );

        proc.once("close", () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

/**
 * Polls device file size until two consecutive reads return the same value.
 * Only meaningful AFTER the adb process exits — before that, the file
 * can appear "stable" at a tiny size while screenrecord is still buffering.
 */
async function waitForFileStable(
    adb: AdbClient,
    devicePath: string,
    timeoutMs: number
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;

    while (Date.now() < deadline) {
        const size = adb.getDeviceFileSize(devicePath);
        if (size > 0 && size === lastSize) return true;
        lastSize = size;
        await new Promise((r) => setTimeout(r, DEFAULTS.pollIntervalMs));
    }

    return false;
}

// ─── Main Class ──────────────────────────────

export class ScreenRecorder {
    private state: RecorderState = { status: "idle" };
    private adb: AdbClient;
    private log: Required<Logger>;

    constructor(deviceSerial?: string, logger?: Logger) {
        this.adb = new AdbClient(deviceSerial ?? null);

        // Build a "safe" logger: if the caller didn't provide a method, use a no-op.
        // This avoids `if (this.log.info)` checks everywhere.
        const noop = () => {};
        this.log = {
            info: logger?.info ?? console.log,
            warn: logger?.warn ?? console.warn,
            error: logger?.error ?? console.error,
        };
    }

    get isRecording(): boolean {
        return this.state.status === "recording";
    }

    get currentFilePath(): string | null {
        return this.state.status === "recording" ? this.state.localPath : null;
    }

    /**
     * Kick off a screen recording on the connected device.
     * Throws if already recording — call stopRecording() first.
     */
    startRecording(options: RecordingOptions = {}): void {
        if (this.state.status === "recording") {
            throw new RecordingError("Already recording. Call stopRecording() first.");
        }

        const quality = options.quality ?? DEFAULTS.quality;
        const outputPath = options.outputPath ?? DEFAULTS.outputPath;
        const filename = options.filename ?? generateFilename();
        const timeLimit = options.timeLimitSeconds ?? DEFAULTS.timeLimitSeconds;
        const bitrate = QUALITY_BITRATE[quality];

        fs.mkdirSync(outputPath, { recursive: true });

        const localPath = path.join(outputPath, filename);
        const devicePath = `/sdcard/scrcap_${path.basename(filename)}`;

        this.log.info(`[ScreenRecorder] Starting (${quality} / ${bitrate} Mbps)`);

        const proc = this.adb.spawn([
            "shell",
            "screenrecord",
            "--bit-rate", `${bitrate * 1_000_000}`,
            "--time-limit", `${timeLimit}`,
            devicePath,
        ]);

        proc.on("error", (err) => {
            this.log.error(`[ScreenRecorder] Process error: ${err.message}`);
            this.state = { status: "idle" };
        });

        // Transition to "recording" — all the data we need for stopRecording
        // is captured right here in the state object.
        this.state = { status: "recording", process: proc, localPath, devicePath };
    }

    /**
     * Stop recording, pull the file to your machine, clean up the device.
     *
     * Returns the local file path on success.
     *
     * Order of operations matters here:
     *   1. SIGINT  →  tells screenrecord to finalize the mp4 container
     *   2. Wait for process exit  →  file is only complete after this
     *   3. Poll file size  →  filesystem flush guard
     *   4. adb pull  →  copy to local machine
     *   5. Delete from device
     */
    async stopRecording(): Promise<string> {
        if (this.state.status !== "recording") {
            throw new RecordingError("No active recording to stop.");
        }

        // Destructure everything we need, then immediately mark as idle.
        // This prevents double-stop calls from racing.
        const { process: proc, localPath, devicePath } = this.state;
        this.state = { status: "idle" };

        const t0 = Date.now();

        // 1. Signal stop
        proc.kill("SIGINT");

        // 2. Wait for full exit
        this.log.info("[ScreenRecorder] Waiting for finalization...");
        try {
            await waitForExit(proc, DEFAULTS.fileReadyTimeoutMs);
        } catch {
            this.log.warn("[ScreenRecorder] Process exit timed out — attempting pull anyway");
        }

        // 3. Filesystem flush guard
        const stable = await waitForFileStable(this.adb, devicePath, DEFAULTS.stableCheckMs);
        if (!stable) {
            this.log.warn("[ScreenRecorder] File size unstable — pulling anyway");
        }

        // 4. Pull
        this.log.info(`[ScreenRecorder] Finalized in ${Date.now() - t0}ms — pulling`);
        try {
            this.adb.exec(["pull", devicePath, localPath]);
        } catch (e) {
            if (e instanceof AdbError) {
                throw new RecordingError(`Pull failed: ${e.stderr}`);
            }
            throw e;
        }

        // 5. Clean up device (best-effort — we don't throw if this fails)
        try {
            this.adb.exec(["shell", "rm", devicePath]);
        } catch {
            this.log.warn(`[ScreenRecorder] Could not delete ${devicePath} from device`);
        }

        const mb = (fs.statSync(localPath).size / 1_000_000).toFixed(2);
        this.log.info(`[ScreenRecorder] Done in ${Date.now() - t0}ms — ${localPath} (${mb} MB)`);

        return localPath;
    }

    /** Delete the most recently pulled recording from your local disk. */
    deleteRecording(filePath: string): void {
        if (!fs.existsSync(filePath)) {
            throw new RecordingError(`File not found: ${filePath}`);
        }
        fs.unlinkSync(filePath);
        this.log.info(`[ScreenRecorder] Deleted: ${filePath}`);
    }
}
