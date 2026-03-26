import * as fs from "fs";
import { ScreenRecorder, RecordingError } from "./ScreenRecorder";

const OUTPUT_PATH = "./recordings";

// ─── Test Cases ───────────────────────────────────────────────────────────────

interface TestCase {
    label: string;
    durationMs: number;
    timeLimitSeconds?: number;
    expectFailure?: boolean;
}

const TEST_CASES: TestCase[] = [
    { label: "short (2s)",          durationMs: 2_000 },
    { label: "short (3s)",          durationMs: 3_000 },
    { label: "medium (8s)",         durationMs: 8_000 },
    { label: "medium (10s)",        durationMs: 10_000 },
    { label: "long (20s)",          durationMs: 20_000 },
    { label: "long (30s)",          durationMs: 30_000 },
    { label: "very short (1s)",     durationMs: 1_000 },
    { label: "very short (500ms)",  durationMs: 500 },
    { label: "hits time limit",     durationMs: 8_000,  timeLimitSeconds: 5 },
    { label: "long (25s)",          durationMs: 25_000 },
    { label: "medium (15s)",        durationMs: 15_000 },
    { label: "short (4s)",          durationMs: 4_000 },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runTest(recorder: ScreenRecorder, index: number, tc: TestCase): Promise<void> {
    const total = TEST_CASES.length;
    const filename = `test_${String(index).padStart(2, "0")}_${tc.label.replace(/[^a-z0-9]+/gi, "_")}.mp4`;

    console.log(`\n[${index}/${total}] ${tc.label}`);
    console.log(`         file: ${filename}`);
    console.log(`         duration: ${tc.durationMs}ms${tc.timeLimitSeconds ? ` | time-limit: ${tc.timeLimitSeconds}s` : ""}`);

    await recorder.startRecording({
        filename,
        outputPath: OUTPUT_PATH,
        timeLimitSeconds: tc.timeLimitSeconds,
    });

    await sleep(tc.durationMs);

    const filePath = await recorder.stopRecording();

    const mb = (fs.statSync(filePath).size / 1_000_000).toFixed(2);
    console.log(`[${index}/${total}] ✓ OK — ${mb} MB`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    if (fs.existsSync(OUTPUT_PATH)) {
        fs.rmSync(OUTPUT_PATH, { recursive: true, force: true });
    }
    console.log(`[setup] Cleared ${OUTPUT_PATH}`);
    console.log(`[setup] Running ${TEST_CASES.length} test cases\n`);

    const recorder = new ScreenRecorder();

    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    for (let i = 1; i <= TEST_CASES.length; i++) {
        const tc = TEST_CASES[i - 1];
        try {
            await runTest(recorder, i, tc);
            passed++;
        } catch (err) {
            failed++;
            const message = err instanceof Error ? err.message : String(err);
            const isExpected = tc.expectFailure && err instanceof RecordingError;
            const tag = isExpected ? "✓ EXPECTED FAILURE" : "✗ FAILED";
            console.error(`[${i}/${TEST_CASES.length}] ${tag} — ${message}`);
            if (!isExpected) failures.push(`[${i}] ${tc.label}: ${message}`);
            else passed++; // expected failures count as pass
        }
    }

    console.log(`\n${"─".repeat(50)}`);
    console.log(`Results: ${passed}/${TEST_CASES.length} passed, ${failed}/${TEST_CASES.length} failed`);
    if (failures.length > 0) {
        console.log(`\nFailures:`);
        failures.forEach((f) => console.error(`  ${f}`));
    }
    console.log("─".repeat(50));

    if (failures.length > 0) process.exit(1);
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
});
