// Where the back button goes: the screen I came from, as iOS does, not a
// fixed parent. A person's week opened from a session goes back to that
// session; a session opened from a friend's week goes back to the friend.
//
// The router's history knows the order of entries but not what each one
// was, so each screen records its short title against its history entry's
// key, with the key of the entry it was opened from. The back button then
// names that screen and goes back one step in history, which is that screen.
// With no such entry (a link opened cold, a reload into a new tab) the
// screen's own parent is the fallback.
//
// Kept in this tab's sessionStorage so a reload keeps the way back, as the
// browser's own history does. Storage that refuses only loses that.

export type NavigationKind = "PUSH" | "REPLACE" | "POP";

export interface Visit {
  /** The screen's short title (Screen's navTitle). */
  title: string;
  /** The history key of the screen this one was opened from. */
  from?: string;
}

export type Visits = Record<string, Visit>;

/** The entry a screen reached by `kind` was opened from, given the screen shown just before. */
export function openedFrom(visits: Visits, key: string, kind: NavigationKind, shownBefore: string | null): string | undefined {
  const known = visits[key];
  if (known) return known.from;
  if (shownBefore === null || shownBefore === key) return undefined;
  // A push goes forward from the screen shown; a replace (the invite leaving
  // the address bar, sign-in landing) takes the place of that screen, and so
  // its way back.
  if (kind === "PUSH") return shownBefore;
  if (kind === "REPLACE") return visits[shownBefore]?.from;
  return undefined;
}

/** The back button's words for a screen titled `title`: its name when short, else "Back", as iOS shortens it. */
export function backLabel(title: string): string {
  return title.length <= 16 ? title : "Back";
}

const storageKey = "hallway.visits";
const kept = 100;

function load(): Visits {
  try {
    const text = window.sessionStorage.getItem(storageKey);
    return text ? (JSON.parse(text) as Visits) : {};
  } catch {
    return {};
  }
}

let visits: Visits | null = null;
let shownBefore: string | null = null;

const all = () => (visits ??= load());

/** The visit this screen came from, if it is one this tab saw. */
export function previousVisit(key: string, kind: NavigationKind): Visit | null {
  const from = openedFrom(all(), key, kind, shownBefore);
  return from === undefined ? null : (all()[from] ?? null);
}

/** Records the screen now shown, once it is on screen. */
export function recordVisit(key: string, kind: NavigationKind, title: string): void {
  const map = all();
  const from = openedFrom(map, key, kind, shownBefore);
  map[key] = from === undefined ? { title } : { title, from };
  shownBefore = key;
  const keys = Object.keys(map);
  for (const old of keys.slice(0, Math.max(0, keys.length - kept))) delete map[old];
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // Not kept past a reload: see the note at the top.
  }
}
