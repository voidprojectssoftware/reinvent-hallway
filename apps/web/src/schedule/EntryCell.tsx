// One session on a week, as my-week.html and person.html draw it: start and
// end on the left, then the title, code and place, the intent badge and the
// flags under it. Session titles are text from agents, so they are only ever
// rendered as text (React escapes them), never as HTML.
import type { PlanEntry, Session } from "@hallway/contracts";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "../shell/Icon.tsx";
import { formatTime } from "../time.ts";

type Intent = PlanEntry["intent"];

interface EntryCellProps {
  session: Session;
  /** Mine or theirs; absent for a session on no one's week here (a search result). */
  intent?: Intent | undefined;
  hidden?: boolean;
  /** "Same time as SVS401", when another of my entries overlaps this one. */
  clash?: string | undefined;
  /** The who-is-going row (Going), when the screen knows who is. */
  going?: ReactNode;
}

export function EntryCell({ session, intent, hidden = false, clash, going }: EntryCellProps) {
  return (
    <li>
      <Link className={hidden ? "cell lead-time hidden-entry" : "cell lead-time"} to={sessionPath(session.sessionId)}>
        <When session={session} />
        <div className="cellmain">
          <span className="celltitle">{sessionName(session)}</span>
          <SessionLine session={session} />
          <div className="meta">
            {intent && <IntentBadge intent={intent} />}
            {clash && <span className="clash">{clash}</span>}
          </div>
          {going}
          {hidden && (
            <span className="hiddennote">
              <Icon name="eye-off" />
              Hidden from others
            </span>
          )}
        </div>
        <Icon name="chev" className="chev" />
      </Link>
    </li>
  );
}

function When({ session }: { session: Session }) {
  if (session.isAllDay) return <div className="when"><b>All day</b></div>;
  if (!session.startsAt) return <div className="when"><b>Time to come</b></div>;
  return (
    <div className="when">
      <b>{formatTime(session.startsAt)}</b>
      {session.endsAt && <span>{formatTime(session.endsAt)}</span>}
    </div>
  );
}

/** "AIM3315 · MGM Grand, Grand 122", leaving out what the snapshot lacks. */
export function SessionLine({ session }: { session: Session }) {
  const place = [session.venue, session.room].filter(Boolean).join(", ");
  if (!session.code && !place) return null;
  return (
    <span className="cellsub">
      {session.code && <span className="code">{session.code}</span>}
      {session.code && place && " · "}
      {place}
    </span>
  );
}

export function IntentBadge({ intent }: { intent: Intent }) {
  return intent === "reserved" ? (
    <span className="badge reserved">
      <Icon name="check" />
      Reserved
    </span>
  ) : (
    <span className="badge">Interested</span>
  );
}

export function sessionName(session: Session): string {
  return session.title ?? session.code ?? "Untitled session";
}

export function sessionPath(sessionId: string): string {
  return `/sessions/${encodeURIComponent(sessionId)}`;
}
