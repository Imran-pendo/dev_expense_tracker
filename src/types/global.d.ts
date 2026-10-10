// The Pendo agent, loaded by the install snippet in index.html. Only the parts
// of its API this app calls are declared.

type PendoMetadataValue = string | number | boolean | string[];

interface PendoMetadata {
  id: string;
  [field: string]: PendoMetadataValue;
}

interface PendoOptions {
  visitor: PendoMetadata;
  account?: PendoMetadata;
}

interface PendoAgent {
  initialize: (options: PendoOptions) => void;
  identify: (options: PendoOptions) => void;
  // The install snippet only queues initialize, identify, updateOptions,
  // pageLoad, track and trackAgent, so this is undefined until the agent
  // script has loaded, and stays undefined if the script is blocked.
  clearSession?: () => void;
}

declare global {
  var pendo: PendoAgent;
}

export {};
