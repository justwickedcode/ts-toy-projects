import * as fs from "fs";
import * as path from "path";
import { event, recorder as codeceptRecorder, container } from "codeceptjs";
import { ScreenRecorder, RecordingError } from "../ScreenRecorder";

interface ScreenRecorderPluginConfig {
    /** Only attach recordings to Allure when the test fails. Default: true */
    attachOnFailOnly?: boolean;
    /** Local directory to save recordings to. Default: "./recordings" */
    outputPath?: string;
    /** ADB device serial. Auto-detects first device if omitted. */
    deviceSerial?: string;
}

/**
 * CodeceptJS plugin that records the device screen for each test and attaches
 * the video to the Allure report on failure.
 *
 * Usage in codecept.conf.ts:
 *
 *   plugins: {
 *     screenRecorder: {
 *       require: "./plugins/screenRecorder",
 *       enabled: true,
 *       attachOnFailOnly: true,
 *       outputPath: "./recordings",
 *     }
 *   }
 */
module.exports = (config: ScreenRecorderPluginConfig) => {
    const {
        attachOnFailOnly = true,
        outputPath = "./recordings",
        deviceSerial,
    } = config;

    const recorder = new ScreenRecorder(deviceSerial, {
        info: (msg) => console.log(msg),
        warn: (msg) => console.warn(msg),
        error: (msg) => console.error(msg),
    });

    let currentFilePath: string | null = null;
    let testFailed = false;

    // Sanitize a test title into a safe filename.
    function toFilename(title: string): string {
        return (
            title
                .replace(/[^a-z0-9]+/gi, "_")
                .replace(/^_+|_+$/g, "")
                .slice(0, 80) +
            "_" +
            Date.now() +
            ".mp4"
        );
    }

    // Attach a video file to the current Allure test.
    function attachToAllure(filePath: string): void {
        try {
            const allure = container.plugins("allure");
            if (!allure) {
                console.warn("[ScreenRecorder] Allure plugin not found — skipping attachment");
                return;
            }
            const videoBuffer = fs.readFileSync(filePath);
            allure.addAttachment("Screen Recording", videoBuffer, "video/mp4");
            console.log(`[ScreenRecorder] Attached to Allure: ${path.basename(filePath)}`);
        } catch (err) {
            console.warn(`[ScreenRecorder] Could not attach to Allure: ${err}`);
        }
    }

    // ── Hooks ──────────────────────────────────────────────────────────────

    event.dispatcher.on(event.test.before, async (test: Mocha.Test) => {
        testFailed = false;
        currentFilePath = null;

        const filename = toFilename(test.fullTitle());

        try {
            await recorder.startRecording({ filename, outputPath });
        } catch (err) {
            // A failed start should not block the test from running.
            console.error(`[ScreenRecorder] Failed to start recording: ${err}`);
        }
    });

    event.dispatcher.on(event.test.failed, () => {
        testFailed = true;
    });

    event.dispatcher.on(event.test.after, async (test: Mocha.Test) => {
        if (!recorder.isRecording) return;

        try {
            const filePath = await recorder.stopRecording();
            currentFilePath = filePath;

            const shouldAttach = !attachOnFailOnly || testFailed;
            if (shouldAttach) {
                attachToAllure(filePath);
            } else {
                // Clean up recordings we don't need to keep.
                recorder.deleteRecording(filePath);
            }
        } catch (err) {
            if (err instanceof RecordingError) {
                console.warn(`[ScreenRecorder] Recording invalid — skipping attachment: ${err.message}`);
            } else {
                console.error(`[ScreenRecorder] Unexpected error stopping recording: ${err}`);
            }
        }
    });
};
