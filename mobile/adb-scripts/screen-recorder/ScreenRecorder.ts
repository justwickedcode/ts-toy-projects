import { spawn, ChildProcess, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const DEFAULTS = {
    outputPath: "./recordings",
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

export interface Logger {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
}

type RecorderState =
    | { status: "idle" }
    | {
    status: "recording";
    process: ChildProcess;
    devicePid: number;
    localPath: string;
    devicePath: string;
};

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

class AdbClient {
    private serial: string;

    constructor(serial: string | null) {
        if (serial) {
            this.serial = serial;
        } else {
            // `adb devices` output looks like:
            //   List of devices attached
            //   emulator-5554   device
            //   R38M123ABC      device
            // We grab the first serial from the second line onward.
            const result = spawnSync("adb", ["devices"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
            const lines = result.stdout.trim().split("\n").slice(1);
            const first = lines.find((l) => l.includes("\tdevice"));
            if (!first) throw new AdbError("No connected adb devices found", result.stderr);
            this.serial = first.split("\t")[0].trim();
        }
    }

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

    /**
     * Spawns screenrecord in the background on-device and captures its PID.
     *
     * We run the whole thing as a single shell command:
     *   screenrecord [args] <path> & echo $!
     *
     * The `&` backgrounds screenrecord so the shell immediately prints $!
     * (the PID of the last backgrounded job) to stdout, which we can read.
     *
     * stdio is set to "pipe" here (not "inherit") so we can read that PID.
     */
    spawnAndCapturePid(recordArgs: string[], devicePath: string): { process: ChildProcess; pidPromise: Promise<number> } {
        const serialArgs = this.serial ? ["-s", this.serial] : [];
        const shellCmd = `screenrecord ${recordArgs.join(" ")} ${devicePath} & echo $!`;

        const proc = spawn("adb", [...serialArgs, "shell", shellCmd], {
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

            // Fallback: if process exits before we got a PID, reject
            proc.once("close", () => {
                const pid = parseInt(stdout.trim(), 10);
                if (isNaN(pid) || pid <= 0) {
                    reject(new RecordingError("Failed to capture device PID from screenrecord"));
                }
            });
        });

        return { process: proc, pidPromise };
    }

    getDeviceFileSize(devicePath: string): number {
        const serialArgs = this.serial ? ["-s", this.serial] : [];
        const result = spawnSync(
            "adb",
            [...serialArgs, "shell", `stat -c %s ${devicePath} 2>/dev/null || echo -1`],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
        );
        return parseInt(result.stdout.trim(), 10) ?? -1;
    }
}

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

export class ScreenRecorder {
    private state: RecorderState = { status: "idle" };
    private adb: AdbClient;
    private log: Required<Logger>;

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

        const recordArgs = [
            "--bit-rate", `${bitrate * 1_000_000}`,
            "--time-limit", `${timeLimit}`,
        ];

        const { process: proc, pidPromise } = this.adb.spawnAndCapturePid(recordArgs, devicePath);

        proc.on("error", (err) => {
            this.log.error(`[ScreenRecorder] Process error: ${err.message}`);
            this.state = { status: "idle" };
        });

        // Wait for the PID before marking state as recording —
        // stopRecording() needs it, so we can't proceed without it.
        const devicePid = await pidPromise;
        this.log.info(`[ScreenRecorder] Device PID: ${devicePid}`);

        this.state = { status: "recording", process: proc, devicePid, localPath, devicePath };
    }

    async stopRecording(): Promise<string> {
        if (this.state.status !== "recording") {
            throw new RecordingError("No active recording to stop.");
        }

        const { process: proc, devicePid, localPath, devicePath } = this.state;
        this.state = { status: "idle" };

        const t0 = Date.now();

        // 1. Send SIGINT to screenrecord ON the device.
        //    This is the key fix: we're not calling proc.kill() (which is broken
        //    on Windows), we're sending kill -2 through adb shell instead.
        //    kill -2 = SIGINT, which tells screenrecord to finalize the mp4 container.
        this.log.info(`[ScreenRecorder] Sending SIGINT to device PID ${devicePid}`);
        try {
            this.adb.exec(["shell", "kill", "-2", String(devicePid)]);
        } catch (e) {
            this.log.warn("[ScreenRecorder] kill -2 failed — process may have already exited");
        }

        // 2. Wait for the adb tunnel process to exit naturally
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

        // 5. Clean up device
        try {
            this.adb.exec(["shell", "rm", devicePath]);
        } catch {
            this.log.warn(`[ScreenRecorder] Could not delete ${devicePath} from device`);
        }

        const mb = (fs.statSync(localPath).size / 1_000_000).toFixed(2);
        this.log.info(`[ScreenRecorder] Done in ${Date.now() - t0}ms — ${localPath} (${mb} MB)`);

        return localPath;
    }

    deleteRecording(filePath: string): void {
        if (!fs.existsSync(filePath)) {
            throw new RecordingError(`File not found: ${filePath}`);
        }
        fs.unlinkSync(filePath);
        this.log.info(`[ScreenRecorder] Deleted: ${filePath}`);
    }
}