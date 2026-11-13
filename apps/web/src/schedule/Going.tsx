// The who-is-going row under a session on a week (.going): faces, then names.
import type { Person } from "@hallway/contracts";
import { Avatar } from "../shell/Avatar.tsx";
import { facesDrawn, goingWords } from "./going.ts";

export function Going({ people, total = people.length }: { people: readonly Person[]; total?: number }) {
  const { names, rest } = goingWords(people, total);
  return (
    <div className="going">
      {people.length > 0 && (
        <span className="stack" aria-hidden="true">
          {people.slice(0, facesDrawn).map((person) => (
            <Avatar key={person.id} person={person} size="sm" />
          ))}
        </span>
      )}
      <span>
        {names && <b>{names}</b>}
        {rest}
      </span>
    </div>
  );
}
