// One screen's frame, as every mock in docs/design draws it: the 44 px nav bar
// over a blur, then the large title and the one line under it. The bar's own
// title appears once the large title has scrolled under it, as on iOS.
//
// It also names the browser tab after the screen ("Ben Okafor · Hallway"),
// so history, tabs and screen readers can tell screens apart, and draws the
// back button: to the screen I came from when this tab saw it (back.ts),
// else to the screen's parent.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useNavigationType } from "react-router";
import { backLabel, previousVisit, recordVisit } from "./back.ts";
import { Icon } from "./Icon.tsx";

interface ScreenProps {
  title: string;
  /** The bar's title when it differs from the large one (a session's code). */
  navTitle?: string;
  /** False when the screen draws its own heading (a person's card). */
  large?: boolean;
  /** A long title (a session's name) drops from Large Title to Title 1. */
  long?: boolean;
  sub?: ReactNode;
  /**
   * The parent to go back to when this tab did not come from another screen.
   * `null`: a back button only to where I came from, with no parent (a
   * signed-out visitor has no week to go back to). Absent: no back button,
   * as on a tab's own screen.
   */
  back?: { to: string; label: string } | null;
  /** A button on the right of the bar (My week's Share). */
  action?: ReactNode;
  children: ReactNode;
}

export function Screen({ title, navTitle = title, large = true, long = false, sub, back, action, children }: ScreenProps) {
  const scrolled = useScrolledPast(40);
  const location = useLocation();
  const kind = useNavigationType();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = title === "Hallway" ? "Hallway" : `${title} · Hallway`;
  }, [title]);
  useEffect(() => recordVisit(location.key, kind, navTitle), [location.key, kind, navTitle]);

  const came = back === undefined ? null : previousVisit(location.key, kind);
  return (
    <>
      <header className={scrolled ? "nav scrolled" : "nav"}>
        <div className="col gutter nav-row">
          <div className="nav-side">
            {came ? (
              <button className="navbtn" type="button" onClick={() => navigate(-1)}>
                <Icon name="back" className="back" />
                {backLabel(came.title)}
              </button>
            ) : (
              back && (
                <Link className="navbtn" to={back.to}>
                  <Icon name="back" className="back" />
                  {back.label}
                </Link>
              )
            )}
          </div>
          <div className="nav-title" aria-hidden="true">
            {navTitle}
          </div>
          <div className="nav-side right">{action}</div>
        </div>
      </header>
      <main className="col gutter">
        {large && (
          <div className="large">
            <h1 className={long ? "long" : undefined}>{title}</h1>
            {sub && <p className="large-sub">{sub}</p>}
          </div>
        )}
        {children}
      </main>
    </>
  );
}

function useScrolledPast(offset: number): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > offset);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [offset]);
  return scrolled;
}
