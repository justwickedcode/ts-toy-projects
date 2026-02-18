import xmpp from "simple-xmpp";

const DOMAIN = "localhost";

xmpp.on("online", () => {
    console.log("✅ ALICE online, sending message to Bob...");
    xmpp.send(`bob@${DOMAIN}`, "Hello Bob! This is Alice. — Alice");
});

xmpp.on("chat", (from: string, message: string) => {
    console.log(`📨 ALICE received from ${from}: "${message}"`);
    process.exit(0);
});

xmpp.on("error", (err: Error) => {
    console.error("❌ ALICE error:", err);
});

xmpp.connect({
    jid: `alice@${DOMAIN}`,
    password: "password123",
    host: DOMAIN,
    port: 5222,
});