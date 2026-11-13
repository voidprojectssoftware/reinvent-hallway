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
import { Link, replace, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { api, ApiFailure } from "../api/client.ts";
import { EVENT_ID } from "../event.ts";
import { handleFromSegment } from "../handle.ts";
import { dropInvite, heldInvite, holdInviteFrom } from "../invite.ts";
import { EntryCell } from "../schedule/EntryCell.tsx";
import { firstName as firstWord } from "../schedule/going.ts";
import { useMe } from "../shell/AppLayout.tsx";
import { Avatar } from "../shell/Avatar.tsx";
import { Empty } from "../shell/Empty.tsx";
import { Foot, failureText } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { ifSignedIn, signInPath } from "../shell/signed-in.ts";
import { eventDate, formatDate, zoneAbbreviation } from "../time.ts";
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
  const [error, setError] = useState<string | null>(null);
  const name = firstName(card);

  async function act(call: () => Promise<unknown>) {
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

  async function connectWithInvite() {
    const token = heldInvite(card.handle);
    if (!token) return act(() => api.requestConnection(card.handle));
    setBusy(true);
    setError(null);
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
        setError(`This invite link no longer works: ${name} has reset it. You can still ask to connect.`);
      } else {
        setError(failureText(failure));
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
            if (window.confirm(`Remove ${card.displayName} from your connections? Neither of you sees the other's connections-only week after this.`)) {
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
      <Foot error={error}>{note}</Foot>
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
  const first = entries.find((entry) => entry.session.startsAt)?.session.startsAt;
  if (entries.length === 0) {
    return (
      <Empty icon="week" title="Nothing on this week yet">
        {own
          ? "Sessions you hide are not shown here: this is your week as others see it."
          : `${firstName(card)} has no sessions you can see yet. Their agent puts them here when it syncs.`}
      </Empty>
    );
  }
  const days = new Map<string, PersonEntry[]>();
  for (const entry of entries) {
    const key = entry.session.startsAt ? eventDate(entry.session.startsAt) : "later";
    days.set(key, [...(days.get(key) ?? []), entry]);
  }
  const you = me && !own ? [{ id: me.id, handle: "", displayName: me.displayName, avatarUrl: me.avatarUrl }] : [];
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
              <EntryCell
                key={entry.sessionId}
                session={entry.session}
                intent={entry.intent}
                going={you.length > 0 && mine.has(entry.sessionId) && <YouToo you={you} />}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
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
          `${name}'s week is for connections`,
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

