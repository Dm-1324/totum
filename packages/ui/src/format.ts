import type { GrantLifetime, Scope, Tier } from "@totum/shared";

const TIERS: Record<Tier, string> = {
  0: "Tier 0 · only looks",
  1: "Tier 1 · can be undone",
  2: "Tier 2 · hard to undo",
  3: "Tier 3 · leaves this computer",
};

export const tierLabel = (tier: Tier): string => TIERS[tier];

export function scopeLabel(scope: Scope): string {
  switch (scope.kind) {
    case "folder":
      return `Folder ${scope.path}`;
    case "app":
      return `App ${scope.app}`;
    case "account":
      return `Account ${scope.account}`;
  }
}

export const lifetimeLabel = (lifetime: GrantLifetime): string =>
  lifetime === "always" ? "Always" : "This session";

/** Local date and time; the raw text if it isn't a date. */
export function timeLabel(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
