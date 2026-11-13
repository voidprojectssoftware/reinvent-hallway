// The people I follow, on Network (ADR 0019): one group per source. Each
// person links to their week when I may see it; otherwise the row says their
// week is for their network and offers to connect, because following someone
// never shows me their week. Following me is what shows them mine.
//
// Only the people no stronger group on Network holds (rows.ts): someone in
// both sources shows once, under GitHub, saying both.
import type { FollowedPerson } from "@hallway/contracts";
import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import { api } from "../api/client.ts";
import { Avatar } from "../shell/Avatar.tsx";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { sessionCounts } from "./counts.ts";
import { PersonRow } from "./PersonRow.tsx";
import { knownFrom, type Source } from "./rows.ts";

type Where = "github" | "linkedin";

interface FollowingProps {
  github: (FollowedPerson & { known?: Source[] })[];
  /** People I follow on GitHub who show in a group above instead. */
  githubElsewhere: number;
  linkedin: FollowedPerson[];
  /** Whether I sign in with GitHub. */
  linked: boolean;
  notOnHallway: number;
}

export function Following({ github, githubElsewhere, linkedin, linked, notOnHallway: elsewhere }: FollowingProps) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<(Failed & { where: Where }) | null>(null);

  async function connect(where: Where, handle: string) {
    setBusy(handle);
    setFailed(null);
    try {
      await api.requestConnection(handle);
      await revalidator.revalidate();
    } catch (failure) {
      setFailed({ where, failure, retry: () => void connect(where, handle) });
    } finally {
      setBusy(null);
    }
  }

  /** "Refresh from GitHub" and "Add GitHub" are the same round trip: GitHub sends the browser back here. */
  async function goToGitHub() {
    setBusy("github");
    setFailed(null);
    try {
      const { authorizationUrl } = await api.refreshGitHubFollows("/network");
      window.location.assign(authorizationUrl);
    } catch (failure) {
      setFailed({ where: "github", failure, retry: () => void goToGitHub() });
      setBusy(null);
    }
  }

  const rows = (where: Where, people: (FollowedPerson & { known?: Source[] })[]) =>
    people.map((followed) => (
      <FollowedRow
        key={followed.person.id}
        followed={followed}
        // Under GitHub, only a second source is news.
        also={followed.known && followed.known.length > 1 ? knownFrom(followed.known) : null}
        disabled={busy !== null}
        onConnect={() => void connect(where, followed.person.handle)}
      />
    ));

  const notOnHallway =
    elsewhere === 0
      ? ""
      : ` ${elsewhere} ${elsewhere === 1 ? "person you follow there is" : "people you follow there are"} not on Hallway yet; they show up here when they add GitHub.`;

  return (
    <>
      <section className="section">
        <h2 className="ghead">
          Following on GitHub <span>{github.length}</span>
        </h2>
        <ul className="group">
          {github.length === 0 && (
            <li>
              <div className="cell">
                <span className="cellmain cellsub">
                  {!linked
                    ? "Add GitHub to bring in the people you follow there."
                    : githubElsewhere > 0
                      ? "Everyone you follow there who is on Hallway is in a group above."
                      : "No one you follow on GitHub is on Hallway yet."}
                </span>
              </div>
            </li>
          )}
          {rows("github", github)}
          <li>
            <button className="cell" type="button" disabled={busy !== null} onClick={() => void goToGitHub()}>
              <span className="cellmain celltitle">{linked ? "Refresh from GitHub" : "Add GitHub"}</span>
              <Icon name="chev" className="chev" />
            </button>
          </li>
        </ul>
        <Foot failed={failed?.where === "github" ? failed : null}>
          Following someone shows them your week while it is set to My network. It does not show you theirs: that takes them
          following you back, or connecting.{notOnHallway}
        </Foot>
      </section>

      {linkedin.length > 0 && (
        <section className="section">
          <h2 className="ghead">
            Following from LinkedIn <span>{linkedin.length}</span>
          </h2>
          <ul className="group">{rows("linkedin", linkedin)}</ul>
          <Foot failed={failed?.where === "linkedin" ? failed : null}>
            People from the Connections.csv you imported. Importing again replaces this list.
          </Foot>
        </section>
      )}
    </>
  );
}

interface FollowedRowProps {
  followed: FollowedPerson;
  /** How else I know them, when that is news. */
  also: string | null;
  disabled: boolean;
  onConnect: () => void;
}

function FollowedRow({ followed, also, disabled, onConnect }: FollowedRowProps) {
  const { person, scheduleVisible, sessions } = followed;
  if (scheduleVisible) {
    return (
      <li>
        <Link className="cell lead-av" to={`/@${person.handle}`}>
          <Avatar person={person} />
          <div className="cellmain">
            <span className="celltitle">{person.displayName}</span>
            <span className="cellsub">{sessionCounts({ sessions })}</span>
            {also && <span className="cellsub">{also}</span>}
          </div>
          <Icon name="chev" className="chev" />
        </Link>
      </li>
    );
  }
  return (
    <PersonRow
      person={person}
      lines={["Their week is for their network", also]}
      actions={
        <button className="minibtn" type="button" disabled={disabled} onClick={onConnect}>
          Connect
        </button>
      }
    />
  );
}
