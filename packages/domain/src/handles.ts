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

function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fit(base: string, suffix: string): string {
  return base.slice(0, MAX_LENGTH - suffix.length).replace(/-+$/, "") + suffix;
}

/**
 * A free handle for a new attendee, from their name: "Zoë O'Brien" gives
 * "zoe-o-brien", then "zoe-o-brien-2" and so on while taken. A name with no
 * Latin letters or digits after stripping accents gives "attendee", then
 * "attendee-2"; too short a name gets a number ("al-2").
 */
export function handleFromName(name: string, taken: ReadonlySet<string>): string {
  const base = slugify(name) || "attendee";
  const first = fit(base, "");
  if (isValidHandle(first) && !taken.has(first)) return first;
  for (let n = 2; ; n += 1) {
    const candidate = fit(base, `-${n}`);
    if (isValidHandle(candidate) && !taken.has(candidate)) return candidate;
  }
}
