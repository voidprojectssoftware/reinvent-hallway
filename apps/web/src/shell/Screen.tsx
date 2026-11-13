// One screen's frame, as every mock in docs/design draws it: the 44 px nav bar
// over a blur, then the large title and the one line under it. The bar's own
// title appears once the large title has scrolled under it, as on iOS.
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
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
  back?: { to: string; label: string } | undefined;
  /** A button on the right of the bar (My week's Share). */
  action?: ReactNode;
  children: ReactNode;
}

export function Screen({ title, navTitle = title, large = true, long = false, sub, back, action, children }: ScreenProps) {
  const scrolled = useScrolledPast(40);
  return (
    <>
      <header className={scrolled ? "nav scrolled" : "nav"}>
        <div className="col gutter nav-row">
          <div className="nav-side">
            {back && (
              <Link className="navbtn" to={back.to}>
                <Icon name="back" className="back" />
                {back.label}
              </Link>
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
