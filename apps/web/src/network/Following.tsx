// The people I follow, on Network (ADR 0019): one group per source. Each
// person links to their week when I may see it; otherwise the row says their
// week is for their network and offers to connect, because following someone
// never shows me their week. Following me is what shows them mine.
import type { FollowedPerson, Following as FollowingList } from "@hallway/contracts";
import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import { api } from "../api/client.ts";
import { Avatar } from "../shell/Avatar.tsx";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { sessionCounts } from "./counts.ts";

type Where = "github" | "linkedin";

export function Following({ following }: { following: FollowingList }) {
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<(Failed & { where: Where }) | null>(null);
  const { github, linkedinImport } = following;

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

  const rows = (where: Where, people: FollowedPerson[]) =>
    people.map((followed) => (
      <FollowedRow
        key={followed.person.id}
        followed={followed}
        disabled={busy !== null}
        onConnect={() => void connect(where, followed.person.handle)}
      />
    ));

  const notOnHallway =
    github.notOnHallway === 0
      ? ""
      : ` ${github.notOnHallway} ${github.notOnHallway === 1 ? "person you follow there is" : "people you follow there are"} not on Hallway yet; they show up here when they add GitHub.`;

  return (
    <>
      <section className="section">
        <h2 className="ghead">
          Following on GitHub <span>{github.people.length}</span>
        </h2>
        <ul className="group">
          {github.people.length === 0 && (
            <li>
              <div className="cell">
                <span className="cellmain cellsub">
                  {github.linked ? "No one you follow on GitHub is on Hallway yet." : "Add GitHub to bring in the people you follow there."}
                </span>
              </div>
            </li>
          )}
          {rows("github", github.people)}
          <li>
            <button className="cell" type="button" disabled={busy !== null} onClick={() => void goToGitHub()}>
              <span className="cellmain celltitle">{github.linked ? "Refresh from GitHub" : "Add GitHub"}</span>
              <Icon name="chev" className="chev" />
            </button>
          </li>
        </ul>
        <Foot failed={failed?.where === "github" ? failed : null}>
          Following someone shows them your week while it is set to My network. It does not show you theirs: that takes them
          following you back, or connecting.{notOnHallway}
        </Foot>
      </section>

      {linkedinImport.people.length > 0 && (
        <section className="section">
          <h2 className="ghead">
            Following from LinkedIn <span>{linkedinImport.people.length}</span>
          </h2>
          <ul className="group">{rows("linkedin", linkedinImport.people)}</ul>
          <Foot failed={failed?.where === "linkedin" ? failed : null}>
            People from the Connections.csv you imported. Importing again replaces this list.
          </Foot>
        </section>
      )}
    </>
  );
}

function FollowedRow({ followed, disabled, onConnect }: { followed: FollowedPerson; disabled: boolean; onConnect: () => void }) {
  const { person, scheduleVisible, sessions } = followed;
  if (scheduleVisible) {
    return (
      <li>
        <Link className="cell lead-av" to={`/@${person.handle}`}>
          <Avatar person={person} />
          <div className="cellmain">
            <span className="celltitle">{person.displayName}</span>
            <span className="cellsub">{sessionCounts({ sessions })}</span>
          </div>
          <Icon name="chev" className="chev" />
        </Link>
      </li>
    );
  }
  return (
    <li>
      <div className="cell lead-av">
        <Link to={`/@${person.handle}`} aria-label={person.displayName}>
          <Avatar person={person} />
        </Link>
        <div className="cellmain">
          <span className="celltitle">{person.displayName}</span>
          <span className="cellsub">Their week is for their network</span>
        </div>
        <button className="minibtn" type="button" disabled={disabled} onClick={onConnect}>
          Connect
        </button>
      </div>
    </li>
  );
}
