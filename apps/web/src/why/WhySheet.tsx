// Why the full description and changes to your schedule depend on AWS
// (issue #87): one sheet, opened from a small "Why?" beside each place the
// app sends a person to re:Invent, so the reason is said once and the same
// everywhere (its words are in copy.ts).
//
// It is the share sheet's action sheet and focus trap (useModal), with text
// in place of actions, and opens scrolled to the part the link was beside.
// The closing step is the session on re:Invent when there is one, else a
// sync from Connect your agent.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { Icon } from "../shell/Icon.tsx";
import { useModal } from "../shell/modal.ts";
import { whyNext, whySections, whyTitle, type WhySection } from "./copy.ts";

interface WhyProps {
  /** The part to open on. */
  section: WhySection;
  /** The session's re:Invent page, which becomes the closing step. */
  sessionUrl?: string;
}

/** "Why?" inside a sentence (a group's footer), opening the sheet. */
export function WhyLink(props: WhyProps) {
  return (
    <WhyOpener {...props}>
      {(open) => (
        <button className="linkbtn" type="button" aria-haspopup="dialog" onClick={open}>
          Why?
        </button>
      )}
    </WhyOpener>
  );
}

/** A row of its own in a grouped list (Settings), opening the sheet. */
export function WhyRow(props: WhyProps) {
  return (
    <WhyOpener {...props}>
      {(open) => (
        <button className="cell action lead" type="button" aria-haspopup="dialog" onClick={open}>
          {whyTitle}
        </button>
      )}
    </WhyOpener>
  );
}

function WhyOpener({ children, ...props }: WhyProps & { children: (open: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {children(() => setOpen(true))}
      {open && <WhySheet {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function WhySheet({ section, sessionUrl, onClose }: WhyProps & { onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const opened = useRef<HTMLElement>(null);
  useModal(dialog, onClose);

  // The schedule part sits under the description; on a short window the
  // sheet scrolls, so a link about the schedule brings that part into view.
  useEffect(() => {
    if (section !== "description") opened.current?.scrollIntoView({ block: "start" });
  }, [section]);

  // Into body, as the share sheet: a fixed sheet inside the blurred nav bar
  // or a group would be pinned to it.
  return createPortal(
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="why-t"
      tabIndex={-1}
      ref={dialog}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sheet-in">
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-g">
          <div className="sheet-t">
            <b id="why-t">{whyTitle}</b>
          </div>
          {(Object.keys(whySections) as WhySection[]).map((key) => (
            <section key={key} className="why-part" ref={key === section ? opened : undefined} aria-labelledby={`why-${key}`}>
              <h2 id={`why-${key}`}>{whySections[key].heading}</h2>
              {whySections[key].paragraphs.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </section>
          ))}
          {sessionUrl ? (
            <a className="sheet-b" href={sessionUrl} target="_blank" rel="noopener">
              {whyNext.open} <Icon name="out" />
            </a>
          ) : (
            <Link className="sheet-b" to="/connect" onClick={onClose}>
              {whyNext.sync}
            </Link>
          )}
        </div>
        <button className="sheet-cancel" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}
