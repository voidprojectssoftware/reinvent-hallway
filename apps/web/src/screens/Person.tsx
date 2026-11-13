// A person's page at /@handle (docs/design/person.html and
// person-private.html): their card, then their week when they let me see it,
// or a lock that says nothing about it when they do not (no count, no days).
// Anyone may open it; a signed-out visitor gets no tab bar. The Open Graph
// tags for this path are the Worker's job (ADR 0005), not this.
import type { AttendeeCard, MySchedule, PlanEntry } from "@hallway/contracts";
import { Link, useLoaderData } from "react-router";
import { api, ApiFailure } from "../api/client.ts";
import { EVENT_ID } from "../event.ts";
import { handleFromSegment } from "../handle.ts";
import { EntryCell } from "../schedule/EntryCell.tsx";
import { useMe } from "../shell/AppLayout.tsx";
import { Avatar } from "../shell/Avatar.tsx";
import { Empty } from "../shell/Empty.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { ifSignedIn } from "../shell/signed-in.ts";
import { eventDate, formatDate, zoneAbbreviation } from "../time.ts";
import { NotFound } from "./NotFound.tsx";

type Loaded =
  | { kind: "not-a-handle" }
  | { kind: "no-one"; handle: string }
  | { kind: "card"; card: AttendeeCard; mine: MySchedule | null };

export async function personLoader({ params }: { params: { segment?: string } }): Promise<Loaded> {
  const handle = handleFromSegment(params.segment);
  if (handle === null) return { kind: "not-a-handle" };
  const card = await api.attendee(handle).catch((failure: unknown) => {
    if (failure instanceof ApiFailure && (failure.kind === "not-found" || failure.kind === "invalid")) return null;
    throw failure;
  });
  if (!card) return { kind: "no-one", handle };
  const me = await ifSignedIn(api.me());
  // My own page shows my week as others see it, from my own schedule.
  const mine = me?.id === card.id ? await api.mySchedule(EVENT_ID) : null;
  return { kind: "card", card, mine };
}

export function Person() {
  const loaded = useLoaderData<typeof personLoader>();
  const me = useMe();
  const back = me ? { to: "/network", label: "Network" } : undefined;

  if (loaded.kind === "not-a-handle") return <NotFound />;
  if (loaded.kind === "no-one") {
    return (
      <Screen title={`@${loaded.handle}`} back={back}>
        <Empty icon="people" title="No one here">
          No one on Hallway has the handle @{loaded.handle}. The link may be mistyped, or they changed it.
        </Empty>
      </Screen>
    );
  }

  const { card, mine } = loaded;
  return (
    <Screen title={card.displayName} large={false} back={back}>
      <div className="group">
        <div className="person">
          <Avatar person={card} size="lg" />
          <div className="cellmain">
            <h1>{card.displayName}</h1>
            {card.headline && <span className="cellsub">{card.headline}</span>}
            <span className="cellsub">
              @{card.handle}
              {card.linkedinProfileUrl && (
                <>
                  {" · "}
                  <a href={card.linkedinProfileUrl} target="_blank" rel="noopener">
                    LinkedIn profile
                  </a>
                </>
              )}
            </span>
          </div>
        </div>
        {mine && (
          <div className="person-actions">
            <Link className="btn gray" to="/settings/profile">
              Edit profile
            </Link>
          </div>
        )}
        {/* TODO(#33): Connect (via this share link) and the request state,
            for someone signed in who is not connected yet, from #15. */}
      </div>

      {mine ? (
        <Week entries={mine.entries.filter((entry) => !entry.hidden)} />
      ) : card.scheduleVisible ? (
        // TODO(#33): their week, from #15's GET /api/attendees/{handle}/schedule.
        <Empty icon="week" title={`${firstName(card)} shares their week with you`}>
          Their sessions will show here once Hallway can read other people's weeks.
        </Empty>
      ) : (
        <Locked card={card} signedIn={me !== null} />
      )}
    </Screen>
  );
}

function Week({ entries }: { entries: PlanEntry[] }) {
  const first = entries.find((entry) => entry.session.startsAt)?.session.startsAt;
  if (entries.length === 0) {
    return (
      <Empty icon="week" title="Nothing on this week yet">
        Sessions you hide are not shown here: this is your week as others see it.
      </Empty>
    );
  }
  const days = new Map<string, PlanEntry[]>();
  for (const entry of entries) {
    const key = entry.session.startsAt ? eventDate(entry.session.startsAt) : "later";
    days.set(key, [...(days.get(key) ?? []), entry]);
  }
  return (
    <>
      <p className="large-sub week-note">
        {entries.length === 1 ? "1 session" : `${entries.length} sessions`} · times are Las Vegas time
        {first && ` (${zoneAbbreviation(first)})`}
      </p>
      {[...days].map(([date, dayEntries]) => (
        <section className="section" key={date}>
          <h2 className="ghead">{date === "later" ? "Time not announced yet" : formatDate(date)}</h2>
          <ul className="group">
            {dayEntries.map((entry) => (
              <EntryCell key={entry.sessionId} session={entry.session} intent={entry.intent} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Locked({ card, signedIn }: { card: AttendeeCard; signedIn: boolean }) {
  const name = firstName(card);
  const [title, text] =
    card.visibility === "private"
      ? [`${name} keeps their week private`, `Only ${name} sees their sessions.`]
      : [
          `${name}'s week is for connections`,
          signedIn
            ? `Connect with ${name} and you will see their sessions once they accept.`
            : `Sign in and connect with ${name} to see their sessions once they accept.`,
        ];
  return (
    <section className="section">
      <div className="group">
        <div className="empty">
          <Icon name="lock" />
          <b>{title}</b>
          <p>{text}</p>
          {!signedIn && (
            <Link className="btn" to="/sign-in">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

const firstName = (card: AttendeeCard) => card.displayName.trim().split(/\s+/)[0] ?? card.displayName;
