import * as fs from "fs";
import { ScreenRecorder, RecordingError } from "./ScreenRecorder";

const OUTPUT_PATH = "./recordings";

// ─── Test Cases ───────────────────────────────────────────────────────────────

interface TestCase {
    label: string;
    durationMs: number;
    timeLimitSeconds?: number;
    /**
     * Set to true when the recording is expected to be rejected (e.g. too short
     * to produce a valid file). The test counts as a pass if RecordingError is
     * thrown, and as a failure if it unexpectedly succeeds.
     */
    expectFailure?: boolean;
}

const TEST_CASES: TestCase[] = [
    { label: "short (2s)",          durationMs: 2_000 },
    { label: "short (3s)",          durationMs: 3_000 },
    { label: "medium (8s)",         durationMs: 8_000 },
    { label: "medium (10s)",        durationMs: 10_000 },
    { label: "long (20s)",          durationMs: 20_000 },
    { label: "long (30s)",          durationMs: 30_000 },
    // These will always be below the minimum valid file size threshold.
    { label: "very short (1s)",     durationMs: 1_000,  expectFailure: true },
    { label: "very short (500ms)",  durationMs: 500,    expectFailure: true },
    { label: "hits time limit",     durationMs: 8_000,  timeLimitSeconds: 5 },
    { label: "long (25s)",          durationMs: 25_000 },
    { label: "medium (15s)",        durationMs: 15_000 },
    { label: "short (4s)",          durationMs: 4_000 },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

/**
 * Runs a single test case.
 *
 * - Normal case: records, stops, logs size.
 * - expectFailure: records, stops — if stopRecording() throws RecordingError
 *   that is the passing outcome. If it does NOT throw, we throw ourselves so
 *   the caller counts it as a failure.
 */
async function runTest(recorder: ScreenRecorder, index: number, total: number, tc: TestCase): Promise<void> {
    const filename = `test_${String(index).padStart(2, "0")}_${tc.label.replace(/[^a-z0-9]+/gi, "_")}.mp4`;

    console.log(`\n[${index}/${total}] ${tc.label}${tc.expectFailure ? " (expect failure)" : ""}`);
    console.log(`         file: ${filename}`);
    console.log(`         duration: ${tc.durationMs}ms${tc.timeLimitSeconds ? ` | time-limit: ${tc.timeLimitSeconds}s` : ""}`);

    await recorder.startRecording({
        filename,
        outputPath: OUTPUT_PATH,
        timeLimitSeconds: tc.timeLimitSeconds,
    });

    await sleep(tc.durationMs);

    if (tc.expectFailure) {
        try {
            await recorder.stopRecording();
        } catch (err) {
            if (err instanceof RecordingError) {
                // This is the expected outcome — let it bubble up to main() as a
                // caught error so the expected-failure path handles it.
                throw err;
            }
            // Unexpected error type — rethrow as-is.
            throw err;
        }
        // stopRecording() succeeded when we expected it to fail.
        throw new Error(`Expected a RecordingError but recording succeeded — minimum file size check may be too low.`);
    }

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
    const total = TEST_CASES.length;

    let index = 1;
    for (const tc of TEST_CASES) {
        try {
            await runTest(recorder, index, total, tc);
            if (tc.expectFailure) {
                // runTest() should have thrown — if we get here it already threw
                // its own error, which the catch below handles. This path is
                // unreachable in practice but makes the intent explicit.
            }
            passed++;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const isExpected = tc.expectFailure === true && err instanceof RecordingError;

            if (isExpected) {
                console.log(`[${index}/${total}] ✓ EXPECTED FAILURE — ${message}`);
                passed++;
            } else {
                failed++;
                console.error(`[${index}/${total}] ✗ FAILED — ${message}`);
                failures.push(`[${index}] ${tc.label}: ${message}`);
            }
        }

        index++;
    }

    console.log(`\n${"─".repeat(50)}`);
    console.log(`Results: ${passed}/${total} passed, ${failed}/${total} failed`);
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