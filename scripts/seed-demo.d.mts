// Types for scripts/seed-demo.mjs, for the test that runs it against the app
// (apps/api/src/seed-demo.test.ts).
export interface DemoPerson {
  name: string;
  favorites: string[];
  reserved: string[];
}
export interface SeededPerson {
  id: string;
  handle: string;
  name: string;
  cookie: string;
}
export declare const demoPeople: DemoPerson[];
export declare const demoConnections: [string, string][];
export declare function seedDemo(
  baseUrl: string,
  options?: { fetchFn?: (input: string, init?: RequestInit) => Promise<Response>; log?: (line: string) => void },
): Promise<Map<string, SeededPerson>>;
