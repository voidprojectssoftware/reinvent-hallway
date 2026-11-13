// Tell people you're going (issue #78, ADR 0026): pick the week, a day or
// sessions, look at the picture for exactly that, edit the suggested text,
// then post it to LinkedIn or take it there by hand. Reached from the share
// sheet and from a session on my week.
//
// "Post to LinkedIn" leaves for LinkedIn's consent page and comes back here
// with `posted` or `error`; the server holds the draft meanwhile, and this
// tab keeps the text so a refusal returns to my own words. The fallback
// (copy, save, open LinkedIn) needs no LinkedIn app and is always offered.
//
// On a phone (#113, finding 15): opened for one session, the list shows the
// chosen sessions and a "Choose sessions" row rather than all of my week, and
// Copy text with the main action sits in a bar above the tab bar, so neither
// is ten screens down.
import type { PostDraft } from "@hallway/contracts";
import { useEffect, useState } from "react";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { api } from "../api/client.ts";
import { copyText } from "../copy.ts";
import { WhoCanSee } from "../settings/WhoCanSee.tsx";
import {
  keptText,
  linkedInShareUrl,
  notPostedText,
  pickFrom,
  postUrlOf,
  searchOf,
  type Pick,
} from "../share/composer.ts";
import { useMe } from "../shell/AppLayout.tsx";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";
import { dayChip, formatDate, formatDay, formatTime, zoneAbbreviation } from "../time.ts";

export async function composeLoader({ request }: { request: Request }): Promise<{ draft: PostDraft; pick: Pick }> {
  const pick = pickFrom(new URL(request.url).searchParams);
  return { draft: await requireSignIn(api.composePost(searchOf(pick, true)), request), pick };
}

export function Compose() {
  const { draft, pick } = useLoaderData<typeof composeLoader>();
  const [search] = useSearchParams();
  // The whole list rather than only the chosen sessions, once asked for. Held
  // here, since each tick remounts the form below.
  const [choosing, setChoosing] = useState(false);
  // A fresh form for each selection: its suggestion, or the words I left with.
  return (
    <Composer
      key={searchOf(pick)}
      draft={draft}
      pick={pick}
      posted={search.get("posted")}
      error={search.get("error")}
      choosing={choosing}
      onChoose={() => setChoosing(true)}
    />
  );
}

interface ComposerProps {
  draft: PostDraft;
  pick: Pick;
  posted: string | null;
  error: string | null;
  /** "Choose sessions" was tapped. */
  choosing: boolean;
  onChoose: () => void;
}

