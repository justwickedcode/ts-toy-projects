# appium-with-docker

Runs Appium in Docker on Windows with a real physical Android device connected via USB.

---

## How it works

The tricky part with Docker on Windows is that USB doesn't pass through to containers. The container can't see your device directly — so instead, Appium talks to the ADB server running on your Windows host via `host.docker.internal`.

The key capability that makes this work is `appium:remoteAdbHost`. It tells UiAutomator2 to create the port forward on the host machine instead of inside the container, which is where it actually needs to be.

---

## Setup

Make sure your device is connected and visible:

```bash
adb devices
```

Start the container:

```bash
docker compose up -d
```

---

## Connecting with Appium Inspector

Download Appium Inspector here: https://github.com/appium/appium-inspector

Connection settings:
- **Remote Host**: `localhost`
- **Remote Port**: `4723`
- **Remote Path**: `/`

Capabilities:
```json
{
  "platformName": "Android",
  "appium:automationName": "UiAutomator2",
  "appium:remoteAdbHost": "host.docker.internal"
}
```

---

## Customizing

The `docker-compose.yml` `entrypoint` controls what flags Appium starts with. Edit it to allow whichever insecure features you need:

```yaml
entrypoint: ["appium", "--allow-insecure=*:adb_shell,*:session_discovery", "--allow-cors"]
```

Common flags:
- `*:adb_shell` — allows executing shell commands on the device
- `*:session_discovery` — allows listing active sessions in Appium Inspector
- `--allow-cors` — allows connections from any host (needed for Appium Inspector)
- `--relaxed-security` — enables all insecure features at once (not recommended in shared environments)
- 