// Settings (docs/design/settings.html): my card, who sees my week, the
// calendar feed, agent tokens, sign out. Token management and the feed are
// for a person signed in, never an agent token (ADR 0008); the web app is
// always the person, by its cookie.
import type { AgentToken, CalendarFeed, Me, Visibility } from "@hallway/contracts";
import { useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { api, ApiFailure } from "../api/client.ts";
import { copyText } from "../copy.ts";
import { Avatar } from "../shell/Avatar.tsx";
import { Foot, failureText } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";
import { formatAgo } from "../time.ts";

export async function settingsLoader(): Promise<{ me: Me; feed: CalendarFeed | null; tokens: AgentToken[] }> {
  const [me, feed, list] = await Promise.all([
    requireSignIn(api.me()),
    // A new attendee has no feed until the first rotate makes one (404).
    requireSignIn(api.calendarFeed()).catch((failure: unknown) => {
      if (failure instanceof ApiFailure && failure.kind === "not-found") return null;
      throw failure;
    }),
    requireSignIn(api.agentTokens()),
  ]);
  return { me, feed, tokens: list.tokens.filter((token) => !token.revokedAt) };
}

export function Settings() {
  const { me, feed, tokens } = useLoaderData<typeof settingsLoader>();
  return (
    <Screen title="Settings">
      <section className="section">
        <ul className="group">
          <li>
            <Link className="cell lead-av" to="/settings/profile">
              <Avatar person={me} />
              <div className="cellmain">
                <span className="celltitle">{me.displayName}</span>
                <span className="cellsub">
                  @{me.handle}
                  {me.headline && ` · ${me.headline}`}
                </span>
              </div>
              <Icon name="chev" className="chev" />
            </Link>
          </li>
        </ul>
      </section>

      <WhoCanSee visibility={me.visibility} />
      <CalendarLink feed={feed} />
      <Tokens tokens={tokens} />
      {/* TODO(#33): "LinkedIn connections", the Connections.csv import,
          needs #15's POST /api/me/contacts. */}
      <SignOut />
    </Screen>
  );
}

const choices: { value: Visibility; label: string; explain: string }[] = [
  { value: "public", label: "Anyone", explain: "Anyone with your link sees your sessions. Hidden sessions stay yours alone." },
  {
    value: "connections",
    label: "Connections",
    explain: 'Your connections see your sessions and you in "who is going". Hidden sessions stay yours alone.',
  },
  { value: "private", label: "Only me", explain: "No one else sees your sessions or counts you as going." },
];

function WhoCanSee({ visibility }: { visibility: Visibility }) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Visibility | null>(null);
  const shown = pending ?? visibility;

  async function choose(value: Visibility) {
    setPending(value);
    setError(null);
    try {
      await api.setVisibility(value);
      await revalidator.revalidate();
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="section">
      <h2 className="ghead" id="who-can-see">
        Who can see my week
      </h2>
      <div className="seg" role="group" aria-labelledby="who-can-see">
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={choice.value === shown}
            disabled={pending !== null}
            onClick={() => choose(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <Foot error={error}>{choices.find((choice) => choice.value === shown)?.explain}</Foot>
    </section>
  );
}

function CalendarLink({ feed }: { feed: CalendarFeed | null }) {
  const revalidator = useRevalidator();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = feed && new URL(feed.path, window.location.origin).toString();

  async function copy(link: string) {
    const copied = await copyText(link);
    setNote(copied ? "Copied" : null);
    setError(copied ? null : "This browser did not allow copying. Select the link above instead.");
  }

  // Rotating is also how the first link is made: there is nothing to break yet.
  async function rotate() {
    if (feed && !window.confirm("Reset your calendar link? Calendars subscribed to the old link stop updating.")) return;
    setError(null);
    try {
      await api.rotateCalendarFeed();
      await revalidator.revalidate();
      setNote(feed ? "New link made: subscribe again" : null);
    } catch (failure) {
      setError(failureText(failure));
    }
  }

  return (
    <section className="section">
      <h2 className="ghead">Calendar</h2>
      <ul className="group">
        {url ? (
          <>
            <li>
              <button className="cell lead-ico" type="button" onClick={() => copy(url)}>
                <span className="ico">
                  <Icon name="cal" />
                </span>
                <span className="cellmain">
                  <span>{note ?? "Copy calendar link"}</span>
                  <span className="cellsub url">{url}</span>
                </span>
                <Icon name="chev" className="chev" />
              </button>
            </li>
            <li>
              <button className="cell action danger" type="button" onClick={rotate}>
                Reset calendar link
              </button>
            </li>
          </>
        ) : (
          <li>
            <button className="cell lead-ico" type="button" onClick={rotate}>
              <span className="ico">
                <Icon name="cal" />
              </span>
              <span className="cellmain">Make a calendar link</span>
              <Icon name="chev" className="chev" />
            </button>
          </li>
        )}
      </ul>
      <Foot error={error}>
        Subscribe in Apple Calendar, Google or Outlook. Anyone with the link sees what it shows, so reset it if it gets out.
      </Foot>
    </section>
  );
}

function Tokens({ tokens }: { tokens: AgentToken[] }) {
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);

  async function revoke(token: AgentToken) {
    if (!window.confirm(`Revoke "${token.label}"? The agent using it loses access at once.`)) return;
    setError(null);
    try {
      await api.revokeAgentToken(token.id);
      await revalidator.revalidate();
    } catch (failure) {
      setError(failureText(failure));
    }
  }

  return (
    <section className="section">
      <h2 className="ghead">Agent tokens</h2>
      <ul className="group">
        {tokens.map((token) => (
          <li key={token.id}>
            <div className="cell lead-ico">
              <span className="ico gray">
                <Icon name="key" />
              </span>
              <div className="cellmain">
                <span>{token.label}</span>
                <span className="cellsub">
                  {token.prefix}… · {token.lastUsedAt ? `used ${formatAgo(token.lastUsedAt)}` : "never used"}
                </span>
              </div>
              <button className="minibtn" type="button" onClick={() => revoke(token)}>
                Revoke
              </button>
            </div>
          </li>
        ))}
        <li>
          <Link className="cell action lead" to="/connect">
            New token
          </Link>
        </li>
      </ul>
      <Foot error={error}>{tokens.length === 0 ? "No agent has a token yet." : undefined}</Foot>
    </section>
  );
}

function SignOut() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  async function signOut() {
    try {
      await api.signOut();
      await navigate("/sign-in");
    } catch (failure) {
      setError(failureText(failure));
    }
  }
  return (
    <section className="section">
      <ul className="group">
        <li>
          <button className="cell action danger" type="button" onClick={signOut}>
            Sign out
          </button>
        </li>
      </ul>
      <Foot error={error} />
    </section>
  );
}
