import { client, xml } from "@xmpp/client";
import debug from "@xmpp/debug";

const xmpp = client({
    service: "xmpp://localhost:5222",
    domain: "localhost",
    username: "alice",
    password: "password123",
});

debug(xmpp, false);

xmpp.on("online", async () => {
    console.log("✅ ALICE online, sending message to Bob...");
    await xmpp.send(xml("presence")); // 👈 announce presence first

    await xmpp.send(
        xml("message", { to: "bob@localhost", type: "chat" },
            xml("body", {}, "Hello Bob! This is Alice. — Alice")
        )
    );
});

xmpp.on("stanza", (stanza) => {
    if (stanza.is("message") && stanza.attrs.type === "chat") {
        const body = stanza.getChildText("body");
        if (!body) return;
        console.log(`📨 ALICE received from ${stanza.attrs.from}: "${body}"`);
        process.exit(0);
    }
});

xmpp.on("error", (err) => console.error("❌ ALICE error:", err));

xmpp.start().catch(console.error);