// The share sheet over My week (docs/design/my-week-share.html): my page's
// link, my invite link, LinkedIn, who can see my week, the two pictures, the
// picture to save and the calendar to subscribe to, all from GET
// /api/me/share.
//
// The actions come first and who can see my week is one row opening
// Settings: on a phone the pictures, the switch and its explanations above
// them pushed Copy link off the screen (#113, finding 8).
//
// Two pictures, each labelled for what it is, because they differ (ADR
// 0012): a posted link's preview is the card an anonymous visitor gets,
// which for a week that is not public shows only my name, while the picture
// to save is my own full week. Each has its own address (#70): the preview's
// is always the anonymous card, whoever asks, so it is a plain <img> showing
// exactly what LinkedIn will; mine is only ever mine.
//
// Posting goes through the composer (/share/post, ADR 0026), where the
// person picks the week, a day or sessions and edits the text.
//
// Two links, said plainly, because they differ in what they let a stranger
// do: the page link shows my week as my visibility allows and connects no
// one; the invite link lets whoever has it connect with me at once, so it
// comes with a way to reset it. Copying each says which it was.
//
// A placeholder handle (issue #48) is nudged at the top until it is replaced:
// the page link is the handle, and a made-up one is a poor thing to post.
//
// It is the shared action sheet (Sheet), modal for the keyboard too: focus
// stays in it, and goes back to the Share button when it closes.
import type { ShareLinks, Visibility } from "@hallway/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { api } from "../api/client.ts";
import { copyText } from "../copy.ts";
import { useMe } from "../shell/AppLayout.tsx";
import { ProblemText, type Failed } from "../shell/Foot.tsx";
import { Icon, type IconName } from "../shell/Icon.tsx";
import { Sheet } from "../shell/Sheet.tsx";

/** An https feed as a webcal: link, which calendar apps open as a subscription. */
const webcal = (calendarUrl: string) => calendarUrl.replace(/^https?:/, "webcal:");

export function ShareSheet({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const placeholder = me?.handlePlaceholder ?? false;
  const visibility = me?.visibility ?? "network";
  const [links, setLinks] = useState<ShareLinks | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [busy, setBusy] = useState(false);

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
  return (
    <Sheet labelledBy="share-t" onClose={onClose} closeLabel="Cancel">
      <div className="sheet-t">
        <b id="share-t">Share my week</b>
        {page ? `${page.host}${page.pathname}` : "Getting your links…"}
        {placeholder && (
          <span className="sheet-note">Your link uses a handle Hallway made up. Choose your own before you share it.</span>
        )}
        {(note || failed) && (
          <span className={failed ? "sheet-note error" : "sheet-note"} role={failed ? "alert" : "status"}>
            {failed ? <ProblemText failed={failed} /> : note}
          </span>
        )}
      </div>
      {placeholder && (
        <Link className="sheet-b" to="/settings/profile" onClick={onClose}>
          <Icon name="gear" />
          Choose your handle
        </Link>
      )}
      {links && (
        <>
          <SheetButton icon="link" onClick={() => copy(links.pageUrl, "Link copied. It shows your week to whoever your settings allow.")}>
            Copy link
          </SheetButton>
          {links.inviteUrl && (
            <SheetButton icon="people" onClick={() => copy(links.inviteUrl ?? "", "Invite link copied. Whoever opens it can connect with you.")}>
              Copy invite link
            </SheetButton>
          )}
          <Link className="sheet-b" to="/share/post" onClick={onClose}>
            <Icon name="share" />
            Post on LinkedIn
          </Link>
          <Link className="sheet-row" to="/settings" onClick={onClose}>
            <span className="sheet-row-k">Who can see my week</span>
            <span className="sheet-row-v">{visibilityLabel[visibility]}</span>
            <Icon name="chev" className="chev" />
          </Link>
          <div className="sheet-pics">
            <figure>
              <img src={links.imageUrl} alt="The link preview people see when you post your link" width={1200} height={627} />
              <figcaption>{visibility === "public" ? "When you post the link, people see" : "When you post the link, people see only your name"}</figcaption>
            </figure>
            {links.myImageUrl && (
              <figure>
                <img src={links.myImageUrl} alt="Your whole week, the picture to save and post" width={1200} height={627} />
                <figcaption>Your week, to save and post as a picture</figcaption>
              </figure>
            )}
          </div>
          {links.myImageUrl && (
            <a className="sheet-b" href={links.myImageUrl} download="hallway-week.png">
              <Icon name="photo" />
              Save picture
            </a>
          )}
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
    </Sheet>
  );
}

/** The switch's words, as Settings shows them (WhoCanSee). */
const visibilityLabel: Record<Visibility, string> = { public: "Anyone", network: "My network", private: "Only me" };

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
