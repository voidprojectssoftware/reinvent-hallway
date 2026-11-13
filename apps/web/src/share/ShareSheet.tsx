// The share sheet over My week (docs/design/my-week-share.html): the two
// pictures, my page's link, my invite link, LinkedIn, the picture to save and
// the calendar to subscribe to, all from GET /api/me/share.
//
// Two pictures, each labelled for what it is, because they differ (ADR
// 0012): a posted link's preview is the card an anonymous visitor gets,
// which for a week that is not public shows only my name, while the picture
// to save is my own full week. The sheet fetches the first without the
// cookie, so it shows exactly what LinkedIn will, and offers the visibility
// switch beside it when the week is not public.
//
// Two links, said plainly, because they differ in what they let a stranger
// do: the page link shows my week as my visibility allows and connects no
// one; the invite link lets whoever has it connect with me at once, so it
// comes with a way to reset it.
//
// A placeholder handle (issue #48) is nudged at the top until it is replaced:
// the page link is the handle, and a made-up one is a poor thing to post.
//
// It is modal for the keyboard too (useModal): focus stays in it, and goes
// back to the Share button when it closes.
import type { ShareLinks } from "@hallway/contracts";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { api } from "../api/client.ts";
import { copyText } from "../copy.ts";
import { WhoCanSee } from "../settings/WhoCanSee.tsx";
import { useMe } from "../shell/AppLayout.tsx";
import { ProblemText, type Failed } from "../shell/Foot.tsx";
import { Icon, type IconName } from "../shell/Icon.tsx";
import { useModal } from "../shell/modal.ts";

const linkedInShare = (pageUrl: string) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;

/** An https feed as a webcal: link, which calendar apps open as a subscription. */
const webcal = (calendarUrl: string) => calendarUrl.replace(/^https?:/, "webcal:");

export function ShareSheet({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const placeholder = me?.handlePlaceholder ?? false;
  const visibility = me?.visibility ?? "connections";
  const [links, setLinks] = useState<ShareLinks | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useModal(dialog, onClose);
  const preview = usePublicCard(links?.imageUrl);

  async function load() {
    try {
      setLinks(await api.shareLinks());
    } catch (failure) {
      setFailed({ failure, retry: () => void load() });
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function copy(text: string, done: string) {
    const copied = await copyText(text);
    setFailed(copied ? null : { failure: "This browser did not allow copying. Try again from a secure page." });
    setNote(copied ? done : null);
  }

  async function change(call: () => Promise<unknown>, done: string) {
    setBusy(true);
    setFailed(null);
    try {
      await call();
      await load();
      setNote(done);
    } catch (failure) {
      setFailed({ failure, retry: () => void change(call, done) });
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
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-t"
      tabIndex={-1}
      ref={dialog}
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sheet-in">
        <div className="sheet-grab" aria-hidden="true" />
        <div className="sheet-g">
          <div className="sheet-t">
            <b id="share-t">Share my week</b>
            {page ? `${page.host}${page.pathname} shows your week to whoever your settings allow.` : "Getting your links…"}
            {links?.inviteUrl && " Your invite link also lets whoever has it connect with you in one tap."}
            {placeholder && (
              <span className="sheet-note">Your link uses a handle Hallway made up. Choose your own before you share it.</span>
            )}
            {(note || failed) && (
              <span className={failed ? "sheet-note error" : "sheet-note"} role={failed ? "alert" : "status"}>
                {failed ? <ProblemText failed={failed} /> : note}
              </span>
            )}
          </div>
          {links && (
            <div className="sheet-pics">
              <figure>
                {preview ? (
                  <img src={preview} alt="The link preview people see when you post your link" width={1200} height={627} />
                ) : (
                  <span className="sheet-pic-wait" aria-hidden="true" />
                )}
                <figcaption>When you post the link, people see</figcaption>
              </figure>
              <figure>
                <img src={links.imageUrl} alt="Your whole week, the picture to save and post" width={1200} height={627} />
                <figcaption>Your week, to save and post as a picture</figcaption>
              </figure>
            </div>
          )}
          {links && visibility !== "public" && (
            <div className="sheet-vis">
              <p className="sheet-vis-t">
                {visibility === "private"
                  ? "Your week is private, so the link preview shows only your name."
                  : "Your week is for your connections, so the link preview shows only your name."}
              </p>
              <WhoCanSee visibility={visibility} onChanged={() => void load()} />
            </div>
          )}
          {placeholder && (
            <Link className="sheet-b" to="/settings/profile" onClick={onClose}>
              <Icon name="gear" />
              Choose your handle
            </Link>
          )}
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
        <button className="sheet-cancel" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** The anonymous card for `imageUrl`, as an object URL while the sheet is open. */
function usePublicCard(imageUrl: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!imageUrl) return;
    let made: string | null = null;
    let live = true;
    api.publicShareCard(imageUrl).then(
      (blob) => {
        if (!live) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      },
      // The preview is an aid; the sheet works without it.
      (failure: unknown) => console.error("Hallway: the public share card did not load", failure),
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [imageUrl]);
  return url;
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
