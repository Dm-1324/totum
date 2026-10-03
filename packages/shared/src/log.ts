/**
 * Logger passed into process code so tests can capture what gets logged.
 * Never put untrusted payloads in `data`; log their shape or size instead.
 */
export type Log = (level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) => void;
