---
name: ipc-message
description: Add or change a message between Totum processes (ui, main, agent, host). Use whenever a new IPC channel, request, reply or event is needed.
---

# Add an IPC message

Every message crossing a process boundary is defined once in `packages/shared`
and validated on receipt. No ad-hoc channels.

## 1. Decide the route

State: sender -> receiver, and whether it's a request/reply or a one-way event.
Allowed routes:

- ui <-> main (via the preload bridge only)
- main <-> agent (the MessagePort handed into the agent window; ADR 0004)
- main <-> host (utility process port)
- agent <-> host (capability requests and results, routed by main or a direct
  MessagePort that main sets up)

ui never talks to host or agent directly. If a route isn't listed, stop and ask.

## 2. Define it in `packages/shared/src/ipc/`

- A zod schema for the payload (and the reply, for request/reply).
- A stable message `type` string: `<area>.<verb>`, e.g. `task.start`,
  `capability.request`, `approval.ask`.
- Export the inferred TypeScript types. Add it to the union of messages for that route.

## 3. Wire both ends

- Sender builds the message from the schema's type.
- Receiver calls `schema.safeParse` and rejects invalid messages with a logged
  error; never trust the shape.
- For ui: expose one named, typed function in the preload (`window.totum.<name>`).
  Never expose a generic `send(channel, data)`.

## 4. Test

- A round-trip test in `packages/shared` that valid payloads parse and invalid
  ones are rejected.
- A test at the receiving end for the handler's behavior on a valid and an
  invalid message.

## 5. Check the one rule

The payload carries data and requests, never functions or handles that would
let agent or ui reach the OS.
