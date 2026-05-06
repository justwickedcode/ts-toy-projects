# ScreenRecorder

Records Android screens over ADB and saves them as compressed, playable MP4 files.

---

## Why does it re-encode the video?

`adb screenrecord` is unreliable. On Android 16 it produces corrupt single-frame files whenever the screen isn't constantly changing, and even when it works the files are bloated — a 30s recording can easily be 80 MB.

After pulling the file from the device, ScreenRecorder runs it through ffmpeg locally. This fixes the container, makes it actually playable, and compresses it down to a reasonable size (usually 50–90% smaller).

You can skip this step by passing `ffmpegCrf: null` to `stopRecording()`, but you probably don't want to.

---

## Additional Dependencies

```bash
bun add ffmpeg-static
bun add -d @types/ffmpeg-static
```

---

## Usage

```ts
const recorder = new ScreenRecorder();

await recorder.startRecording({ quality: "low" });

// ... do stuff ...

const filePath = await recorder.stopRecording();
```

### Options

| Option | Default | Description |
|---|---|---|
| `quality` | `"low"` | `"low"` (2 Mbps) / `"medium"` (4 Mbps) / `"high"` (8 Mbps) |
| `outputPath` | `"./recordings"` | Where to save the file |
| `filename` | timestamp-based | Output filename |
| `timeLimitSeconds` | `180` | Hard cap — device stops recording after this |
| `ffmpegCrf` | `23` | Compression level (lower = bigger/better). Pass `null` to skip re-encoding |

### Why would I need this script?
> Could be used for automate testing reports with Appium, attached to a beforeTest or afterTest hook.