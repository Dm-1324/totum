# 0007: Failure results can be untrusted; refusals before host are audited; approval limits

- Date: 2026-11-17
- Status: accepted
- Milestone: 2 (close-out, after the boundary review)

## Context
The boundary review of M2 found gaps in the permission spine. Three of the fixes change the
capability contract or the IPC messages, so they are recorded here.

## Decision
- `Result` failures gain optional `untrusted`. A failure written by a capability may quote
  outside text, so the engine marks it `untrusted: true` unless the capability sets `false`.
  Host-written failures carry no flag. Main taints the agent on any result with
  `untrusted: true`, success or failure; the audit row records the flag.
- Calls refused before host (`no_task`, malformed, unknown id) get an audit row.
  New messages: agent -> main `capability.refused`; main -> host `audit.refusal`. Unknown ids
  are no longer dropped in the agent: host answers and audits them.
- Main ignores an approving answer that comes within 500 ms of the question appearing
  (new ui error `too_soon`); denying is always immediate.
- A task stops after 3 rejected or unanswered approvals (`approval_reject_limit`). Open
  approvals count against the limit, so parallel calls can't exceed it (`approval_busy`).

## Alternatives considered
- Taint on every failure whatever its source: rejected, host's own failures would taint.
- Guard only in the dialog: rejected, the renderer is not the place to enforce it.

## Consequences
Capability authors set `untrusted: false` on failures whose text they wrote themselves.
Remaining review items are in docs/progress.md under milestone 9.
