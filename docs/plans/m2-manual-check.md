# M2 manual check (slice 7, step 1)

Run from the repo root in PowerShell: `pnpm dev`. Agent code changes need an app
restart. Use the Chat view. `/call <capability id> <json input>` is dev-only.
Test capabilities: `test.echo` (tier 0, output untrusted), `test.note` (tier 1,
undoable), `test.danger` (tier 2, clears notes), `test.send` (tier 3).

1. **Tier 0 / grant ask.** `/call test.echo {"text":"hi"}`.
   Expect either a grant dialog ("Allow test.echo?", "Don't allow" focused) or, if
   already granted, the reply `test.echo: ok, untrusted output (shown as data)`.
   Choose "Allow (this task)". Expect the reply, then a Log entry.
2. **Tier 1 + undo.** `/call test.note {"text":"buy milk"}`.
   Expect a grant ask (taint from step 1 means it may ask even if granted:
   that's the known taint behaviour). Allow. Expect `{ "noteId": 1 }`.
   Log view: click Undo on that entry; expect success. Click Undo again: expect a
   refusal (`changed_since`: already gone).
3. **Tier 2 blocks until approved.** Add a note again, then
   `/call test.danger {}`.
   Expect an approval dialog "Run test.danger?" with the exact action text
   ("Delete all N notes ... can't be undone"), the chat reply *not yet shown*.
   Confirm "Reject" has focus.
4. **Enter rejects.** Press Enter on the dialog. Expect the call to fail with a
   denial (not run); `test.note`s still there; Log shows the rejected call.
5. **Wait > 10 s.** Repeat step 3 and do nothing for 15+ seconds. Expect the dialog
   to stay open and chat NOT to show `agent_timeout` (the timeout is held while
   a permission ask is open). Then click Approve: expect `{ "cleared": N }`.
6. **Esc rejects.** Repeat step 3, press Esc. Expect a denial.
7. **Tier 3.** `/call test.send {"to":"a@example.com","body":"hi"}`.
   Expect an approval dialog naming the sending account `totum-test-outbox`
   and the recipient, every time (no "always" offered). Reject it.
8. **Log + grants.** Log view shows every call above, including the rejected ones.
   Grants view lists what you allowed; Revoke one and `/call` it again: it must ask.

Report: which steps pass, and anything that differs from "Expect".
