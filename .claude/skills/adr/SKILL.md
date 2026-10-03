---
name: adr
description: Record a Totum architecture decision (choosing a library, provider, storage format, protocol or approach, or changing the capability contract) as a numbered ADR in docs/decisions.
---

# Record a decision

When a choice is non-obvious or hard to reverse, write it down so future
sessions don't re-litigate it.

1. Find the next number: list `docs/decisions/` and add 1 (4 digits: `0007`).
2. Create `docs/decisions/NNNN-short-slug.md`:

```markdown
# NNNN: <decision in a few words>

- Date: YYYY-MM-DD
- Status: accepted | superseded by NNNN
- Milestone: <n>

## Context
<the problem and constraints, 2-4 sentences>

## Decision
<what we chose, 1-3 sentences>

## Alternatives considered
- <option>: <why not>

## Consequences
<what this makes easier, harder, or commits us to>
```

3. If it supersedes an older ADR, update the old one's status line.
4. If the decision is something every session must know (e.g. "use pnpm, not
   npm"), add one line to `CLAUDE.md` too.

Ask the user before recording a decision the plan docs left open to them
(model provider, speech provider, storage location).
