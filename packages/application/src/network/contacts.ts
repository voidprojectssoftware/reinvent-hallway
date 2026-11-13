// ImportContacts and ListSuggestions (domain.md). LinkedIn will not give us a
// member's connections (ADR 0004), so the member uploads their own export and
// we keep three facts per row, enough to recognise an attendee and no more.
import type { ContactImport, ImportContactsInput, SuggestionList } from "@hallway/contracts";
import { parseConnectionsCsv, suggestions, type ImportedContact } from "@hallway/domain";
import type { Actor } from "../actor.ts";
import type { AttendeeRecord, AttendeeRepository } from "../identity/ports.ts";
import { signedInAttendee } from "../identity/profile.ts";
import { fail, ok, type Outcome } from "../outcome.ts";
import type { ContactImportRecord, NetworkRepository } from "./ports.ts";
import { byName, toPerson } from "./views.ts";

export type ImportContacts = (actor: Actor, input: ImportContactsInput) => Promise<Outcome<ContactImport>>;
export type ListSuggestions = (actor: Actor) => Promise<Outcome<SuggestionList>>;

export interface ContactPorts {
  attendees: AttendeeRepository;
  network: NetworkRepository;
  now: () => Date;
}

const contactImportResource = ({ importedAt, count }: ContactImportRecord): ContactImport => ({ importedAt, count });

/**
 * Reads the CSV into reduced rows (the domain drops every other column as it
 * parses), folds exact duplicates, and replaces my previous import with them.
 */
export function importContacts({ attendees, network, now }: ContactPorts): ImportContacts {
  return async (actor, { csv }) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const parsed = await parseConnectionsCsv(csv);
    if (!parsed.ok) {
      return fail(
        "invalid",
        "That is not LinkedIn's Connections.csv: no row names First Name, Last Name and URL. Upload the file from LinkedIn's data export unchanged.",
      );
    }
    const contacts = distinct(parsed.contacts);
    const record: ContactImportRecord = {
      id: crypto.randomUUID(),
      attendeeId: me.value.id,
      importedAt: now().toISOString(),
      count: contacts.length,
    };
    await network.replaceContacts(record, contacts);
    return ok(contactImportResource(record));
  };
}

/**
 * Attendees my contacts point at, by the domain's two-fact rule, leaving out
 * me, my connections, and anyone a request is pending with either way.
 */
export function listSuggestions({ attendees, network }: ContactPorts): ListSuggestions {
  return async (actor) => {
    const me = await signedInAttendee(attendees, actor);
    if (!me.ok) return me;
    const contactImport = await network.contactImport(me.value.id);
    if (!contactImport) return ok({ suggestions: [] });

    const [{ contacts, candidates }, linked] = await Promise.all([
      network.contactMatches(me.value.id),
      network.linkedTo(me.value.id),
    ]);
    const exclude = new Set([me.value.id, ...linked]);
    const found = suggestions(contacts, candidates, exclude).map(({ attendee, reason }) => ({
      person: toPerson(attendee as AttendeeRecord),
      reason,
    }));
    return ok({
      suggestions: found.sort((a, b) => byName(a.person, b.person)),
      contactImport: contactImportResource(contactImport),
    });
  };
}

function distinct(contacts: readonly ImportedContact[]): ImportedContact[] {
  const seen = new Map<string, ImportedContact>();
  for (const contact of contacts) {
    seen.set(JSON.stringify([contact.profileUrl ?? null, contact.name, contact.emailSha256 ?? null]), contact);
  }
  return [...seen.values()];
}
