import * as fs from "fs";
import { ScreenRecorder } from "./ScreenRecorder";

const RECORDING_DURATION_MS = 2_000;
const OUTPUT_PATH = "./recordings";
const MIN_FILE_SIZE_BYTES = 1_000; // anything smaller is likely a broken/empty file

function validateRecording(filePath: string): void {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File does not exist: ${filePath}`);
    }

    const { size } = fs.statSync(filePath);
    if (size < MIN_FILE_SIZE_BYTES) {
        throw new Error(`File is too small (${size} bytes) — likely corrupt: ${filePath}`);
    }
}

async function runRecording(recorder: ScreenRecorder, index: number): Promise<void> {
    const filename = `test_recording_${String(index).padStart(2, "0")}.mp4`;

    console.log(`\n[${index}/10] Starting: ${filename}`);

    await recorder.startRecording({ filename, outputPath: OUTPUT_PATH, timeLimitSeconds: 10 });

    await new Promise((r) => setTimeout(r, RECORDING_DURATION_MS));

    const filePath = await recorder.stopRecording();

    validateRecording(filePath);

    const mb = (fs.statSync(filePath).size / 1_000_000).toFixed(2);
    console.log(`[${index}/10] ✓ OK — ${filePath} (${mb} MB)`);
}

async function main(): Promise<void> {
    const recorder = new ScreenRecorder();

    let passed = 0;
    let failed = 0;

    for (let i = 1; i <= 10; i++) {
        try {
            await runRecording(recorder, i);
            passed++;
        } catch (err) {
            failed++;
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[${i}/10] ✗ FAILED — ${message}`);
        }
    }

    console.log(`\n─────────────────────────────`);
    console.log(`Results: ${passed}/10 passed, ${failed}/10 failed`);
    console.log(`─────────────────────────────`);

    if (failed > 0) process.exit(1);
}

main().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
});