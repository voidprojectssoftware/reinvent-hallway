// The share sheet over My week (docs/design/my-week-share.html): the picture
// to post, my page's link, my invite link, LinkedIn, the picture to save and
// the calendar to subscribe to, all from GET /api/me/share.
//
// Two links, said plainly, because they differ in what they let a stranger
// do: the page link shows my week as my visibility allows and connects no
// one; the invite link lets whoever has it connect with me at once, so it
// comes with a way to reset it.
import type { ShareLinks } from "@hallway/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client.ts";
import { copyText } from "../copy.ts";
import { failureText } from "../shell/Foot.tsx";
import { Icon, type IconName } from "../shell/Icon.tsx";

const linkedInShare = (pageUrl: string) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;

/** An https feed as a webcal: link, which calendar apps open as a subscription. */
const webcal = (calendarUrl: string) => calendarUrl.replace(/^https?:/, "webcal:");

export function ShareSheet({ onClose }: { onClose: () => void }) {
  const [links, setLinks] = useState<ShareLinks | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setLinks(await api.shareLinks());
    } catch (failure) {
      setError(failureText(failure));
    }
  }

  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copy(text: string, done: string) {
    const copied = await copyText(text);
    setError(copied ? null : "This browser did not allow copying. Try again from a secure page.");
    setNote(copied ? done : null);
  }

  async function change(call: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await call();
      await load();
      setNote(done);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  function resetInvite() {
    if (!window.confirm("Reset your invite link? The old one stops connecting people. Your connections stay.")) return;
    void change(() => api.rotateInvite(), "New invite link made. The old one no longer connects anyone.");
  }

  const page = links && new URL(links.pageUrl);
  // Into body, not where the Share button sits: the nav bar's backdrop-filter
  // makes it the containing block of anything fixed inside it, which pinned
  // the sheet to the bar's 44 px.
  return createPortal(
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="share-t" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sheet-in">
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-g">
          {links && <img className="sheet-preview" src={links.imageUrl} alt="The picture of your week that goes with the link" width={1200} height={627} />}
          <div className="sheet-t">
            <b id="share-t">Share my week</b>
            {page ? `${page.host}${page.pathname} shows your week to whoever your settings allow.` : "Getting your links…"}
            {links?.inviteUrl && " Your invite link also lets whoever has it connect with you in one tap."}
            {(note || error) && (
              <span className={error ? "sheet-note error" : "sheet-note"} role={error ? "alert" : "status"}>
                {error ?? note}
              </span>
            )}
          </div>
          {links && (
            <>
              <SheetButton icon="link" onClick={() => copy(links.pageUrl, "Link copied.")}>
                Copy link
              </SheetButton>
              {links.inviteUrl && (
                <SheetButton icon="people" onClick={() => copy(links.inviteUrl ?? "", "Invite link copied. Whoever opens it can connect with you.")}>
                  Copy invite link
                </SheetButton>
              )}
              <a className="sheet-b" href={linkedInShare(links.pageUrl)} target="_blank" rel="noopener">
                <Icon name="share" />
                Post on LinkedIn
              </a>
              <a className="sheet-b" href={links.imageUrl} download="hallway-week.png">
                <Icon name="photo" />
                Save picture
              </a>
              {links.calendarUrl ? (
                <a className="sheet-b" href={webcal(links.calendarUrl)}>
                  <Icon name="cal" />
                  Subscribe in Calendar
                </a>
              ) : (
                <SheetButton icon="cal" disabled={busy} onClick={() => change(() => api.rotateCalendarFeed(), "Calendar link made. Tap Subscribe.")}>
                  Make a calendar link
                </SheetButton>
              )}
              {links.inviteUrl && (
                <SheetButton icon="key" danger disabled={busy} onClick={resetInvite}>
                  Reset invite link
                </SheetButton>
              )}
            </>
          )}
        </div>
        <button className="sheet-cancel" type="button" onClick={onClose} autoFocus>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}

interface SheetButtonProps {
  icon: IconName;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

function SheetButton({ icon, onClick, danger = false, disabled = false, children }: SheetButtonProps) {
  return (
    <button className={danger ? "sheet-b danger" : "sheet-b"} type="button" disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
      {children}
    </button>
  );
}
