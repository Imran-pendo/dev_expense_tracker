type TrackPropertyValue = string | number | boolean | null;

export type TrackProperties = Record<string, TrackPropertyValue>;

interface PendoAgent {
  track?: (eventName: string, properties?: TrackProperties) => void;
}

// Safe wrapper around the Pendo agent's track API. Call sites read like the
// Pendo docs (`pendo.track(...)`), but when the agent hasn't loaded (local dev,
// ad blockers, snippet not installed) the call is a no-op, and a failing
// analytics call can never break the user flow that triggered it.
export const pendo = {
  track(eventName: string, properties?: TrackProperties): void {
    try {
      (window as Window & { pendo?: PendoAgent }).pendo?.track?.(eventName, properties);
    } catch {
      // Analytics is best-effort.
    }
  },
};
