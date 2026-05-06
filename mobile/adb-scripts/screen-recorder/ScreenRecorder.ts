import { spawn, ChildProcess, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import ffmpegPath from "ffmpeg-static";

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULTS = {
    outputPath: "./recordings",
    timeLimitSeconds: 180,
    quality: "low" as RecordingQuality,
    pollIntervalMs: 200,
    fileReadyTimeoutMs: 15_000,
    keepAliveTapIntervalMs: 1_000,
    minValidFileSizeBytes: 200_000,
    ffmpegCrf: 23,
} as const;

const QUALITY_BITRATE: Record<RecordingQuality, number> = {
    low: 2,
    medium: 4,
    high: 8,
};

// ─── Public Types ─────────────────────────────────────────────────────────────

export type RecordingQuality = "low" | "medium" | "high";

export interface RecordingOptions {
    /** Video quality / bitrate tier. Defaults to "low" (2 Mbps). */
    quality?: RecordingQuality;
    /** Local directory to save recordings to. Defaults to "./recordings". */
    outputPath?: string;
    /** Output filename. Defaults to a timestamp-based name. */
    filename?: string;
    /** Hard cap on recording length in seconds. Defaults to 180. */
    timeLimitSeconds?: number;
    /**
     * CRF value passed to ffmpeg libx264 (0–51). Lower = larger/better quality.
     * Defaults to 23. Set to null to skip re-encoding entirely.
     */
    ffmpegCrf?: number | null;
}

export interface Logger {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

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

// ─── Internal State ──────────────────────────────────────────────────────────

type RecorderState =
    | { status: "idle" }
    | {
    status: "recording";
    process: ChildProcess;
    devicePid: number;
    localPath: string;
    devicePath: string;
    keepAliveInterval: ReturnType<typeof setInterval>;
};

// ─── AdbClient ───────────────────────────────────────────────────────────────

class AdbClient {
    private serial: string;

    constructor(serial: string | null) {
        if (serial) {
            this.serial = serial;
            return;
        }

        // Auto-detect the first connected device from `adb devices`.
        // Output format:
        //   List of devices attached
        //   emulator-5554\tdevice
        //   R38M123ABC\tdevice
        const result = spawnSync("adb", ["devices"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });
        const first = result.stdout
            .trim()
            .split("\n")
            .slice(1)
            .find((l) => l.includes("\tdevice"));

        if (!first) {
            throw new AdbError("No connected adb devices found", result.stderr);
        }

        this.serial = first.split("\t")[0]!.trim();
    }

    /** Run a synchronous adb command. Throws AdbError on non-zero exit. */
    exec(args: string[]): string {
        const result = spawnSync("adb", ["-s", this.serial, ...args], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        });

        if (result.status !== 0) {
            throw new AdbError(`adb ${args[0]} failed`, result.stderr ?? "");
        }

        return result.stdout;
    }

    /**
     * Starts screenrecord in the background on-device and resolves with its PID.
     *
     * Runs: `adb shell "screenrecord [args] <path> & echo $!"`
     *
     * The `&` backgrounds screenrecord so the shell immediately echoes $! (the
     * PID of the backgrounded job) to stdout before any recording data is written.
     * stdio is "pipe" so we can read that PID from Node.
     */
    spawnScreenrecord(
        recordArgs: string[],
        devicePath: string
    ): { process: ChildProcess; pidPromise: Promise<number> } {
        const shellCmd = `screenrecord ${recordArgs.join(" ")} ${devicePath} & echo $!`;
        const proc = spawn("adb", ["-s", this.serial, "shell", shellCmd], {
            stdio: ["ignore", "pipe", "pipe"],
        });

        const pidPromise = new Promise<number>((resolve, reject) => {
            let stdout = "";

            proc.stdout!.on("data", (chunk: Buffer) => {
                stdout += chunk.toString();
                const pid = parseInt(stdout.trim(), 10);
                if (!isNaN(pid) && pid > 0) resolve(pid);
            });

            proc.once("error", reject);

            proc.once("close", () => {
                const pid = parseInt(stdout.trim(), 10);
                if (isNaN(pid) || pid <= 0) {
                    reject(new RecordingError("Failed to read device PID from screenrecord"));
                }
            });
        });

        return { process: proc, pidPromise };
    }

    /** Returns true if the given PID is still running on the device. */
    isProcessAlive(pid: number): boolean {
        const result = this.exec([
            "shell",
            `kill -0 ${pid} 2>/dev/null && echo alive || echo dead`,
        ]);
        return result.trim() === "alive";
    }

    /** Polls until the given PID is no longer running, or the timeout elapses. */
    async waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (!this.isProcessAlive(pid)) return true;
            await sleep(DEFAULTS.pollIntervalMs);
        }
        return false;
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function generateFilename(): string {
    return (
        "recording_" +
        new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19) +
        ".mp4"
    );
}

