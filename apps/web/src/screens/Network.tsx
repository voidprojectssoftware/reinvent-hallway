// Network (docs/design/network.html): what needs an answer first (requests
// to me), then who to add (people from my LinkedIn connections), then the
// requests I sent, then who is already in, then the people I follow (GitHub,
// my LinkedIn import: ADR 0019). Each person shows once, in the strongest of
// those (network/rows.ts). Only mine, so a signed-out visitor is sent
// to sign in like the other tabs.
import type { ConnectionList, Following as FollowingList, Person, RequestList, SuggestionList } from "@hallway/contracts";
import { useState } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { api } from "../api/client.ts";
import { EVENT_ID } from "../event.ts";
import { ContactsImport } from "../network/ContactsImport.tsx";
import { sessionCounts } from "../network/counts.ts";
import { Following } from "../network/Following.tsx";
import { PersonRow } from "../network/PersonRow.tsx";
import { knownFrom, networkRows } from "../network/rows.ts";
import { Avatar } from "../shell/Avatar.tsx";
import { Empty } from "../shell/Empty.tsx";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";
import { eventDate, formatDate } from "../time.ts";

export async function networkLoader({
  request,
}: {
  request: Request;
}): Promise<{ connections: ConnectionList; requests: RequestList; suggestions: SuggestionList; following: FollowingList }> {
  const [connections, requests, suggestions, following] = await Promise.all([
    requireSignIn(api.connections(EVENT_ID), request),
    requireSignIn(api.requests(), request),
    requireSignIn(api.suggestions(), request),
    requireSignIn(api.following(EVENT_ID), request),
  ]);
  return { connections, requests, suggestions, following };
}

const personPath = (person: Person) => `/@${person.handle}`;

export function Network() {
  const { connections, requests, suggestions, following } = useLoaderData<typeof networkLoader>();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<(Failed & { where: string }) | null>(null);
  const [query, setQuery] = useState("");

  /** One action at a time, keyed by the row it came from so its refusal shows under its own group. */
  async function act(where: string, key: string, call: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await call();
      await revalidator.revalidate();
    } catch (failure) {
      setError({ where, failure, retry: () => void act(where, key, call) });
    } finally {
      setBusy(null);
    }
  }
  const errorIn = (where: string) => (error?.where === where ? error : null);

  const nothingYet =
    connections.connections.length === 0 &&
    requests.incoming.length === 0 &&
    requests.outgoing.length === 0 &&
    suggestions.suggestions.length === 0;
  const rows = networkRows(connections, requests, suggestions, following);
  const q = query.trim().toLowerCase();
  const shown = connections.connections.filter(
    ({ person }) => !q || person.displayName.toLowerCase().includes(q) || person.handle.toLowerCase().includes(q),
  );

  return (
    <Screen title="Network">
      {connections.connections.length > 0 && (
        <label className="search">
          <Icon name="search" />
          <span className="vh">Search your connections</span>
          <input type="search" placeholder="Search your connections" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      )}

      {requests.incoming.length > 0 && (
        <section className="section">
          <h2 className="ghead">
            Requests <span>{requests.incoming.length}</span>
          </h2>
          <ul className="group">
            {rows.incoming.map((request) => (
              <PersonRow
                key={request.id}
                person={request.from}
                lines={[request.from.headline, knownFrom(request.known)]}
                below
                actions={
                  <>
                    <button
                      className="minibtn filled"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => act("incoming", request.id, () => api.acceptRequest(request.id))}
                    >
                      Accept
                    </button>
                    <button
                      className="minibtn"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => act("incoming", request.id, () => api.declineRequest(request.id))}
                    >
                      Decline
                    </button>
                  </>
                }
              />
            ))}
          </ul>
          <Foot failed={errorIn("incoming")}>Accept and you see each other's weeks.</Foot>
        </section>
      )}

      {suggestions.contactImport ? (
        <section className="section">
          <h2 className="ghead">From your LinkedIn connections</h2>
          <ul className="group">
            {rows.suggestions.length === 0 ? (
              <li>
                <div className="cell">
                  <span className="cellmain cellsub">No one new from your file to add. People appear here as they join Hallway.</span>
                </div>
              </li>
            ) : (
              rows.suggestions.map(({ person, known }) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  // The heading already says LinkedIn; GitHub is news.
                  lines={[person.headline, known.length > 1 ? knownFrom(known) : null]}
                  actions={
                    <button
                      className="minibtn"
                      type="button"
                      disabled={busy !== null}
                      onClick={() => act("suggestions", person.id, () => api.requestConnection(person.handle))}
                    >
                      Connect
                    </button>
                  }
                />
              ))
            )}
          </ul>
          <Foot failed={errorIn("suggestions")}>
            People on Hallway whose LinkedIn profile and name, or email, match a row of the file you imported on{" "}
            {formatDate(eventDate(suggestions.contactImport.importedAt))}. <Link className="linkbtn" to="/settings">
              Import again
            </Link>
          </Foot>
        </section>
      ) : (
        <ContactsImport last={undefined} />
      )}

      {requests.outgoing.length > 0 && (
        <section className="section">
          <h2 className="ghead">
            Sent <span>{requests.outgoing.length}</span>
          </h2>
          <ul className="group">
            {requests.outgoing.map((request) => (
              <PersonRow
                key={request.id}
                person={request.to}
                lines={[request.to.headline]}
                actions={
                  <button
                    className="minibtn"
                    type="button"
                    disabled={busy !== null}
                    onClick={() => act("outgoing", request.id, () => api.withdrawRequest(request.id))}
                  >
                    Withdraw
                  </button>
                }
              />
            ))}
          </ul>
          <Foot failed={errorIn("outgoing")}>Waiting for them to accept.</Foot>
        </section>
      )}

      {nothingYet ? (
        <Empty icon="people" title="No connections yet">
          Share your invite link from My week, or open a colleague's Hallway link and connect.
        </Empty>
      ) : (
        connections.connections.length > 0 && (
          <section className="section">
            <h2 className="ghead">
              Connections <span>{connections.connections.length}</span>
            </h2>
            <ul className="group">
              {shown.length === 0 ? (
                <li>
                  <div className="cell">
                    <span className="cellmain cellsub">No connection matches "{query.trim()}".</span>
                  </div>
                </li>
              ) : (
                shown.map((connection) => (
                  <li key={connection.person.id}>
                    <Link className="cell lead-av" to={personPath(connection.person)}>
                      <Avatar person={connection.person} />
                      <div className="cellmain">
                        <span className="celltitle">{connection.person.displayName}</span>
                        <span className="cellsub">{sessionCounts(connection)}</span>
                      </div>
                      <Icon name="chev" className="chev" />
                    </Link>
                  </li>
                ))
              )}
            </ul>
          </section>
        )
      )}

      <Following
        github={rows.github}
        githubElsewhere={rows.githubElsewhere}
        linkedin={rows.linkedin}
        linked={following.github.linked}
        notOnHallway={following.github.notOnHallway}
      />
    </Screen>
  );
}
