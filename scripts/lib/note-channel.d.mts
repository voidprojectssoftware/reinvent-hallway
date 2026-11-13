// Types for the part of scripts/lib/note-channel.mjs the AppHost uses
// (apphost.mts, ADR 0028).
export interface Channel {
  project: string;
  channel: string;
  main: boolean;
  root: string;
  mainRoot: string;
  port: number;
  storeDir: string;
  storeFile: string;
  serverFile: string;
  logFile: string;
  url: string;
}
export declare function channelFor(dir: string): Promise<Channel>;
