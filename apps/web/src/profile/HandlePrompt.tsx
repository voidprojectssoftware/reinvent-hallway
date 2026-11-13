// The sheet that asks someone with a placeholder handle to choose one
// (issue #48). It sends them to the profile form, where the handle is, rather
// than holding a second form: one place edits a handle.
import type { Me } from "@hallway/contracts";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { Icon } from "../shell/Icon.tsx";
import { dismissHandlePrompt, handlePromptDismissed, shouldAskForHandle } from "./handle-prompt.ts";

export function HandlePrompt({ me }: { me: Me }) {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(handlePromptDismissed);
  const open = shouldAskForHandle(me.handlePlaceholder, pathname, dismissed);

  function notNow() {
    dismissHandlePrompt();
    setDismissed(true);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && notNow();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  // Into body, as the share sheet: the nav bar's backdrop-filter would pin a
  // fixed element inside it to the bar.
  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="handle-t" onClick={(event) => event.target === event.currentTarget && notNow()}>
      <div className="sheet-in">
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-g">
          <div className="sheet-t">
            <b id="handle-t">Choose your handle</b>
            Hallway could not make a link from your name, so for now your page is /@{me.handle}. Choose a handle people will
            recognise when you share it.
          </div>
          <Link className="sheet-b" to="/settings/profile">
            <Icon name="link" />
            Choose a handle
          </Link>
        </div>
        <button className="sheet-cancel" type="button" onClick={notNow} autoFocus>
          Not now
        </button>
      </div>
    </div>,
    document.body,
  );
}
