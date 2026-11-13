// The action sheet every sheet is built from (issue #97): the dimmed page, a
// grabber, a grouped panel holding the sheet's own content, and the closing
// button on its own, modal for the keyboard (useModal).
//
// Into body, not where its opener sits: the nav bar's backdrop-filter makes
// it the containing block of anything fixed inside it, which pinned the
// sheet to the bar's 44 px, and a group would do the same.
//
// The dialog that takes focus is the panel that scrolls (.sheet-in), not the
// dimmed page around it. On a short screen a sheet is taller than the
// window, and the arrow keys and Page Down scroll only what has focus or
// holds it, so focusing the page around it left the middle of the sheet out
// of a keyboard user's reach (found in #96 for the Why? sheet).
import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModal } from "./modal.ts";

interface SheetProps {
  /** The id of the sheet's title, which names the dialog. */
  labelledBy: string;
  /** Called by the closing button, Escape and a tap on the dimmed page. */
  onClose: () => void;
  /** The closing button's words: Cancel, Done, Not now. */
  closeLabel: string;
  /** The grouped panel's content: the title block, then the rows. */
  children: ReactNode;
}

export function Sheet({ labelledBy, onClose, closeLabel, children }: SheetProps) {
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog, onClose);

  return createPortal(
    <div className="sheet" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet-in" role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={dialog}>
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-g">{children}</div>
        <button className="sheet-cancel" type="button" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </div>,
    document.body,
  );
}
