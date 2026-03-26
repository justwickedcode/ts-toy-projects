/// <reference types="codeceptjs" />

// These tests launch the Android Settings app directly via appPackage/appActivity —
// no APK download or signature verification needed. Works on any Android device.

Feature("Android Settings Navigation");

const SETTINGS_CAP = {
    appPackage: "com.android.settings",
    appActivity: ".Settings",
};

// ── Passing Tests ──────────────────────────────────────────────────────────

Scenario("Opens Settings and sees main list", async ({ I }) => {
    I.waitForElement(
        '//*[@text="Network & internet" or @text="Connections" or @text="Wi-Fi"]',
        15
    );
    I.see("Display");
});

Scenario("Navigates to Display settings and goes back", async ({ I }) => {
    I.waitForElement('//*[@text="Display"]', 15);
    I.tap('//*[@text="Display"]');
    I.waitForElement(
        '//*[@text="Brightness" or @text="Brightness level" or @text="Dark theme" or @text="Screen timeout"]',
        10
    );
    I.pressKey("Back");
    I.waitForElement('//*[@text="Display"]', 10);
});

Scenario("Scrolls through settings list", async ({ I }) => {

    I.waitForElement('//android.widget.ScrollView', 15);
    I.swipeUp('//android.widget.ScrollView', 500);
    I.swipeDown('//android.widget.ScrollView', 500);
});

Scenario("Navigates to About phone", async ({ I }) => {

    I.scrollTo('//*[@text="About phone" or @text="About emulator" or @text="About device"]', 5);
    I.tap('//*[@text="About phone" or @text="About emulator" or @text="About device"]');
    I.waitForElement('//*[@text="Model" or @text="Device name" or @text="Phone number"]', 10);
    I.pressKey("Back");
});

// ── Intentionally Failing Test ─────────────────────────────────────────────
// Fails on purpose to verify the recording gets attached to Allure.
// Passing tests above should NOT get recordings attached.

Scenario("INTENTIONAL FAIL — should attach recording to Allure", async ({ I }) => {

    I.waitForElement('//*[@text="Display"]', 15);
    I.tap('//*[@text="Display"]');
    I.waitForElement('//*[@text="ThisSettingDoesNotExist"]', 5);
});
