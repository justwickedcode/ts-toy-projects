import { client, xml } from "@xmpp/client";
import debug from "@xmpp/debug";

const xmpp = client({
    service: "xmpp://localhost:5222",
    domain: "localhost",
    username: "bob",
    password: "password456",
});

debug(xmpp, false);

xmpp.on("online", async () => {
    console.log("✅ BOB online, waiting for messages...");
    await xmpp.send(xml("presence")); // 👈 this triggers offline message delivery
});

xmpp.on("stanza", (stanza) => {
    if (stanza.is("message") && stanza.attrs.type === "chat") {
        const body = stanza.getChildText("body");
        if (!body) return;
        console.log(`📨 BOB received from ${stanza.attrs.from}: "${body}"`);

        xmpp.send(
            xml("message", { to: "alice@localhost", type: "chat" },
                xml("body", {}, "Hey Alice! Got your message. — Bob")
            )
        );
    }
});

xmpp.on("error", (err) => console.error("❌ BOB error:", err));

xmpp.start().catch(console.error);