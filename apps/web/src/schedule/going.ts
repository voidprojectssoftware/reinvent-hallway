// Who from my network is going to a session, in the words my-week-share.html
// uses: up to three faces, then the names. One person by full name, two by
// full names, three or more by first names with "and N more".
import type { Person } from "@hallway/contracts";
import type { ApiClient } from "../api/client.ts";

/** The faces drawn before the names: three fit beside the text at 390. */
export const facesDrawn = 3;

/** The line after the faces: the names (drawn bold), then the rest as plain text. */
export function goingWords(people: readonly Pick<Person, "displayName">[], total = people.length): { names: string; rest: string } {
  const [first, second] = people;
  if (total === 0 || !first) return { names: "", rest: "No one you know yet" };
  if (total === 1) return { names: first.displayName, rest: "" };
  if (total === 2 && second) return { names: `${first.displayName} and ${second.displayName}`, rest: "" };
  const named = people.slice(0, facesDrawn).map((person) => firstName(person.displayName));
  const more = total - named.length;
  return { names: named.join(", "), rest: more > 0 ? ` and ${more} more` : "" };
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** The contract's limit on one who-is-going read. */
const idsPerRead = 200;

/** For each session asked, my connections going; a week over 200 sessions takes more than one read. */
export async function whoIsGoing(
  api: Pick<ApiClient, "whoIsGoing">,
  eventId: string,
  sessionIds: readonly string[],
): Promise<Map<string, Person[]>> {
  const chunks: string[][] = [];
  for (let i = 0; i < sessionIds.length; i += idsPerRead) chunks.push(sessionIds.slice(i, i + idsPerRead));
  const answers = await Promise.all(chunks.map((chunk) => api.whoIsGoing(eventId, chunk)));
  return new Map(answers.flatMap((answer) => answer.sessions.map((row) => [row.sessionId, row.people] as const)));
}
