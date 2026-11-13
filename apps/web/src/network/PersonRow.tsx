// A person on Network with something to do about them (Accept, Connect,
// Withdraw). The avatar, name and lines under it are one link to their page,
// the row's full height, so a person can see who someone is before answering
// (#113, finding 11); the buttons sit outside it. Two buttons go under the
// text; one goes beside it, and under it too on a narrow phone (finding 18,
// app.css `.person-row`).
import type { Person } from "@hallway/contracts";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Avatar } from "../shell/Avatar.tsx";

interface PersonRowProps {
  person: Person;
  /** The lines under the name; empty ones are left out. */
  lines: (string | null | undefined)[];
  actions: ReactNode;
  /** The actions under the text at every width (a request's Accept and Decline). */
  below?: boolean;
}

export function PersonRow({ person, lines, actions, below = false }: PersonRowProps) {
  return (
    <li>
      <div className={below ? "cell lead-av person-row below" : "cell lead-av person-row"}>
        <Link className="person-link" to={`/@${person.handle}`}>
          <Avatar person={person} />
          <span className="cellmain">
            <span className="celltitle">{person.displayName}</span>
            {lines.filter(Boolean).map((line) => (
              <span className="cellsub" key={line}>
                {line}
              </span>
            ))}
          </span>
        </Link>
        {below ? <div className="cell-actions">{actions}</div> : actions}
      </div>
    </li>
  );
}
