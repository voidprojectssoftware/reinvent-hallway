// One session (docs/design/session.html): when, where, who speaks, the link
// to re:Invent, and its place on my week. Never an abstract (ADR 0003): the
// description is read on re:Invent, behind the one button. Anyone may open a
// session; the "On your week" part is for someone signed in.
import { goingFacesShown, type Person, type PlanEntry, type Session as SessionResource } from "@hallway/contracts";
import { useState } from "react";
import { Link, useLoaderData, useParams, useRevalidator } from "react-router";
import { api, ApiFailure } from "../api/client.ts";
import { EVENT_ID } from "../event.ts";
import { IntentBadge, sessionName } from "../schedule/EntryCell.tsx";
import { whoIsGoing } from "../schedule/going.ts";
import { Avatar } from "../shell/Avatar.tsx";
import { Empty } from "../shell/Empty.tsx";
import { Foot, failureText } from "../shell/Foot.tsx";
import { Icon, type IconName } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { ifSignedIn } from "../shell/signed-in.ts";
import { formatDay, formatTime, zoneAbbreviation } from "../time.ts";

type Loaded =
  | { found: false }
  | { found: true; session: SessionResource; signedIn: boolean; entry: PlanEntry | null; going: Person[] };

export async function sessionLoader({ params }: { params: { sessionId?: string } }): Promise<Loaded> {
  const sessionId = params.sessionId ?? "";
  const [session, schedule] = await Promise.all([
    api.session(EVENT_ID, sessionId).catch((failure: unknown) => {
      if (failure instanceof ApiFailure && failure.kind === "not-found") return null;
      throw failure;
    }),
    ifSignedIn(api.mySchedule(EVENT_ID)),
  ]);
  if (!session) return { found: false };
  // The session carries the first few of my connections going; when there
  // are more, who-is-going names them all.
  const shown = session.connectionsGoing;
  const going =
    shown && shown.count > goingFacesShown
      ? ((await whoIsGoing(api, EVENT_ID, [sessionId])).get(sessionId) ?? shown.people)
      : (shown?.people ?? []);
  return {
    found: true,
    session,
    signedIn: schedule !== null,
    entry: schedule?.entries.find((e) => e.sessionId === sessionId) ?? null,
    going,
  };
}

const back = { to: "/", label: "My week" };

export function Session() {
  const loaded = useLoaderData<typeof sessionLoader>();
  const { sessionId = "" } = useParams();
  if (!loaded.found) {
    return (
      <Screen title="Session" back={back}>
        <Empty icon="doc" title="No such session">
          Hallway has not seen session {sessionId}. A session appears here once someone's agent syncs it.
        </Empty>
      </Screen>
    );
  }
  const { session, signedIn, entry, going } = loaded;
  const sub = [session.code, session.type, session.level].filter(Boolean);

  return (
    <Screen
      title={sessionName(session)}
      navTitle={session.code ?? "Session"}
      long
      back={back}
      sub={
        sub.length > 0 &&
        sub.map((part, i) => (
          <span key={part}>
            {i > 0 && " · "}
            {part === session.code ? <span className="code">{part}</span> : part}
          </span>
        ))
      }
    >
      <Details session={session} />

      <section className="section">
        {session.url ? (
          <a className="btn block" href={session.url} target="_blank" rel="noopener">
            Open on re:Invent <Icon name="out" />
          </a>
        ) : null}
        <p className="gfoot">
          {session.url
            ? "The description, seats and reservations are on the re:Invent site."
            : "This session has no code yet, so there is no re:Invent link for it."}
        </p>
      </section>

      {signedIn ? (
        <OnMyWeek sessionId={session.sessionId} entry={entry} />
      ) : (
        <section className="section">
          <ul className="group">
            <li>
              <Link className="cell action lead" to="/sign-in">
                Sign in to add it to your week
              </Link>
            </li>
          </ul>
        </section>
      )}

      {signedIn && <ConnectionsGoing people={going} />}
    </Screen>
  );
}

