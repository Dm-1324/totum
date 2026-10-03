// Plain constants with no zod import, so the preload and renderer can use
// them without bundling the schemas.

/** Longest message text accepted at any process boundary, in UTF-16 code units. */
export const MAX_TEXT_LENGTH = 10_000;

/** The host's command-line argument carrying its database path: `--db=<path>`. */
export const HOST_DB_ARG = "--db=";
export const hostDbArg = (path: string): string => HOST_DB_ARG + path;

/** ui -> main request/reply channel; see chat.ts. */
export const CHAT_SEND = "chat.send";

/** main -> ui events and ui -> main request/reply channels for permissions, the log and grants; see ui.ts. */
export const PERMISSION_ASK = "permission.ask";
export const PERMISSION_CLOSED = "permission.closed";
export const PERMISSION_ANSWER = "permission.answer";
export const AUDIT_LIST = "audit.list";
export const AUDIT_UNDO = "audit.undo";
export const GRANTS_LIST = "grants.list";
export const GRANTS_REVOKE = "grants.revoke";

/**
 * main -> agent preload -> agent page: hands over the MessagePort that carries
 * MainToAgent / AgentToMain (see agent.ts). The handshake has no payload; the
 * port is the only thing transferred, and the page accepts only the first one.
 */
export const AGENT_PORT_CHANNEL = "agent.port";
