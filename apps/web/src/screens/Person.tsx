// A person's page at /@handle (docs/design/person.html and
// person-private.html): their card, how I stand with them (Connect, a
// request either way, connected), then their week when they let me see it,
// or a lock that says nothing about it when they do not (no count, no days).
// Anyone may open it; a signed-out visitor gets no tab bar. The Open Graph
// tags for this path are the Worker's job (ADR 0005), not this.
//
// A share link carries ?invite=<token>, which connects at once (domain.md).
// The loader takes it out of the address bar before anything renders and
// holds it for this tab (invite.ts); a signed-out visitor keeps it through
// signing in and is brought back here to use it.
import type { AttendeeCard, MySchedule, Person as PersonFace, PersonEntry } from "@hallway/contracts";
import { useState, type ReactNode } from "react";
import { Link, replace, useLoaderData, useNavigate, useRevalidator, useSearchParams } from "react-router";
import { api, ApiFailure } from "../api/client.ts";
import { EVENT_ID } from "../event.ts";
import { handleFromSegment } from "../handle.ts";
import { dropInvite, heldInvite, holdInviteFrom } from "../invite.ts";
import { inSlot, parseSlot, slotMinutes } from "../schedule/calendar.ts";
import { EntryCell } from "../schedule/EntryCell.tsx";
import { firstName as firstWord } from "../schedule/going.ts";
import { WeekCalendar } from "../schedule/WeekCalendar.tsx";
import { WeekMap } from "../schedule/WeekMap.tsx";
import { useWeekView, WeekViewToggle } from "../schedule/WeekView.tsx";
import { useMe } from "../shell/AppLayout.tsx";
import { Avatar } from "../shell/Avatar.tsx";
import { Empty } from "../shell/Empty.tsx";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { ifSignedIn, signInPath } from "../shell/signed-in.ts";
import { eventDate, eventDates, formatDate, formatMinute, zoneAbbreviation } from "../time.ts";
import { NotFound } from "./NotFound.tsx";

/** How the viewer stands with this person. */
type Standing =
  | { kind: "signed-out"; invited: boolean }
  | { kind: "me" }
  | { kind: "connected" }
  | { kind: "asked-me"; requestId: string }
  | { kind: "i-asked"; requestId: string }
  /** Not connected, and the link that brought me here had their invite. */
  | { kind: "invited" }
  | { kind: "none" };

type Loaded =
  | { kind: "not-a-handle" }
  | { kind: "no-one"; handle: string }
  | { kind: "card"; card: AttendeeCard; standing: Standing; week: PersonEntry[] | null; mine: Set<string> };

export async function personLoader({ params, request }: { params: { segment?: string }; request: Request }): Promise<Loaded> {
  const handle = handleFromSegment(params.segment);
  if (handle === null) return { kind: "not-a-handle" };
  // The invite leaves the address bar first, replacing this history entry.
  const clean = holdInviteFrom(new URL(request.url), handle);
  if (clean !== null) throw replace(clean);

  const card = await api.attendee(handle).catch((failure: unknown) => {
    if (failure instanceof ApiFailure && (failure.kind === "not-found" || failure.kind === "invalid")) return null;
    throw failure;
  });
  if (!card) return { kind: "no-one", handle };

  const me = await ifSignedIn(api.me());
  if (!me) {
    const week = card.scheduleVisible ? (await api.personSchedule(card.handle, EVENT_ID)).entries : null;
    return { kind: "card", card, standing: { kind: "signed-out", invited: heldInvite(card.handle) !== null }, week, mine: new Set() };
  }
  if (me.id === card.id) {
    // My own page shows my week as others see it, from my own schedule.
    dropInvite();
    const mine = await api.mySchedule(EVENT_ID);
    return { kind: "card", card, standing: { kind: "me" }, week: mine.entries.filter((entry) => !entry.hidden), mine: new Set() };
  }

  const [connections, requests, week, mine] = await Promise.all([
    api.connections(),
    api.requests(),
    card.scheduleVisible ? api.personSchedule(card.handle, EVENT_ID).then((schedule) => schedule.entries) : null,
    api.mySchedule(EVENT_ID),
  ]);
  return { kind: "card", card, standing: standingWith(card, connections.connections.map((c) => c.person), requests), week, mine: sessionIds(mine) };
}

function standingWith(card: AttendeeCard, connected: PersonFace[], requests: Awaited<ReturnType<typeof api.requests>>): Standing {
  if (connected.some((person) => person.id === card.id)) {
    dropInvite();
    return { kind: "connected" };
  }
  const asked = requests.incoming.find((request) => request.from.id === card.id);
  if (asked) return { kind: "asked-me", requestId: asked.id };
  if (heldInvite(card.handle)) return { kind: "invited" };
  const sent = requests.outgoing.find((request) => request.to.id === card.id);
  if (sent) return { kind: "i-asked", requestId: sent.id };
  return { kind: "none" };
}

