// The sheet that asks someone with a placeholder handle to choose one
// (issue #48). It sends them to the profile form, where the handle is, rather
// than holding a second form: one place edits a handle.
import type { Me } from "@hallway/contracts";
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Icon } from "../shell/Icon.tsx";
import { Sheet } from "../shell/Sheet.tsx";
import { dismissHandlePrompt, handlePromptDismissed, shouldAskForHandle } from "./handle-prompt.ts";

export function HandlePrompt({ me }: { me: Me }) {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(handlePromptDismissed);
  const open = shouldAskForHandle(me.handlePlaceholder, pathname, dismissed);

  function notNow() {
    dismissHandlePrompt();
    setDismissed(true);
  }

  if (!open) return null;
  return (
    <Sheet labelledBy="handle-t" onClose={notNow} closeLabel="Not now">
      <div className="sheet-t">
        <b id="handle-t">Choose your handle</b>
        Hallway could not make a link from your name, so for now your page is /@{me.handle}. Choose a handle people will
        recognise when you share it.
      </div>
      <Link className="sheet-b" to="/settings/profile">
        <Icon name="link" />
        Choose a handle
      </Link>
    </Sheet>
  );
}
