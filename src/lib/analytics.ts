import { differenceInCalendarDays, parseISO } from "date-fns";

// Pendo Track Events. The Pendo agent comes from its install snippet rather
// than the bundle, so these helpers no-op until `window.pendo` exists, and a
// tracking failure never interrupts the flow being measured.

/** Every Track Event the app sends. Names must match the Pendo track types exactly. */
export type TrackEventName =
  | "user_signed_up"
  | "sign_up_failed"
  | "user_signed_in"
  | "sign_in_failed"
  | "workspace_setup_completed"
  | "transaction_created"
  | "transaction_updated"
  | "transaction_deleted"
  | "transactions_searched"
  | "receipt_attached"
  | "receipt_upload_rejected"
  | "quick_add_transaction_created"
  | "quick_add_abandoned"
  | "budget_set"
  | "budget_cleared"
  | "budget_threshold_alert_triggered"
  | "savings_goal_created"
  | "savings_goal_updated"
  | "savings_goal_contribution_added"
  | "savings_goal_completed"
  | "savings_goal_deleted"
  | "workspace_settings_updated"
  | "category_created"
  | "category_updated"
  | "category_deleted"
  | "data_exported"
  | "data_imported"
  | "data_import_failed"
  | "insights_report_generated"
  | "usage_bot_run_completed";

type TrackValue = string | number | boolean | string[];

/** Null, undefined and non-finite values are dropped, so optional context can be passed inline. */
export type TrackProperties = Record<string, TrackValue | null | undefined>;

interface PendoAgent {
  track: (eventName: string, properties?: Record<string, TrackValue>) => void;
  identify: (options: { visitor: Record<string, TrackValue>; account?: Record<string, TrackValue> }) => void;
}

function getPendo(): PendoAgent | undefined {
  return (window as Window & { pendo?: PendoAgent }).pendo;
}

// Pendo limits the properties JSON to 512 bytes. Payloads are sized to fit, but
// long multi-byte text (e.g. a CJK or emoji category name) could overflow, so
// the largest string is halved until the payload fits.
const MAX_PROPERTIES_BYTES = 512;
const encoder = new TextEncoder();

function fitPropertiesLimit(payload: Record<string, TrackValue>): void {
  const byteLength = (value: string) => encoder.encode(value).length;
  while (byteLength(JSON.stringify({ properties: payload })) > MAX_PROPERTIES_BYTES) {
    const strings = Object.entries(payload).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 8
    );
    if (strings.length === 0) return;
    const [key, value] = strings.reduce((a, b) => (byteLength(b[1]) > byteLength(a[1]) ? b : a));
    payload[key] = value.slice(0, Math.ceil(value.length / 2));
  }
}

export function track(eventName: TrackEventName, properties: TrackProperties = {}): void {
  const pendo = getPendo();
  if (!pendo) return;
  const payload: Record<string, TrackValue> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    payload[key] = value;
  }
  try {
    fitPropertiesLimit(payload);
    pendo.track(eventName, payload);
  } catch (err) {
    console.warn(`[analytics] Failed to track "${eventName}"`, err);
  }
}

/**
 * Attributes subsequent events to a visitor (user id) and, once they have one,
 * an account (workspace id). Visitors driven by the internal Usage Bot are
 * flagged so their synthetic activity can be separated from real usage.
 */
export function identify(visitorId: string, accountId?: string): void {
  const pendo = getPendo();
  if (!pendo) return;
  try {
    pendo.identify({
      visitor: { id: visitorId, isUsageBot: isUsageBotSession() },
      ...(accountId ? { account: { id: accountId } } : {}),
    });
  } catch (err) {
    console.warn("[analytics] Failed to identify visitor", err);
  }
}

// The Usage Bot (/bot) drives the real app inside a same-origin iframe.
function isUsageBotSession(): boolean {
  try {
    return window.top !== window.self && window.top?.location.pathname === "/bot";
  } catch {
    return false; // Cross-origin parent, so not the bot.
  }
}

const trackedOnceKeys = new Set<string>();

/**
 * Tracks a one-time milestone at most once per key on this device. The
 * in-memory Set still dedupes for the session when storage is unavailable.
 */
export function trackOnce(onceKey: string, eventName: TrackEventName, properties?: TrackProperties): void {
  const storageKey = `expense_tracker_tracked:${eventName}:${onceKey}`;
  if (trackedOnceKeys.has(storageKey)) return;
  trackedOnceKeys.add(storageKey);
  try {
    if (localStorage.getItem(storageKey) !== null) return;
    localStorage.setItem(storageKey, "1");
  } catch {
    // Storage unavailable: the in-memory guard still applies.
  }
  track(eventName, properties);
}

/** Names of the given fields whose values differ between two versions of a record. */
export function changedFields<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[]
): string[] {
  return fields.filter((field) => before[field] !== after[field]);
}

/** A length-bounded error message for event properties. */
export function errorMessageOf(err: unknown, fallback: string): string {
  return (err instanceof Error ? err.message : fallback).slice(0, 100);
}

/** Rounds amounts and ratios to 2 decimals so float noise doesn't reach Pendo. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Whole calendar days since an ISO date or timestamp (negative if it's in the future). */
export function daysSince(isoDate: string): number {
  return differenceInCalendarDays(new Date(), parseISO(isoDate));
}

/** Whole calendar days until an ISO date or timestamp (negative if it has passed). */
export function daysUntil(isoDate: string): number {
  return differenceInCalendarDays(parseISO(isoDate), new Date());
}
