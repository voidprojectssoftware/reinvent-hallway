// The Web platform APIs the domain uses, declared here so the package can
// compile against plain ES2022 without the DOM lib or @types/node: all exist
// in Workers and in Node 22, and declaring only these keeps anything else
// (fetch, timers, node:*) from creeping into the rules.

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare const crypto: {
  readonly subtle: {
    digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
  };
};

declare class URL {
  constructor(url: string);
  readonly hostname: string;
  readonly pathname: string;
}
