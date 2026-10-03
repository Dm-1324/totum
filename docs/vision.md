# Totum: Product Vision

Source of truth for *what* Totum is. Exported from the planning doc on 2026-10-02.

## North star

**Totum is a personal AI layer that sees what you're doing, understands what you
want, and does the work across your computer, with you deciding what it is
allowed to touch.**

You talk to it by voice or text. It perceives the relevant context (screen,
active app, files, browser), plans multi-step tasks, and carries them out through
explicit capabilities. Every capability is granted by the user, and anything
risky waits for approval.

Desktop, browser and OS are not three products. They are one assistant gaining
deeper reach over time: the desktop app is the first body, the browser extension
adds eyes and hands on the web, and OS-level control lets it operate the machine.

**The test for every feature:** does it help Totum finish a real task the user
would otherwise do by hand? If it only makes the chat better, it is not the
priority.

The name comes from *factotum*, Latin for "do everything". (Formerly VisionOS;
renamed because of Apple's visionOS. Trademark check still pending.)

## First user and wedge

The first user is the builder: a developer on their own Windows desktop.

| Wedge task | Example | What it proves |
| --- | --- | --- |
| Diagnose what's on screen | "Why is this build failing?" Reads IDE, terminal, project files; explains the cause; proposes a fix | Perception and reasoning over real context |
| Find and act on files | "Find the resume PDF I edited last month and attach it to a draft for Rahul" | File search, app actions, approval before sending |
| Multi-step browser task (Stage 2) | "Compare these three laptop tabs; which has 16 GB RAM for the least money?" | Browser as sensor and actuator of the same core |

If Totum does these reliably, the architecture is proven.

## Non-goals for now

- Unrestricted control. No capability runs without an explicit grant.
- Autonomous background work while the user is away.
- Mobile and cross-device.
- Training or hosting its own models. Use model APIs; the value is the loop.
- A general chat app. Chat is the interface, not the product.
- Proactive suggestions.
- Third-party plugins (capability system stays internal until stable).

## Core loop

```
User (voice / text request)
  -> Perception      screen + active app, voice, files, browser pages
                     reads only what granted capabilities allow
  -> Reasoning       understands intent, plans steps    <-> Memory
                     REQUESTS capabilities, never acts
  -> Permission      checks grant + risk tier; asks user at tier 2/3;
                     writes every call to the audit log
  -> Action          most structured route first:
                     1 direct APIs, 2 browser DOM, 3 accessibility, 4 screen control
  -> Verified result, reported to user  -> next cycle
```

**The planner never calls the OS directly.** The permission layer is the only
path to the action layer. This one rule makes the safety model enforceable.

## Capability and permission model

Risk tier = can the action be undone, and does it leave the machine?

| Tier | Rule | Examples |
| --- | --- | --- |
| 0 Observe | Runs once granted; nothing changes | `screen.capture`, `context.active`, `files.read`, `mic.listen` |
| 1 Reversible local | Runs once granted; logged and undoable | `files.write` (with backup), `app.open`, `email.draft` |
| 2 Local, hard to undo | Asks every time, shows exact action | `files.delete`, `files.move`, `shell.execute` |
| 3 Leaves the machine | Asks every time, shows content being sent | `email.send`, `message.send`, `browser.submit`, `purchase` |

- **Grants** are scoped: capability + scope (folder, site, app) + lifetime (task, session, always).
- **Approvals** describe the action in plain words; user can approve, edit or reject. Approving once never makes tier 3 automatic.
- **Audit log** records every call: time, capability, scope, inputs, result, approver. Tier 1 entries carry an undo. Local and user-readable.

## Action routes

| Route | Speed / reliability | Use for |
| --- | --- | --- |
| 1 Direct APIs | Fast, exact | Files, shell, email, calendar, Git |
| 2 Browser extension (DOM) | Fast, real page structure | Reading, navigating, forms |
| 3 Windows UI Automation | Medium | Native app buttons and menus |
| 4 Screenshot + mouse/keyboard | Slow, brittle, universal | Last resort, always tier 2+ |

Every action is verified through the same route before success is reported.

## Roadmap (each stage ends at a gate, not a date)

| Stage | Adds | Exit gate |
| --- | --- | --- |
| 1 Desktop core (now) | Voice/text, screen + app context, planner, permissions, audit log, file tools | Wedge tasks 1 and 2 work daily, every action logged |
| 2 Browser reach | Extension feeding the same core; submit is tier 3 | Wedge task 3 works, no second assistant |
| 3 Computer agent | UI Automation, shell, app launch, screen control as last resort | A multi-app task runs end to end with only approvals |
| 4 Personal AI | Long-term memory, wake word, scheduled/background tasks | Trusted to act while the user is away |

Stages 2 to 4 reuse Stage 1's permission layer and audit log unchanged. If they
need to change it, Stage 1 was built wrong.
