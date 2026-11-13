// A group's footer that a failed action takes over: the refusal in red while
// there is one, else the group's own explanation.
import type { ReactNode } from "react";

export function Foot({ error, children }: { error: string | null; children?: ReactNode }) {
  if (error) {
    return (
      <p className="gfoot error" role="alert">
        {error}
      </p>
    );
  }
  return children ? <p className="gfoot">{children}</p> : null;
}

/** The words for whatever an action threw. */
export function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
