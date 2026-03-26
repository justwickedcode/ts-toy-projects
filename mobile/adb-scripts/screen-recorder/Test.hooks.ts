import * as fs from "fs";
import { ScreenRecorder, RecordingError } from "./ScreenRecorder";

const OUTPUT_PATH = "./recordings/hook-tests";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function pass(label: string): void {
    console.log(`  ✓ ${label}`);
}

function fail(label: string, reason: string): void {
    console.error(`  ✗ ${label} — ${reason}`);
}

async function runTest(
    label: string,
    fn: () => Promise<void>
): Promise<boolean> {
    console.log(`\n[ ${label} ]`);
    try {
        await fn();
        return true;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        fail(label, message);
        return false;
    }
}

// Simulates a before/after hook pair around a "test" of a given duration.
// This is the core pattern you'd use in CodeceptJS — start before, stop after,
// next test only begins once the previous after-hook resolves.
async function simulateTest(
    recorder: ScreenRecorder,
    label: string,
    durationMs: number,
    index: number
): Promise<string> {
    const filename = `test_${String(index).padStart(2, "0")}_${label.replace(/\s+/g, "_")}.mp4`;

    // before hook
    await recorder.startRecording({ filename, outputPath: OUTPUT_PATH });
    console.log(`    [before] started — ${label}`);

    // test body
    await sleep(durationMs);
    console.log(`    [test]   done — ${label}`);

    // after hook
    const filePath = await recorder.stopRecording();
    console.log(`    [after]  stopped — ${label}`);

    return filePath;
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    if (fs.existsSync(OUTPUT_PATH)) {
        fs.rmSync(OUTPUT_PATH, { recursive: true, force: true });
    }
    fs.mkdirSync(OUTPUT_PATH, { recursive: true });

    const recorder = new ScreenRecorder();
    const results: boolean[] = [];

    // ── 1. Sequential hooks — basic sanity ──────────────────────────────────
    // Simulates 3 tests running one after another, each waiting for the
    // after-hook to finish before the next before-hook fires.
    results.push(await runTest("Sequential hook simulation (3 tests)", async () => {
        const durations = [3_000, 5_000, 2_000];
        for (let i = 0; i < durations.length; i++) {
            const filePath = await simulateTest(recorder, `sequential_${i + 1}`, durations[i], i + 1);
            if (!fs.existsSync(filePath)) throw new Error(`File missing: ${filePath}`);
            pass(`test ${i + 1} — ${(fs.statSync(filePath).size / 1_000_000).toFixed(2)} MB`);
        }
    }));

    // ── 2. Double startRecording — should throw ──────────────────────────────
    // If CodeceptJS somehow fires before-hooks concurrently, the second
    // startRecording should throw cleanly rather than corrupting state.
    results.push(await runTest("Double startRecording throws RecordingError", async () => {
        await recorder.startRecording({ filename: "double_start.mp4", outputPath: OUTPUT_PATH });
        try {
            await recorder.startRecording({ filename: "double_start_2.mp4", outputPath: OUTPUT_PATH });
            await recorder.stopRecording();
            throw new Error("Expected RecordingError but none was thrown");
        } catch (err) {
            if (!(err instanceof RecordingError)) throw err;
            pass("second startRecording threw RecordingError as expected");
        }
        await recorder.stopRecording();
    }));

    // ── 3. Double stopRecording — should throw ───────────────────────────────
    results.push(await runTest("Double stopRecording throws RecordingError", async () => {
        await recorder.startRecording({ filename: "double_stop.mp4", outputPath: OUTPUT_PATH });
        await sleep(2_000);
        await recorder.stopRecording();
        try {
            await recorder.stopRecording();
            throw new Error("Expected RecordingError but none was thrown");
        } catch (err) {
            if (!(err instanceof RecordingError)) throw err;
            pass("second stopRecording threw RecordingError as expected");
        }
    }));

    // ── 4. Stop immediately after start ─────────────────────────────────────
    // Simulates a test that finishes near-instantly before screenrecord
    // has had time to encode meaningful data.
    results.push(await runTest("Stop immediately after start", async () => {
        await recorder.startRecording({ filename: "immediate_stop.mp4", outputPath: OUTPUT_PATH });
        // no sleep — stop right away
        try {
            await recorder.stopRecording();
            pass("stopped cleanly (file may be below min size, that's expected)");
        } catch (err) {
            if (err instanceof RecordingError && err.message.includes("too small")) {
                pass("RecordingError thrown for too-small file — correct behaviour");
            } else {
                throw err;
            }
        }
    }));

    // ── 5. Sequential tests with variable durations ──────────────────────────
    // Closer to a real test suite — mix of short and long tests back to back,
    // all waiting for the after-hook before starting the next before-hook.
    results.push(await runTest("Variable duration sequential suite", async () => {
        const cases = [
            { label: "login flow",    durationMs: 8_000 },
            { label: "search",        durationMs: 3_000 },
            { label: "checkout",      durationMs: 15_000 },
            { label: "profile edit",  durationMs: 4_000 },
        ];

        for (let i = 0; i < cases.length; i++) {
            const tc = cases[i];
            const filePath = await simulateTest(recorder, tc.label, tc.durationMs, i + 10);
            if (!fs.existsSync(filePath)) throw new Error(`File missing: ${filePath}`);
            const mb = (fs.statSync(filePath).size / 1_000_000).toFixed(2);
            pass(`${tc.label} — ${mb} MB`);
        }
    }));

    // ── 6. stopRecording before startRecording ───────────────────────────────
    results.push(await runTest("stopRecording with no active recording throws", async () => {
        try {
            await recorder.stopRecording();
            throw new Error("Expected RecordingError but none was thrown");
        } catch (err) {
            if (!(err instanceof RecordingError)) throw err;
            pass("threw RecordingError as expected");
        }
    }));

    // ─── Results ─────────────────────────────────────────────────────────────
    const passed = results.filter(Boolean).length;
    const failed = results.length - passed;

    console.log(`\n${"─".repeat(50)}`);
    console.log(`Results: ${passed}/${results.length} passed, ${failed}/${results.length} failed`);
    console.log("─".repeat(50));

    if (failed > 0) process.exit(1);
}

main().catch((err) => {
    console.error("Unexpected error:", err);
    process.exit(1);
});