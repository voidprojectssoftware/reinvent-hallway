// Settings (docs/design/settings.html): my card, who sees my week, the
// calendar feed, agent tokens, the providers I sign in with, sign out. Token management and the feed are
// for a person signed in, never an agent token (ADR 0008); the web app is
// always the person, by its cookie.
import type { AgentToken, CalendarFeed, ContactImport, Identity, Me, SignInProvider } from "@hallway/contracts";
import { useState } from "react";
import { Link, useLoaderData, useNavigate, useRevalidator } from "react-router";
import { api, ApiFailure } from "../api/client.ts";
import { copyText } from "../copy.ts";
import { ContactsImport } from "../network/ContactsImport.tsx";
import { SignInMethods } from "../settings/SignInMethods.tsx";
import { WhoCanSee } from "../settings/WhoCanSee.tsx";
import { Avatar } from "../shell/Avatar.tsx";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";
import { formatAgo } from "../time.ts";

export async function settingsLoader({ request }: { request: Request }): Promise<{
  me: Me;
  feed: CalendarFeed | null;
  tokens: AgentToken[];
  contactImport: ContactImport | undefined;
  identities: Identity[];
  offered: SignInProvider[];
}> {
  const [me, feed, list, suggestions, identities, options] = await Promise.all([
    requireSignIn(api.me(), request),
    // A new attendee has no feed until the first rotate makes one (404).
    requireSignIn(api.calendarFeed(), request).catch((failure: unknown) => {
      if (failure instanceof ApiFailure && failure.kind === "not-found") return null;
      throw failure;
    }),
    requireSignIn(api.agentTokens(), request),
    requireSignIn(api.suggestions(), request),
    requireSignIn(api.identities(), request),
    // Without the options, Settings still lists what I have; it offers no Add.
    api.signInOptions().catch(() => null),
  ]);
  return {
    me,
    feed,
    tokens: list.tokens.filter((token) => !token.revokedAt),
    contactImport: suggestions.contactImport,
    identities: identities.identities,
    offered: options?.providers ?? [],
  };
}

export function Settings() {
  const { me, feed, tokens, contactImport, identities, offered } = useLoaderData<typeof settingsLoader>();
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
      <SignInMethods identities={identities} offered={offered} />
      <ContactsImport last={contactImport} />
      <SignOut />
    </Screen>
  );
}

function CalendarLink({ feed }: { feed: CalendarFeed | null }) {
  const revalidator = useRevalidator();
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const url = feed && new URL(feed.path, window.location.origin).toString();

  async function copy(link: string) {
    const copied = await copyText(link);
    setNote(copied ? "Copied" : null);
    setFailed(copied ? null : { failure: "This browser did not allow copying. Select the link above instead." });
  }

  // Rotating is also how the first link is made: there is nothing to break yet.
  async function rotate() {
    if (feed && !window.confirm("Reset your calendar link? Calendars subscribed to the old link stop updating.")) return;
    setFailed(null);
    try {
      await api.rotateCalendarFeed();
      await revalidator.revalidate();
      setNote(feed ? "New link made: subscribe again" : null);
    } catch (failure) {
      setFailed({ failure });
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
      <Foot failed={failed}>
        Subscribe in Apple Calendar, Google or Outlook. Anyone with the link sees what it shows, so reset it if it gets out.
      </Foot>
    </section>
  );
}

function Tokens({ tokens }: { tokens: AgentToken[] }) {
  const revalidator = useRevalidator();
  const [failed, setFailed] = useState<Failed | null>(null);

  async function revoke(token: AgentToken) {
    if (!window.confirm(`Revoke "${token.label}"? The agent using it loses access at once.`)) return;
    setFailed(null);
    try {
      await api.revokeAgentToken(token.id);
      await revalidator.revalidate();
    } catch (failure) {
      setFailed({ failure, retry: () => void revoke(token) });
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
      <Foot failed={failed}>{tokens.length === 0 ? "No agent has a token yet." : undefined}</Foot>
    </section>
  );
}

function SignOut() {
  const navigate = useNavigate();
  const [failed, setFailed] = useState<Failed | null>(null);
  async function signOut() {
    try {
      await api.signOut();
      await navigate("/sign-in");
    } catch (failure) {
      setFailed({ failure, retry: () => void signOut() });
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
      <Foot failed={failed} />
    </section>
  );
}
