// The composer's state outside React (ADR 0026): which part of my week the
// address says to share, what LinkedIn's round trip came back with, and the
// text kept while the browser is away at LinkedIn.

/** What to share. `sessions` with none chosen yet is a real state: the list is open, nothing is ticked. */
export type Pick = { kind: "week" } | { kind: "day"; day: string } | { kind: "sessions"; sessionIds: string[] };

/** The composer's address carries the selection, so a reload and LinkedIn's way back land on it. */
export function pickFrom(search: URLSearchParams): Pick {
  const day = search.get("day");
  if (day) return { kind: "day", day };
  const sessionIds = search.getAll("session");
  if (sessionIds.length > 0 || search.get("pick") === "sessions") return { kind: "sessions", sessionIds };
  return { kind: "week" };
}

/** The query for the composer's address, or, with `forApi`, for the draft (which has no "nothing picked"). */
export function searchOf(pick: Pick, forApi = false): string {
  const query = new URLSearchParams();
  if (pick.kind === "day") query.set("day", pick.day);
  if (pick.kind === "sessions") {
    for (const id of pick.sessionIds) query.append("session", id);
    if (pick.sessionIds.length === 0 && !forApi) query.set("pick", "sessions");
  }
  const search = query.toString();
  return search ? `?${search}` : "";
}

/** LinkedIn's share dialog for a link, which needs no LinkedIn app at all. */
export const linkedInShareUrl = (pageUrl: string) =>
  `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;

/** Where LinkedIn shows a post, from the URN Hallway came back with; null for anything that is not one. */
export function postUrlOf(urn: string | null): string | null {
  if (!urn || !/^urn:li:(share|ugcPost):\d+$/.test(urn)) return null;
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(urn)}/`;
}

/** Why a post did not go out, from the kind the callback sent back. Every one says nothing was posted, or how to check. */
export function notPostedText(kind: string): string {
  switch (kind) {
    case "forbidden":
      return "Nothing was posted: it took more than ten minutes, was started in another browser, or LinkedIn's account was not the one you linked. Try again.";
    case "unauthenticated":
      return "Nothing was posted: LinkedIn did not give Hallway permission. Try again, or use Open LinkedIn below.";
    case "invalid":
      return "Nothing was posted: those sessions are no longer on your week, or are hidden.";
    case "unavailable":
      return "LinkedIn did not finish. Check your LinkedIn feed before you try again, in case it went out.";
    default:
      return "Nothing was posted. Try again, or use Open LinkedIn below.";
  }
}

/**
 * The text I wrote, kept in this tab while the browser is at LinkedIn, so a
 * refusal brings me back to my words rather than the suggestion. Keyed by the
 * selection; gone once posted.
 */
const textKey = (pick: Pick) => `hallway.post-text${searchOf(pick)}`;

export const keptText = {
  save(pick: Pick, text: string) {
    try {
      sessionStorage.setItem(textKey(pick), text);
    } catch {
      // Storage refused (a private window): the suggestion comes back instead.
    }
  },
  read(pick: Pick): string | null {
    try {
      return sessionStorage.getItem(textKey(pick));
    } catch {
      return null;
    }
  },
  clear(pick: Pick) {
    try {
      sessionStorage.removeItem(textKey(pick));
    } catch {
      // Nothing kept to clear.
    }
  },
};