/**
 * Resolves the ffmpeg binary path from ffmpeg-static.
 * Throws RecordingError if the package didn't bundle a binary for this platform.
 */
function resolveFfmpeg(): string {
    if (!ffmpegPath) {
        throw new RecordingError(
            "ffmpeg-static did not resolve a binary for this platform. " +
            "Try reinstalling: bun add ffmpeg-static"
        );
    }
    return ffmpegPath;
}

/**
 * Re-encodes inputPath in-place using libx264 + the given CRF value.
 *
 * Strategy:
 *   1. Encode to a sibling .tmp.mp4 file.
 *   2. On success, delete the original and rename the temp file over it.
 *   3. On failure, delete the temp file and rethrow.
 *
 * `-an`               — drop audio track (screenrecords have none; keeps file smaller)
 * `-crf`              — quality/size tradeoff (0–51, lower = better; 23 is a sane default)
 * `-preset fast`      — encoding speed vs compression (good balance for CI use)
 * `-movflags +faststart` — move the moov atom to the front for streaming/playback compat
 * `-y`                — overwrite temp file without prompting
 */
function reencodeVideo(inputPath: string, crf: number, log: Required<Logger>): void {
    const bin = resolveFfmpeg();

    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, ".mp4");
    const tmpPath = path.join(dir, `${base}.tmp.mp4`);

    const t0 = Date.now();
    log.info(`[ScreenRecorder] Re-encoding with ffmpeg (CRF ${crf})…`);

    const result = spawnSync(
        bin,
        [
            "-i", inputPath,
            "-c:v", "libx264",
            "-crf", String(crf),
            "-preset", "fast",
            "-an",
            "-movflags", "+faststart",
            "-y",
            tmpPath,
        ],
        {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
        }
    );

    if (result.status !== 0) {
        // Clean up the partial temp file if ffmpeg bailed out mid-encode.
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        throw new RecordingError(
            `ffmpeg re-encode failed (exit ${result.status}):\n${result.stderr}`
        );
    }

    // Swap temp → final in two atomic-ish steps.
    fs.unlinkSync(inputPath);
    fs.renameSync(tmpPath, inputPath);

    const sizeMb = (fs.statSync(inputPath).size / 1_000_000).toFixed(2);
    log.info(`[ScreenRecorder] Re-encode done — ${sizeMb} MB in ${Date.now() - t0}ms`);
}

// ─── ScreenRecorder ──────────────────────────────────────────────────────────

export class ScreenRecorder {
    private state: RecorderState = { status: "idle" };
    private readonly adb: AdbClient;
    private readonly log: Required<Logger>;