const sessionIds = (schedule: MySchedule) => new Set(schedule.entries.map((entry) => entry.sessionId));

export function Person() {
  const loaded = useLoaderData<typeof personLoader>();
  const me = useMe();
  // Back to where I came from (a session, someone's week); with no such
  // screen, Network, or for a signed-out visitor nothing (they have no tabs).
  const back = me ? { to: "/network", label: "Network" } : null;

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

  const { card, standing, week, mine } = loaded;
  return (
    <Screen title={card.displayName} large={false} back={back}>
      <Standing card={card} standing={standing}>
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
      </Standing>

      {week ? (
        <Week card={card} entries={week} mine={mine} own={standing.kind === "me"} me={me} />
      ) : (
        <Locked card={card} standing={standing} />
      )}
    </Screen>
  );
}

/** The card, and under it what I can do about how I stand with them. */
function Standing({ card, standing, children }: { card: AttendeeCard; standing: Standing; children: ReactNode }) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Failed | null>(null);
  const name = firstName(card);

  async function act(call: () => Promise<unknown>) {
    setBusy(true);
    setFailed(null);
    try {
      await call();
      await revalidator.revalidate();
    } catch (failure) {
      setFailed({ failure, retry: () => void act(call) });
    } finally {
      setBusy(false);
    }
  }

  async function connectWithInvite() {
    const token = heldInvite(card.handle);
    if (!token) return act(() => api.requestConnection(card.handle));
    setBusy(true);
    setFailed(null);
    try {
      await api.connectWithInvite(card.handle, token);
      dropInvite();
      await revalidator.revalidate();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.kind === "forbidden") {
        // They reset their invite since sharing this link. Say so in our own
        // words: the server's message is not shown, and the token never is.
        dropInvite();
        await revalidator.revalidate();
        setFailed({ failure: `This invite link no longer works: ${name} has reset it. You can still ask to connect.` });
      } else {
        setFailed({ failure, retry: () => void connectWithInvite() });
      }
    } finally {
      setBusy(false);
    }
  }

  function signInFirst() {
    // Back here once signed in (the sign-in's returnTo); the invite waits in this tab (invite.ts).
    void navigate(signInPath(`/@${card.handle}`));
  }

  let actions: ReactNode;
  let note: string | undefined;
  switch (standing.kind) {
    case "me":
      actions = (
        <Link className="btn gray" to="/settings/profile">
          Edit profile
        </Link>
      );
      break;
    case "signed-out":
      actions = (
        <button className="btn" type="button" onClick={signInFirst}>
          <Icon name="plus" />
          Sign in to connect
        </button>
      );
      note = standing.invited
        ? `${name} shared this link with you. Sign in and you connect in one tap.`
        : `Sign in to ask ${name} to connect.`;
      break;
    case "invited":
      actions = (
        <button className="btn" type="button" disabled={busy} onClick={connectWithInvite}>
          <Icon name="plus" />
          Connect
        </button>
      );
      note = `${name} shared this link with you, so you connect at once and see each other's weeks.`;
      break;
    case "none":
      actions = (
        <button className="btn" type="button" disabled={busy} onClick={() => act(() => api.requestConnection(card.handle))}>
          <Icon name="plus" />
          Connect
        </button>
      );
      note = `${name} gets your request and you connect once they accept.`;
      break;
    case "i-asked":
      actions = (
        <button className="btn gray" type="button" disabled={busy} onClick={() => act(() => api.withdrawRequest(standing.requestId))}>
          Withdraw request
        </button>
      );
      note = `You asked ${name} to connect. You connect once they accept.`;
      break;
    case "asked-me":
      actions = (
        <>
          <button className="btn" type="button" disabled={busy} onClick={() => act(() => api.acceptRequest(standing.requestId))}>
            Accept
          </button>
          <button className="btn gray" type="button" disabled={busy} onClick={() => act(() => api.declineRequest(standing.requestId))}>
            Decline
          </button>
        </>
      );
      note = `${name} asked to connect with you.`;
      break;
    case "connected":
      actions = (
        <button
          className="btn gray"
          type="button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Remove ${card.displayName} from your connections? You stop seeing each other's weeks, unless a week is public or the one who keeps it follows the other.`)) {
              void act(() => api.removeConnection(card.handle));
            }
          }}
        >
          <Icon name="check" />
          Connected
        </button>
      );
      note = `You and ${name} are connected. Tap to remove the connection.`;
      break;
  }

  return (
    <div className="section">
      <div className="group">
        {children}
        <div className="person-actions">{actions}</div>
      </div>
      <Foot failed={failed}>{note}</Foot>
    </div>
  );
}

