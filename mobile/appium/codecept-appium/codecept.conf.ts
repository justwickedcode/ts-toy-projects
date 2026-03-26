import { setHeadlessWhen, setCommonPlugins } from "@codeceptjs/configure";

export const config: CodeceptJS.MainConfig = {
    tests: "./tests/**/*.test.ts",
    output: "./output",
    helpers: {
        Appium: {
            host: "localhost",
            port: 4723,
            path: "/",
            platform: "Android",
            desiredCapabilities: {
                platformName: "Android",
                automationName: "UiAutomator2",
                deviceName: "",
                // No app — tests run against whatever is already on screen
                autoGrantPermissions: true,
            },
        },
    },
    plugins: {
        screenshotOnFail: { enabled: false },
        screenRecorder: {
            // Our custom plugin — loaded from ./plugins/screenRecorder.ts
            require: "./plugins/screenRecorder",
            enabled: true,
            // Only attach recordings to Allure for failed tests
            attachOnFailOnly: true,
            outputPath: "./recordings",
        },
        allure: {
            enabled: true,
            require: "allure-codeceptjs",
            outputDir: "allure-results",
        },
    },
    include: {},
    name: "codecept-appium-recorder",
};
