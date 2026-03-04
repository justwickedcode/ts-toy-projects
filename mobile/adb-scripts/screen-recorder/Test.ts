import * as fs from "fs";
import {RecordingError, ScreenRecorder} from "./ScreenRecorder";

// ─── Config ──────────────────────────────────

const DEVICE_SERIAL = "emulator-5554"; // run `adb devices` to get yours
const RECORD_DURATION_MS = 10_000;
const OUTPUT_DIR = "./videos";

// ─── Helpers ─────────────────────────────────

/**
 * Creates a prefixed logger so we can tell which recorder printed what.
 * Each recorder gets a tag like [R1], [R2], [R3] in front of every line.
 */
function taggedLogger(tag: string) {
    return {
        info: (msg: string) => console.log(`${tag} ${msg}`),
        warn: (msg: string) => console.warn(`${tag} ${msg}`),
        error: (msg: string) => console.error(`${tag} ${msg}`),
    };
}

/** Small sleep utility — cleaner than raw setTimeout + Promise everywhere. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Tests ───────────────────────────────────

/**
 * TEST 1 — One recorder, called 3 times in parallel.
 *
 * Since ScreenRecorder is a single-session class (one recording at a time),
 * calling startRecording() while it's already recording should throw.
 *
 * This test verifies that the error surfaces immediately and predictably
 * instead of silently corrupting state.
 */
async function testSameInstanceConcurrency() {
    console.log("\n═══ TEST 1: Same instance — expect RecordingError on overlap ═══\n");

    const recorder = new ScreenRecorder(DEVICE_SERIAL, taggedLogger("[R]"));

    recorder.startRecording({
        quality: "low",
        outputPath: OUTPUT_DIR,
        filename: "concurrent_same_1.mp4",
    });

    // The second and third calls should throw immediately because
    // the state machine is in "recording" — no silent swallowing.
    let caughtCount = 0;

    try {
        recorder.startRecording({ filename: "concurrent_same_2.mp4" });
    } catch (e) {
        if (e instanceof RecordingError) {
            caughtCount++;
            console.log(`  ✅ Second start correctly threw: "${e.message}"`);
        }
    }

    try {
        recorder.startRecording({ filename: "concurrent_same_3.mp4" });
    } catch (e) {
        if (e instanceof RecordingError) {
            caughtCount++;
            console.log(`  ✅ Third start correctly threw: "${e.message}"`);
        }
    }

    // Let the one valid recording run briefly, then stop it cleanly.
    await sleep(5_000);
    const filePath = await recorder.stopRecording();

    console.log(`\n  Result: caught ${caughtCount}/2 expected errors`);
    console.log(`  File saved: ${filePath}`);
    console.log(`  TEST 1 ${caughtCount === 2 ? "PASSED ✅" : "FAILED ❌"}`);

    return filePath;
}

/**
 * TEST 2 — Three separate recorder instances, all recording simultaneously.
 *
 * This is the real concurrency test. Each ScreenRecorder has its own state,
 * so three of them should happily record in parallel on the same device
 * (Android allows multiple screenrecord processes, though only one actually
 * captures the screen — the point here is that our code doesn't break).
 *
 * We verify:
 *   - All three start without throwing
 *   - All three stop and return valid file paths
 *   - All three output files exist and are non-empty
 */
async function testMultipleInstances() {
    console.log("\n═══ TEST 2: Three separate instances — true parallel recording ═══\n");

    // Each recorder gets its own logger tag so the output is readable.
    const recorders = [1, 2, 3].map((i) => ({
        id: i,
        recorder: new ScreenRecorder(DEVICE_SERIAL, taggedLogger(`[R${i}]`)),
        filename: `concurrent_multi_${i}.mp4`,
    }));

    // Start all three. If any throw here, the test fails.
    for (const { id, recorder, filename } of recorders) {
        recorder.startRecording({
            quality: "low",
            outputPath: OUTPUT_DIR,
            filename,
        });
        console.log(`  ✅ Recorder ${id} started`);
    }

    // Let them all record for the configured duration.
    console.log(`\n  Recording for ${RECORD_DURATION_MS / 1000}s...\n`);
    await sleep(RECORD_DURATION_MS);

    // Stop all three concurrently — this is where things can really break
    // if there are shared-state bugs. Promise.allSettled lets us see
    // individual results even if some fail.
    const results = await Promise.allSettled(
        recorders.map(({ recorder }) => recorder.stopRecording())
    );

    // Evaluate results.
    let passed = 0;

    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const id = recorders[i].id;

        if (result.status === "fulfilled") {
            const filePath = result.value;
            const exists = fs.existsSync(filePath);
            const size = exists ? fs.statSync(filePath).size : 0;

            if (exists && size > 0) {
                console.log(`  ✅ Recorder ${id}: ${filePath} (${(size / 1_000_000).toFixed(2)} MB)`);
                passed++;
            } else {
                console.log(`  ❌ Recorder ${id}: file missing or empty (${filePath})`);
            }
        } else {
            console.log(`  ❌ Recorder ${id}: stopRecording() rejected — ${result.reason}`);
        }
    }

    console.log(`\n  Result: ${passed}/3 recordings completed successfully`);
    console.log(`  TEST 2 ${passed === 3 ? "PASSED ✅" : "FAILED ❌"}`);
}

/**
 * TEST 3 — Double-stop on the same instance.
 *
 * After stopRecording() returns, the state is "idle". Calling stop again
 * should throw immediately — not hang, not crash, not corrupt anything.
 */
async function testDoubleStop() {
    console.log("\n═══ TEST 3: Double-stop — expect clean error on second call ═══\n");

    const recorder = new ScreenRecorder(DEVICE_SERIAL, taggedLogger("[R]"));

    recorder.startRecording({
        quality: "low",
        outputPath: OUTPUT_DIR,
        filename: "double_stop_test.mp4",
    });

    await sleep(5_000);

    const filePath = await recorder.stopRecording();
    console.log(`  First stop succeeded: ${filePath}`);

    let doubleStopCaught = false;
    try {
        await recorder.stopRecording();
    } catch (e) {
        if (e instanceof RecordingError) {
            doubleStopCaught = true;
            console.log(`  ✅ Second stop correctly threw: "${e.message}"`);
        }
    }

    console.log(`  TEST 3 ${doubleStopCaught ? "PASSED ✅" : "FAILED ❌"}`);
}

// ─── Runner ──────────────────────────────────

async function main() {
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║   ScreenRecorder — Concurrency Test Suite    ║");
    console.log("╚══════════════════════════════════════════════╝");
    console.log(`Device: ${DEVICE_SERIAL}`);
    console.log(`Output: ${OUTPUT_DIR}\n`);

    await testSameInstanceConcurrency();
    await testMultipleInstances();
    await testDoubleStop();

    console.log("\n══════════════════════════════════════════════");
    console.log("All tests finished. Check results above.");
    console.log("══════════════════════════════════════════════\n");
}

main().catch(console.error);