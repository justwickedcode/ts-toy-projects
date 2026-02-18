import xmpp from "simple-xmpp";

const DOMAIN = "localhost";

xmpp.on("online", () => {
    console.log("✅ BOB online, waiting for messages...");
});

xmpp.on("chat", (from: string, message: string) => {
    console.log(`📨 BOB received from ${from}: "${message}"`);
    xmpp.send(`alice@${DOMAIN}`, "Hey Alice! Got your message. — Bob");
});

xmpp.on("error", (err: Error) => {
    console.error("❌ BOB error:", err);
});

xmpp.connect({
    jid: `bob@${DOMAIN}`,
    password: "password456",
    host: DOMAIN,
    port: 5222,
});