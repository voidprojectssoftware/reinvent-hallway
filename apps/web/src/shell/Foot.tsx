// A group's footer that a failed action takes over, and the words for any
// failure (problem.ts): what happened, then the next step as a link or a
// button. Every action's refusal and a screen that failed to load
// (routes.tsx, LoadFailed) say it the same way.
import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { describeProblem, problemDetail } from "./problem.ts";
import { signInPath } from "./signed-in.ts";

/**
 * What went wrong with an action: the failure it threw, or words a screen
 * wrote itself (a string, shown as it is), and how to run the action again.
 */
export interface Failed {
  failure: unknown;
  retry?: () => void;
}

export function Foot({ failed, children }: { failed: Failed | null; children?: ReactNode }) {
  if (failed) {
    return (
      <p className="gfoot error" role="alert">
        <ProblemText failed={failed} />
      </p>
    );
  }
  return children ? <p className="gfoot">{children}</p> : null;
}

/** The words and the next step, inline, for a footer or the share sheet's note. */
export function ProblemText({ failed }: { failed: Failed }) {
  const { failure, retry } = failed;
  const here = useLocation();
  useLogged(failure);
  const problem = typeof failure === "string" ? { text: failure, next: null } : describeProblem(failure);
  return (
    <>
      {problem.text}
      {problem.next === "sign-in" && (
        <>
          {" "}
          <Link to={signInPath(here.pathname + here.search)}>Sign in</Link>
        </>
      )}
      {problem.next === "retry" && retry && (
        <>
          {" "}
          <button className="linkbtn" type="button" onClick={retry}>
            Try again
          </button>
        </>
      )}
    </>
  );
}

/** The developer's detail of a failure shown to a person goes to the console, once. */
export function useLogged(failure: unknown) {
  useEffect(() => {
    if (typeof failure !== "string") console.error(`Hallway: ${problemDetail(failure)}`, failure);
  }, [failure]);
}