function Composer({ draft, pick, posted, error, choosing, onChoose }: ComposerProps) {
  const navigate = useNavigate();
  const me = useMe();
  const nothingPicked = pick.kind === "sessions" && pick.sessionIds.length === 0;
  const [text, setText] = useState(() => keptText.read(pick) ?? (nothingPicked ? "" : draft.text));
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const postUrl = postUrlOf(posted);

  useEffect(() => {
    if (postUrl) keptText.clear(pick);
  }, [postUrl, pick]);

  const go = (next: Pick) => void navigate(`/share/post${searchOf(next)}`, { replace: true });
  const firstDay = draft.offered.find((s) => s.day)?.day ?? draft.days[0] ?? "";
  const chosen = new Set(nothingPicked ? [] : draft.selected);
  const empty = chosen.size === 0;
  // With nothing chosen there is nothing to show but the whole list.
  const listAll = choosing || empty;

  function toggle(sessionId: string) {
    const ids = pick.kind === "sessions" ? pick.sessionIds : [];
    go({ kind: "sessions", sessionIds: ids.includes(sessionId) ? ids.filter((id) => id !== sessionId) : [...ids, sessionId] });
  }

  async function postToLinkedIn() {
    setBusy(true);
    setFailed(null);
    try {
      keptText.save(pick, text);
      const { authorizationUrl } = await api.beginLinkedInPost({
        text,
        ...(pick.kind === "day" && { day: pick.day }),
        ...(pick.kind === "sessions" && { sessionIds: pick.sessionIds }),
      });
      window.location.assign(authorizationUrl);
    } catch (failure) {
      setFailed({ failure, retry: () => void postToLinkedIn() });
      setBusy(false);
    }
  }

  async function copy() {
    const copied = await copyText(text);
    setFailed(copied ? null : { failure: "This browser did not allow copying. Select the text and copy it yourself." });
    setNote(copied ? "Text copied. Paste it into LinkedIn's post box." : null);
  }

  const visibility = me?.visibility ?? "network";
  const linkHere = encodeURIComponent(`/share/post${searchOf(pick)}`);

  return (
    <Screen title="Tell people you're going" navTitle="Post" back={{ to: "/", label: "My week" }}>
      {postUrl && (
        <section className="section">
          <ul className="group">
            <li>
              <a className="cell lead-ico" href={postUrl} target="_blank" rel="noopener">
                <span className="ico green">
                  <Icon name="check" />
                </span>
                <div className="cellmain">
                  <span className="celltitle">Posted to LinkedIn</span>
                  <span className="cellsub">See your post</span>
                </div>
                <Icon name="out" className="chev" />
              </a>
            </li>
          </ul>
        </section>
      )}
      {error && !postUrl && (
        <p className="gfoot error post-banner" role="alert">
          {notPostedText(error)}
        </p>
      )}

      <section className="section">
        <h2 className="ghead">What to share</h2>
        <div className="seg" role="group" aria-label="What to share">
          <button type="button" aria-pressed={pick.kind === "week"} onClick={() => go({ kind: "week" })}>
            My week
          </button>
          <button type="button" aria-pressed={pick.kind === "day"} onClick={() => go({ kind: "day", day: firstDay })}>
            A day
          </button>
          <button type="button" aria-pressed={pick.kind === "sessions"} onClick={() => go({ kind: "sessions", sessionIds: [] })}>
            Sessions
          </button>
        </div>
        <p className="gfoot">Hidden sessions are never offered. Times are Las Vegas time{zoneOf(draft)}.</p>
      </section>

      {pick.kind === "day" && (
        <div className="days post-days" role="group" aria-label="Day">
          {draft.days.map((date) => {
            const chip = dayChip(date);
            return (
              <button key={date} type="button" className="day" aria-pressed={date === pick.day} aria-label={formatDate(date)} onClick={() => go({ kind: "day", day: date })}>
                <small>{chip.weekday}</small>
                <b>{chip.day}</b>
              </button>
            );
          })}
        </div>
      )}

      {pick.kind === "sessions" && (
        <section className="section">
          <ul className="group">
            {(listAll ? draft.offered : draft.offered.filter((session) => chosen.has(session.sessionId))).map((session) => (
              <li key={session.sessionId}>
                <button
                  className="cell"
                  type="button"
                  role="checkbox"
                  aria-checked={chosen.has(session.sessionId)}
                  onClick={() => toggle(session.sessionId)}
                >
                  <div className="cellmain">
                    <span className="celltitle">{session.title ?? session.code ?? "Session"}</span>
                    <span className="cellsub">
                      {[session.startsAt && `${formatDay(session.startsAt)}, ${session.isAllDay ? "all day" : formatTime(session.startsAt)}`, session.code]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                  <span className={chosen.has(session.sessionId) ? "pick on" : "pick"} aria-hidden="true">
                    {chosen.has(session.sessionId) && <Icon name="check" />}
                  </span>
                </button>
              </li>
            ))}
            {!listAll && (
              <li>
                <button className="cell" type="button" onClick={onChoose}>
                  <span className="cellmain">Choose sessions</span>
                  <span className="cellval">{draft.offered.length} on your week</span>
                  <Icon name="chev" className="chev" />
                </button>
              </li>
            )}
          </ul>
          <Foot failed={null}>{empty ? "Tick the sessions to tell people about." : `${chosen.size} chosen.`}</Foot>
        </section>
      )}

      {!empty && (
        <>
          <section className="section">
            <h2 className="ghead">The picture</h2>
            <figure className="post-pic">
              <img src={draft.imageUrl} alt="The picture that goes with your post" width={1200} height={627} />
            </figure>
          </section>

          <section className="section">
            <h2 className="ghead">
              <label htmlFor="post-text">The post</label>
            </h2>
            <div className="group">
              <textarea
                id="post-text"
                className="post-text"
                rows={10}
                maxLength={draft.maxLength}
                value={text}
                onChange={(e) => setText(e.currentTarget.value)}
              />
            </div>
            <p className="gfoot">
              {text.length.toLocaleString("en-US")} of {draft.maxLength.toLocaleString("en-US")} characters. Change it as you like; choosing other sessions writes a fresh suggestion.
            </p>
          </section>

          {!draft.linkPreviewShowsWeek && visibility !== "public" && (
            <div className="post-vis">
              <p className="gfoot">
                {visibility === "private" ? "Your week is private" : "Your week is for My network"}, so people who open the link see
                only your name. The picture still shows these sessions.
              </p>
              <WhoCanSee visibility={visibility} />
            </div>
          )}

          <section className="section">
            <h2 className="ghead">Posting</h2>
            <Foot failed={null}>
              {draft.direct.available
                ? "LinkedIn asks you to allow one post. Hallway posts this text and picture in your name, then forgets LinkedIn's permission."
                : draft.direct.reason === "no-linkedin-identity"
                  ? (
                      <>
                        To post from Hallway, <a href={`/api/auth/linkedin?link=1&returnTo=${linkHere}`}>add LinkedIn</a> as a way to sign in. Or
                        take it there yourself below.
                      </>
                    )
                  : "Hallway cannot post to LinkedIn for you here yet. Take it there yourself below."}
            </Foot>
          </section>

          <section className="section">
            <h2 className="ghead">Or take it to LinkedIn yourself</h2>
            <ul className="group">
              <li>
                <a className="cell action lead" href={draft.imageUrl} download="hallway-sessions.png">
                  <Icon name="photo" /> Save picture
                </a>
              </li>
              {draft.direct.available && (
                <li>
                  <a className="cell action lead" href={linkedInShareUrl(draft.pageUrl)} target="_blank" rel="noopener">
                    <Icon name="out" /> Open LinkedIn
                  </a>
                </li>
              )}
            </ul>
            <p className="gfoot">Open LinkedIn shares your page's link; copy the text, then paste it and add the picture in its post box.</p>
          </section>

          <div className="post-bar">
            <div className="btnrow">
              <button className="btn gray" type="button" onClick={() => void copy()}>
                <Icon name="copy" /> Copy text
              </button>
              {draft.direct.available ? (
                <button className="btn" type="button" disabled={busy || text.trim() === ""} onClick={() => void postToLinkedIn()}>
                  Post to LinkedIn
                </button>
              ) : (
                <a className="btn" href={linkedInShareUrl(draft.pageUrl)} target="_blank" rel="noopener">
                  Open LinkedIn <Icon name="out" />
                </a>
              )}
            </div>
            {failed ? (
              <Foot failed={failed} />
            ) : (
              <p className="gfoot" role="status">
                {note}
              </p>
            )}
          </div>
        </>
      )}
    </Screen>
  );
}

/** " (PST)", from the first timed session offered. */
function zoneOf(draft: PostDraft): string {
  const timed = draft.offered.find((s) => s.startsAt)?.startsAt;
  return timed ? ` (${zoneAbbreviation(timed)})` : "";
}
