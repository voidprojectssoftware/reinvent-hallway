// Who goes in which group on Network (#113, mobile review finding 10). The
// four reads overlap: someone I follow on GitHub may also be in my LinkedIn
// file, have asked to connect, or be connected already. Each person shows
// once, in the strongest state they are in, so they never carry two actions
// that disagree (Connect beside a request waiting for my Accept). The order:
// they asked me, we are connected, I asked them, my LinkedIn file suggests
// them, I follow them. The ways I know them that the chosen group does not
// already say become the row's subtitle.
import type { ConnectionList, FollowedPerson, Following, RequestList, SuggestionList } from "@hallway/contracts";

/** A way I know someone besides a request or a connection. */
export type Source = "github" | "linkedin";

export interface NetworkRows {
  incoming: (RequestList["incoming"][number] & { known: Source[] })[];
  outgoing: RequestList["outgoing"];
  suggestions: (SuggestionList["suggestions"][number] & { known: Source[] })[];
  /** Those I follow on GitHub whom no group above holds, with `linkedin` when my file has them too. */
  github: (FollowedPerson & { known: Source[] })[];
  /** How many I follow on GitHub are in a group above instead. */
  githubElsewhere: number;
  /** Those I follow only from my LinkedIn file. */
  linkedin: FollowedPerson[];
}

export function networkRows(
  connections: ConnectionList,
  requests: RequestList,
  suggestions: SuggestionList,
  following: Following,
): NetworkRows {
  const onGitHub = new Set(following.github.people.map(({ person }) => person.id));
  const inFile = new Set([
    ...following.linkedinImport.people.map(({ person }) => person.id),
    ...suggestions.suggestions.map(({ person }) => person.id),
  ]);
  const known = (id: string): Source[] => [...(onGitHub.has(id) ? ["github" as const] : []), ...(inFile.has(id) ? ["linkedin" as const] : [])];

  const placed = new Set([
    ...requests.incoming.map((request) => request.from.id),
    ...connections.connections.map(({ person }) => person.id),
    ...requests.outgoing.map((request) => request.to.id),
  ]);
  const shownSuggestions = suggestions.suggestions.filter(({ person }) => !placed.has(person.id));
  for (const { person } of shownSuggestions) placed.add(person.id);
  const github = following.github.people.filter(({ person }) => !placed.has(person.id));
  for (const { person } of github) placed.add(person.id);

  return {
    incoming: requests.incoming.map((request) => ({ ...request, known: known(request.from.id) })),
    outgoing: requests.outgoing,
    suggestions: shownSuggestions.map((suggestion) => ({ ...suggestion, known: known(suggestion.person.id) })),
    github: github.map((followed) => ({ ...followed, known: known(followed.person.id) })),
    githubElsewhere: following.github.people.length - github.length,
    linkedin: following.linkedinImport.people.filter(({ person }) => !placed.has(person.id)),
  };
}

/** "Followed on GitHub and in your LinkedIn file", or null when there is nothing to say. */
export function knownFrom(sources: Source[]): string | null {
  const words = sources.map((source) => (source === "github" ? "followed on GitHub" : "in your LinkedIn file"));
  if (words.length === 0) return null;
  const said = words.join(" and ");
  return said[0]?.toUpperCase() + said.slice(1);
}