    constructor(deviceSerial?: string, logger?: Logger) {
        this.adb = new AdbClient(deviceSerial ?? null);
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

    async startRecording(options: RecordingOptions = {}): Promise<void> {
        if (this.state.status === "recording") {
            throw new RecordingError("Already recording — call stopRecording() first.");
        }

        const quality = options.quality ?? DEFAULTS.quality;
        const outputPath = options.outputPath ?? DEFAULTS.outputPath;
        const filename = options.filename ?? generateFilename();
        const timeLimit = options.timeLimitSeconds ?? DEFAULTS.timeLimitSeconds;
        const bitrate = QUALITY_BITRATE[quality];

        fs.mkdirSync(outputPath, { recursive: true });

        const localPath = path.join(outputPath, filename);
        const devicePath = `/data/local/tmp/scrcap_${path.basename(filename)}`;

        this.log.info(`[ScreenRecorder] Starting — ${quality} quality (${bitrate} Mbps)`);

        const { process: proc, pidPromise } = this.adb.spawnScreenrecord(
            ["--bit-rate", `${bitrate * 1_000_000}`, "--time-limit", `${timeLimit}`],
            devicePath
        );

        proc.on("error", (err) => {
            this.log.error(`[ScreenRecorder] Process error: ${err.message}`);
            this.state = { status: "idle" };
        });

        const devicePid = await pidPromise;
        this.log.info(`[ScreenRecorder] Recording started (device PID ${devicePid})`);

        // Periodically tap coordinate (1, 1) — a safe off-UI corner — to keep screenrecord
        // encoding frames. On Android 16, a static screen produces an unplayable single-frame
        // file; this keepalive prevents that regardless of what the test does on screen.
        const keepAliveInterval = setInterval(() => {
            try {
                this.adb.exec(["shell", "input tap 1 1"]);
            } catch {
                // best-effort — a failed tap should never abort a recording
            }
        }, DEFAULTS.keepAliveTapIntervalMs);

        this.state = { status: "recording", process: proc, devicePid, localPath, devicePath, keepAliveInterval };
    }

    /**
     * Stops the current recording, pulls the file to disk, re-encodes it with
     * ffmpeg for compatibility and compression, and returns the local path.
     *
     * Throws RecordingError if:
     * - No recording is active
     * - The adb pull fails
     * - The pulled file is below the minimum valid size (likely corrupt)
     * - ffmpeg-static didn't resolve a binary for this platform
     * - ffmpeg exits with a non-zero status
     */
    async stopRecording(options: RecordingOptions = {}): Promise<string> {
        if (this.state.status !== "recording") {
            throw new RecordingError("No active recording to stop.");
        }

        const { process: proc, devicePid, localPath, devicePath, keepAliveInterval } = this.state;
        this.state = { status: "idle" };

        // Resolve the CRF. Passing null opts out of re-encoding entirely.
        const ffmpegCrf = options.ffmpegCrf !== undefined
            ? options.ffmpegCrf
            : DEFAULTS.ffmpegCrf;

        clearInterval(keepAliveInterval);

        const t0 = Date.now();

        // Send SIGINT to screenrecord on the device to trigger graceful shutdown and
        // finalize the mp4 container. If it already exited on its own (e.g. hit the
        // time limit), skip the kill and allow extra time for the file to flush.
        if (this.adb.isProcessAlive(devicePid)) {
            this.log.info(`[ScreenRecorder] Stopping (device PID ${devicePid})`);
            try {
                this.adb.exec(["shell", "kill", "-2", String(devicePid)]);
            } catch {
                this.log.warn("[ScreenRecorder] SIGINT failed — process may have already exited");
            }
        } else {
            this.log.warn("[ScreenRecorder] Process already exited — waiting for file flush");
            await sleep(1_000);
        }

        // Wait until screenrecord has fully exited on the device before pulling.
        // The mp4 container (moov atom) is only written after the process exits cleanly.
        const exited = await this.adb.waitForProcessExit(devicePid, DEFAULTS.fileReadyTimeoutMs);
        if (!exited) {
            this.log.warn("[ScreenRecorder] Process exit timed out — attempting pull anyway");
        }

        // Flush kernel write buffers to storage. On real devices the file size can appear
        // stable while data is still buffered in the kernel — sync ensures a clean pull.
        this.adb.exec(["shell", "sync"]);

        this.log.info(`[ScreenRecorder] Pulling — finalized in ${Date.now() - t0}ms`);
        try {
            this.adb.exec(["pull", devicePath, localPath]);
        } catch (e) {
            throw e instanceof AdbError
                ? new RecordingError(`Pull failed: ${e.stderr}`)
                : e;
        }

        // Clean up the device file now that we have a local copy.
        try {
            this.adb.exec(["shell", "rm", devicePath]);
        } catch {
            this.log.warn(`[ScreenRecorder] Could not remove ${devicePath} from device`);
        }

        // Validate the pulled file. A file below the minimum size is missing its moov
        // atom and is unplayable — delete it and surface a clear error to the caller.
        const fileSize = fs.statSync(localPath).size;
        if (fileSize < DEFAULTS.minValidFileSizeBytes) {
            fs.unlinkSync(localPath);
            throw new RecordingError(
                `Recording is too small to be valid (${(fileSize / 1_000).toFixed(1)} KB) — deleted.\n` +
                `(On Android 16, screen recording a "static one frame screen" via adb will produce a one frame mp4 file, which is not playable.)`
            );
        }

        // Re-encode with ffmpeg for playback compatibility and compression.
        // Skip only if the caller explicitly passed ffmpegCrf: null.
        if (ffmpegCrf !== null) {
            reencodeVideo(localPath, ffmpegCrf, this.log);
        } else {
            this.log.warn("[ScreenRecorder] ffmpeg re-encode skipped (ffmpegCrf: null)");
        }

        const finalSize = fs.statSync(localPath).size;
        const mb = (finalSize / 1_000_000).toFixed(2);
        this.log.info(`[ScreenRecorder] Done — ${localPath} (${mb} MB) in ${Date.now() - t0}ms`);

        return localPath;
    }

    /** Deletes a local recording file. */
    deleteRecording(filePath: string): void {
        if (!fs.existsSync(filePath)) {
            throw new RecordingError(`File not found: ${filePath}`);
        }
        fs.unlinkSync(filePath);
        this.log.info(`[ScreenRecorder] Deleted ${filePath}`);
    }
}
