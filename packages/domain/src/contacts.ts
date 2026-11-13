import { parseCsv } from "./csv";
import { foldText } from "./sessions";
import type { Attendee, ImportedContact } from "./types";

/**
 * Case, accents and spacing only: `foldText` (NFKD, combining marks removed,
 * lowercased), runs of whitespace made one space. Nothing fuzzier, because a false match
 * shows someone a stranger.
 */
export function normalizeName(name: string): string {
  return foldText(name)
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * `linkedin.com/in/<lowercase-slug>` for any spelling of a LinkedIn profile
 * URL (scheme or none, www or a locale subdomain, trailing slash, query,
 * fragment, percent-encoding in either case), or undefined if it is not one.
 */
export function normalizeProfileUrl(raw: string): string | undefined {
  const text = raw.trim();
  if (text === "") return undefined;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "linkedin.com" && !host.endsWith(".linkedin.com")) return undefined;
  const match = /^\/in\/([^/]+)/.exec(url.pathname);
  if (!match) return undefined;
  let slug = match[1]!;
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // A malformed escape: compare the slug as written rather than drop the contact.
  }
  slug = slug.normalize("NFC").toLowerCase();
  return `linkedin.com/in/${slug}`;
}

/** SHA-256 hex of the trimmed, lowercased email. Web Crypto, so it runs in Workers and Node. */
export async function hashEmail(email: string): Promise<string> {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

const COLUMNS = {
  first: "first name",
  last: "last name",
  url: "url",
  email: "email address",
} as const;

export type ConnectionsCsvResult =
  | { ok: true; contacts: ImportedContact[] }
  | { ok: false; error: "no-header" };

/**
 * The reduced rows of a LinkedIn `Connections.csv` (domain.md "Imported
 * contact"). The export begins with a few lines of notes, so the header is
 * the first row that names First Name, Last Name and URL. Company, Position,
 * Connected On and the raw email are never read into the result: they are
 * data about people who never signed up. A row with neither a profile URL nor
 * an email can never match anyone and is dropped.
 */
export async function parseConnectionsCsv(text: string): Promise<ConnectionsCsvResult> {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => {
    const names = row.map((cell) => cell.trim().toLowerCase());
    return [COLUMNS.first, COLUMNS.last, COLUMNS.url].every((c) => names.includes(c));
  });
  if (headerIndex === -1) return { ok: false, error: "no-header" };

  const header = rows[headerIndex]!.map((cell) => cell.trim().toLowerCase());
  const column = (name: string) => header.indexOf(name);
  const [first, last, url, email] = [
    column(COLUMNS.first),
    column(COLUMNS.last),
    column(COLUMNS.url),
    column(COLUMNS.email),
  ];

  const contacts: ImportedContact[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    const cell = (index: number) => (index === -1 ? "" : (row[index] ?? "").trim());
    const profileUrl = normalizeProfileUrl(cell(url));
    const emailText = cell(email);
    if (profileUrl === undefined && emailText === "") continue;

    const contact: ImportedContact = { name: normalizeName(`${cell(first)} ${cell(last)}`) };
    if (profileUrl !== undefined) contact.profileUrl = profileUrl;
    if (emailText !== "") contact.emailSha256 = await hashEmail(emailText);
    contacts.push(contact);
  }
  return { ok: true, contacts };
}

/** What a suggestion needs to know about an attendee, the email already hashed. */
export interface SuggestionCandidate {
  attendee: Attendee;
  /** `hashEmail` of each verified email of the attendee's identities (ADR 0018: any of them matches). */
  verifiedEmailSha256s?: readonly string[];
}

export type SuggestionReason = "profile-and-name" | "email";

export interface Suggestion {
  attendee: Attendee;
  reason: SuggestionReason;
}

/**
 * Attendees my imported contacts point at (domain.md "Suggestions need two
 * matching facts"). A contact suggests an attendee when
 *   - its profile URL equals the attendee's claimed URL AND its name equals
 *     the name the attendee's first identity verified, or
 *   - its email hash equals the hash of a verified email of any of the
 *     attendee's identities.
 * The claimed URL alone never suffices: anyone can claim any URL. The email
 * suffices alone because both sides of it are facts the attendee cannot
 * choose: their provider verified theirs, and my contact's comes from LinkedIn.
 *
 * `exclude` holds the attendees not to suggest: me, and those I am already
 * connected to. One suggestion per attendee; an email match is reported in
 * preference to a profile match, as the stronger evidence.
 */
export function suggestions(
  contacts: readonly ImportedContact[],
  candidates: readonly SuggestionCandidate[],
  exclude: ReadonlySet<string> = new Set(),
): Suggestion[] {
  const byEmail = new Set<string>();
  const byProfile = new Set<string>();
  for (const contact of contacts) {
    if (contact.emailSha256) byEmail.add(contact.emailSha256);
    if (contact.profileUrl && contact.name) byProfile.add(`${contact.profileUrl}\n${contact.name}`);
  }

  const found: Suggestion[] = [];
  for (const { attendee, verifiedEmailSha256s } of candidates) {
    if (exclude.has(attendee.id)) continue;
    if (verifiedEmailSha256s?.some((hash) => byEmail.has(hash))) {
      found.push({ attendee, reason: "email" });
      continue;
    }
    const url = attendee.linkedinProfileUrl && normalizeProfileUrl(attendee.linkedinProfileUrl);
    const name = attendee.verifiedName && normalizeName(attendee.verifiedName);
    if (url && name && byProfile.has(`${url}\n${name}`)) {
      found.push({ attendee, reason: "profile-and-name" });
    }
  }
  return found;
}
