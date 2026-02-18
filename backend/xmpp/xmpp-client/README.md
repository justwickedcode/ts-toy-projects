# XMPP Client

A simple XMPP client demo using [ejabberd](https://www.ejabberd.im/) as the server, with two client implementations — a deprecated one for reference and a modern one using `@xmpp/client`.

---

## Server Setup (Docker)

The server runs as a Docker container using ejabberd.

```shell
# Start the server
docker compose up -d
```

Once the server is up, register two users:

```shell
# Format: docker exec ejabberd ejabberdctl register <username> <domain> <password>
docker exec ejabberd ejabberdctl register alice localhost password123
docker exec ejabberd ejabberdctl register bob localhost password456
```

Verify and check status:

```shell
# List registered users
docker exec ejabberd ejabberdctl registered_users localhost

# Check server status
docker exec ejabberd ejabberdctl status
```

---

## How XMPP Works (briefly)

XMPP is a protocol for real-time messaging. A few things worth knowing:

- Every user has a **JID** (Jabber ID) in the format `user@domain` (e.g. `alice@localhost`)
- After connecting and authenticating, a client must send a **`<presence/>`** stanza to be considered online. Without it, the server queues messages as offline and never delivers them to the client.
- Messages are XML **stanzas** sent over a persistent TCP connection.

---

## Implementation 1 — `simple-xmpp` (Deprecated, not recommended)

> **Warning:** [`simple-xmpp`](https://www.npmjs.com/package/simple-xmpp) is deprecated and unmaintained. It has no TypeScript types and uses a singleton pattern that prevents running two clients in the same process. It's included here only as a reference.

Located at `/src/simple-xmpp/`.

Open two terminals and run:

```shell
# Terminal 1 — Bob first (he needs to be online to receive)
bun run src/simple-xmpp/bob.ts

# Terminal 2 — then Alice
bun run src/simple-xmpp/alice.ts
```

---

## Implementation 2 — `@xmpp/client` (Recommended)

> The modern, actively maintained XMPP library. TypeScript-native, promise-based, and explicit about stanza construction via `xml()`.

Located at `/src/@xmpp-client/`.

```shell
npm install @xmpp/client @xmpp/debug
```

Open two terminals and run:

```shell
# Terminal 1 — Bob first, wait until you see "✅ BOB online"
bun run src/@xmpp-client/bob.ts

# Terminal 2 — then Alice
bun run src/@xmpp-client/alice.ts
```

### Why Bob must start first

Alice sends a message immediately on connect. If Bob isn't online yet, ejabberd stores it as an **offline message**. Bob will only receive it when he comes online **and** sends a `<presence/>` stanza. To keep the demo simple and deterministic, just start Bob first.

### The presence gotcha

This is the most common mistake when starting with XMPP. After authentication, a client is connected but **unavailable**. Sending `<presence/>` is what tells the server "I'm here, deliver my messages":

```typescript
xmpp.on("online", async () => {
  await xmpp.send(xml("presence")); // without this, messages won't be delivered
});
```

### Expected output

```
# Terminal 1 (Bob)
✅ BOB online, waiting for messages...
📨 BOB received from alice@localhost: "Hello Bob! This is Alice. — Alice"

# Terminal 2 (Alice)
✅ ALICE online, sending message to Bob...
📨 ALICE received from bob@localhost: "Hey Alice! Got your message. — Bob"
```

---

## Key differences between the two implementations

| | `simple-xmpp` | `@xmpp/client` |
|---|---|---|
| Maintained | ❌ Deprecated | ✅ Active |
| TypeScript types | ❌ None | ✅ Built-in |
| Two clients in one process | ❌ Singleton | ✅ Multiple instances |
| API style | Callback | Promise + EventEmitter |
| Stanza construction | Magic strings | Explicit `xml()` builder |
| WebSocket support | ❌ | ✅ |