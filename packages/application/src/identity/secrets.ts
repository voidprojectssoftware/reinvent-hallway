// Random secrets and their hashes, with Web Crypto so the same code runs on
// Workers and under Node. Every secret Hallway hands out (session cookie,
// agent token, calendar feed, OAuth state) is 32 random bytes, base64url.
// Only the SHA-256 is stored, and lookups go by the hash of the whole secret:
// no prefix lookup followed by a compare, so there is no timing to leak.

export function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}