interface WeekProps {
  card: AttendeeCard;
  entries: PersonEntry[];
  /** My session ids, to say "You're going too". */
  mine: Set<string>;
  own: boolean;
  me: { id: string; displayName: string; avatarUrl?: string | undefined } | null;
}

function Week({ card, entries, mine, own, me }: WeekProps) {
  const [search] = useSearchParams();
  const [view, setView] = useWeekView();
  const first =entries.find((entry) => entry.session.startsAt)?.session.startsAt;
  if (entries.length === 0) {
    return (
      <Empty icon="week" title="Nothing on this week yet">
        {own
          ? "Sessions you hide are not shown here: this is your week as others see it."
          : `${firstName(card)} has no sessions you can see yet. Their agent puts them here when it syncs.`}
      </Empty>
    );
  }
  const you = me && !own ? [{ id: me.id, handle: "", displayName: me.displayName, avatarUrl: me.avatarUrl }] : [];
  const cell = (entry: PersonEntry) => (
    <EntryCell
      key={entry.sessionId}
      session={entry.session}
      intent={entry.intent}
      going={you.length > 0 && mine.has(entry.sessionId) && <YouToo you={you} />}
    />
  );
  const note = (
    <p className="large-sub week-note">
      {entries.length === 1 ? "1 session" : `${entries.length} sessions`} · times are Las Vegas time
      {first && ` (${zoneAbbreviation(first)})`}
    </p>
  );
  const toggle = <WeekViewToggle view={view} onChange={setView} />;

  if (view === "calendar") {
    const dates = theirDates(entries);
    return (
      <>
        {note}
        <WeekCalendar
          entries={entries}
          dates={dates}
          going={(entry) => (you.length > 0 && mine.has(entry.sessionId) ? { short: "You", spoken: "you're going too" } : undefined)}
          cell={cell}
          toggle={toggle}
        />
      </>
    );
  }

  if (view === "map") {
    return (
      <>
        {note}
        <WeekMap entries={entries} dates={theirDates(entries)} toggle={toggle} cell={cell} />
      </>
    );
  }

  // A calendar slot's "+N more" opens the list at that half hour.
  const slotDay = search.get("day");
  const slot = parseSlot(search.get("at"));
  const listed = slot === null || !slotDay ? entries : entries.filter((entry) => inSlot(entry.session, slotDay, slot));
  const days = new Map<string, PersonEntry[]>();
  for (const entry of listed) {
    const key = entry.session.startsAt ? eventDate(entry.session.startsAt) : "later";
    days.set(key, [...(days.get(key) ?? []), entry]);
  }
  return (
    <>
      <div className="day-head">
        {note}
        {toggle}
      </div>
      {slot !== null && slotDay && (
        <p className="gfoot slot-note">
          On {formatDate(slotDay)} from {formatMinute(slot)} to {formatMinute(slot + slotMinutes)}.{" "}
          <Link to={{ search: "?view=list" }}>Show the whole week</Link>
        </p>
      )}
      {[...days].map(([date, dayEntries]) => (
        <section className="section" key={date}>
          <h2 className="ghead">{date === "later" ? "Time not announced yet" : formatDate(date)}</h2>
          <ul className="group">
            {dayEntries.map(cell)}
          </ul>
        </section>
      ))}
    </>
  );
}

/** Their days, first to last: the page has no event to read the week's dates from. */
function theirDates(entries: readonly PersonEntry[]): string[] {
  const dated = entries.flatMap((entry) => (entry.session.startsAt ? [eventDate(entry.session.startsAt)] : [])).sort();
  const [firstDay] = dated;
  const lastDay = dated.at(-1);
  return firstDay && lastDay ? eventDates(firstDay, lastDay) : [];
}

function YouToo({ you }: { you: PersonFace[] }) {
  return (
    <div className="going">
      <span className="stack" aria-hidden="true">
        {you.map((person) => (
          <Avatar key={person.id} person={person} size="sm" />
        ))}
      </span>
      <span>
        <b>You're going too</b>
      </span>
    </div>
  );
}

function Locked({ card, standing }: { card: AttendeeCard; standing: Standing }) {
  const name = firstName(card);
  const [title, text] =
    card.visibility === "private"
      ? [`${name} keeps their week private`, `Only ${name} sees their sessions.`]
      : [
          `${name}'s week is for their network`,
          standing.kind === "signed-out"
            ? `Sign in and connect with ${name} to see their sessions.`
            : standing.kind === "invited"
              ? `Connect and you will see their sessions.`
              : `Connect with ${name} and you will see their sessions once they accept.`,
        ];
  return (
    <section className="section">
      <div className="group">
        <div className="empty">
          <Icon name="lock" />
          <b>{title}</b>
          <p>{text}</p>
        </div>
      </div>
    </section>
  );
}

const firstName = (card: AttendeeCard) => firstWord(card.displayName);

