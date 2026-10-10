// Global created by the Pendo install snippet in index.html.

interface PendoMetadata {
  id: string;
  [key: string]: string | number | boolean | string[];
}

interface PendoIdentity {
  visitor: PendoMetadata;
  account?: PendoMetadata;
}

interface Pendo {
  initialize: (options: PendoIdentity) => void;
  identify: (identity: PendoIdentity) => void;
  // The snippet only stubs initialize, identify, updateOptions, pageLoad, track
  // and trackAgent, so clearSession is undefined until the agent script has
  // loaded (or for good if it is blocked). Call it as `pendo.clearSession?.()`.
  clearSession?: () => void;
}

declare const pendo: Pendo;
