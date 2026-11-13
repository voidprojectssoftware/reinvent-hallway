// A handle is the share URL `/@handle`: 3 to 30 of a-z, 0-9 and single
// hyphens, starting and ending with a letter or digit. ASCII only, so a share
// link reads the same everywhere it is pasted.

const MAX_LENGTH = 30;
const VALID = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;

/** What the user typed, as a handle would be stored: trimmed, no leading "@", lowercase. */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

export function isValidHandle(handle: string): boolean {
  return VALID.test(handle);
}

// Words no attendee may hold, because they name, or may one day name, one of
// Hallway's own paths, or would pass for Hallway speaking. Share URLs are
// `/@handle`, so none collides today; the list keeps `@api` or `@settings`
// from reading as part of the product.
const RESERVED: ReadonlySet<string> = new Set([
  "about", "account", "admin", "administrator", "api", "app", "assets", "auth",
  "cal", "calendar", "connect", "connections", "dev", "events", "feed", "hallway",
  "help", "login", "logout", "mcp", "network", "null", "official", "privacy",
  "profile", "reinvent", "root", "security", "sessions", "settings", "share",
  "sign-in", "sign-out", "signin", "signout", "static", "support", "system",
  "terms", "tokens", "undefined", "user", "users", "www",
]);

export function isReservedHandle(handle: string): boolean {
  return RESERVED.has(handle);
}

// Latin letters NFKD does not split into a base letter and a mark, spelled
// the way their own languages spell them in ASCII.
const BASE_LETTERS: Readonly<Record<string, string>> = {
  "ł": "l", "ø": "o", "đ": "d", "ð": "d", "ı": "i",
  "ß": "ss", "æ": "ae", "œ": "oe", "þ": "th",
};

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[łøđðıßæœþ]/g, (letter) => BASE_LETTERS[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fit(base: string, suffix: string): string {
  return base.slice(0, MAX_LENGTH - suffix.length).replace(/-+$/, "") + suffix;
}

function isFree(handle: string, taken: ReadonlySet<string>): boolean {
  return isValidHandle(handle) && !taken.has(handle) && !RESERVED.has(handle);
}

/**
 * A free handle for a new attendee, from their name: "Zoë O'Brien" gives
 * "zoe-o-brien", "Łukasz Kowalski" "lukasz-kowalski", then "-2" and so on
 * while taken. Too short a name gets a number ("al-2"); a reserved word
 * counts as taken, so "Admin" gives "admin-2". `undefined` when the name has
 * no Latin letter to make a handle from (Cyrillic, Greek, CJK and the like):
 * the caller gives a `placeholderHandle` instead.
 */
export function handleFromName(name: string, taken: ReadonlySet<string>): string | undefined {
  const base = slugify(name);
  if (!/[a-z]/.test(base)) return undefined;
  const first = fit(base, "");
  if (isFree(first, taken)) return first;
  for (let n = 2; ; n += 1) {
    const candidate = fit(base, `-${n}`);
    if (isFree(candidate, taken)) return candidate;
  }
}

const PLACEHOLDER_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/**
 * "attendee-" and four characters picked by `randomBytes` (one byte each,
 * 1.7 million handles). Random, never a count, which would tell anyone
 * reading a share link how many people have signed up. The modulo leans
 * a little toward the first few characters; a handle needs to be hard to
 * predict in bulk, not uniform.
 */
export function placeholderHandle(randomBytes: Uint8Array): string {
  const picked = Array.from(randomBytes.subarray(0, 4), (byte) => PLACEHOLDER_ALPHABET[byte % PLACEHOLDER_ALPHABET.length]);
  return `attendee-${picked.join("")}`;
}