function Details({ session }: { session: SessionResource }) {
  const rows: { icon: IconName; label: string; value: string }[] = [];
  if (session.startsAt) {
    rows.push({ icon: "clock", label: `When, Las Vegas time (${zoneAbbreviation(session.startsAt)})`, value: when(session) });
  }
  const place = [session.venue, session.room].filter(Boolean).join(", ");
  if (place) rows.push({ icon: "pin", label: "Where", value: place });
  if (session.speakers?.length) rows.push({ icon: "mic", label: "Speakers", value: session.speakers.join(", ") });
  if (session.topics?.length) rows.push({ icon: "tag", label: "Topics", value: session.topics.join(", ") });
  if (rows.length === 0) return null;

  return (
    <section className="section">
      <ul className="group">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="cell lead-ico">
              <span className="ico">
                <Icon name={row.icon} />
              </span>
              <div className="cellmain">
                <span className="info-k">{row.label}</span>
                <span className="info-v">{row.value}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Tuesday 1 December, 11:30 AM to 12:30 PM" */
function when(session: SessionResource): string {
  const start = session.startsAt ?? "";
  if (session.isAllDay) return `${formatDay(start)}, all day`;
  const end = session.endsAt ? ` to ${formatTime(session.endsAt)}` : "";
  return `${formatDay(start)}, ${formatTime(start)}${end}`;
}

function OnMyWeek({ sessionId, entry }: { sessionId: string; entry: PlanEntry | null }) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(call: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await call();
      await revalidator.revalidate();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!entry) {
    return (
      <section className="section">
        <h2 className="ghead">On your week</h2>
        <ul className="group">
          <li>
            <button className="cell action lead" type="button" disabled={busy} onClick={() => change(() => api.addToPlan(EVENT_ID, sessionId))}>
              Add to my week
            </button>
          </li>
        </ul>
        <Foot error={error}>It goes on your week as interested. Reserve a seat on re:Invent.</Foot>
      </section>
    );
  }

  const synced = entry.source === "agent-sync";
  return (
    <section className="section">
      <h2 className="ghead">On your week</h2>
      <ul className="group">
        <li>
          <div className="cell">
            <div className="cellmain">
              <span>{entry.intent === "reserved" ? "You have a seat" : "You are interested"}</span>
              <span className="cellsub">
                {entry.intent === "reserved" ? "Reserved on re:Invent" : synced ? "A favorite on re:Invent" : "Added on Hallway"}
                {synced ? ", synced by your agent" : ""}
              </span>
            </div>
            <IntentBadge intent={entry.intent} />
          </div>
        </li>
        <li>
          <label className="cell">
            <div className="cellmain">
              <span>Hide from others</span>
            </div>
            <input
              className="switch"
              type="checkbox"
              role="switch"
              checked={entry.hidden}
              disabled={busy}
              onChange={(e) => {
                const hidden = e.currentTarget.checked;
                void change(() => api.setEntryHidden(EVENT_ID, sessionId, hidden));
              }}
            />
          </label>
        </li>
        {!synced && (
          <li>
            <button className="cell action danger" type="button" disabled={busy} onClick={() => change(() => api.removeFromPlan(EVENT_ID, sessionId))}>
              Remove from my week
            </button>
          </li>
        )}
      </ul>
      <Foot error={error}>
        A hidden session stays on your week and calendar, and no one else sees it or counts it.
        {synced && " Your agent put it here: to remove it, drop it on re:Invent and sync again."}
      </Foot>
    </section>
  );
}

/** "Your connections going": a cell per person, linking to their week. */
function ConnectionsGoing({ people }: { people: Person[] }) {
  return (
    <section className="section">
      <h2 className="ghead">
        Your connections going <span>{people.length}</span>
      </h2>
      <ul className="group">
        {people.length === 0 ? (
          <li>
            <div className="cell">
              <span className="cellmain cellsub">None of your connections has this on their week yet.</span>
            </div>
          </li>
        ) : (
          people.map((person) => (
            <li key={person.id}>
              <Link className="cell lead-av" to={`/@${person.handle}`}>
                <Avatar person={person} />
                <div className="cellmain">
                  <span className="celltitle">{person.displayName}</span>
                  {person.headline && <span className="cellsub">{person.headline}</span>}
                </div>
                {/* TODO(#46): the design's Reserved or Interested badge per person needs their intent,
                    which who-is-going does not carry. */}
                <Icon name="chev" className="chev" />
              </Link>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
