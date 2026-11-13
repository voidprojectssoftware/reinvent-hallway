# 0026. Posting my sessions to LinkedIn, and the owner's picture apart from the public card

Date: 2026-11-13. Status: accepted. Issue #78; fixes #70. Amends ADR 0012
("The share card follows the asker").

The owner, 2026-11-13: "What about if a person wants to make the sessions they
are going to known on linked in from our system?" #78's decisions settled the
product; these are the choices the build made.

## The composer

`/share/post` (web) over `GET /api/me/share/post`: the whole week, one day
(`day`) or chosen sessions (`session`, repeated). The text is prefilled by one
domain function, `postText` (`packages/domain/src/post.ts`): an opening line,
one line per session (title, code, day and time in Las Vegas time, venue) and
the `/@handle` link, cut with "and N more" so it stays within LinkedIn's
3,000 characters with the link kept. It reads only a session's place and time,
so no abstract can be in it (ADR 0025). The selection is taken from
`shareableEntries`, so a hidden session is never offered and is refused by id.
Reached from the share sheet and from a session on my week ("Tell people
you're going").

## Posting: one consent, one post, no token kept

- **A separate OAuth round trip asking `openid profile w_member_social`**, not
  a scope added to sign-in. Sign-in stays minimal, and the person sees exactly
  what this consent is for when they ask to post.
- **The draft waits on the server, keyed by the SHA-256 of the round trip's
  state, for ten minutes, and is taken once** (`linkedin_post_drafts`, one
  delete-returning statement on D1). A draft nobody came back for is cleared by
  the next one put. The text is up to 3,000 characters, too big for the
  state cookie, and a server copy cannot be edited between consent and post.
- **Its own cookie and callback**: `hallway_post_state` (state and the composer
  path to return to, HttpOnly, Lax, ten minutes, scoped to
  `/api/me/share/post/callback`), so it never meets a sign-in's cookie. The
  callback refuses (posting nothing) unless the state matches the cookie, the
  draft is still waiting, the person signed in is the one who wrote it, and
  LinkedIn's `sub` for the consent is the LinkedIn identity they linked.
- **Then, in the callback**: draw the picture from the week as it is now,
  `initializeUpload`, PUT the bytes to the URL it returned (only if that URL is
  LinkedIn's own host, since it carries the token), create the post with the
  `LinkedIn-Version` and Rest.li 2.0 headers, commentary escaped as LinkedIn's
  little text. The token lives in the adapter's closure (`LinkedInMember`) and
  is never written anywhere; when the callback returns it is gone, as GitHub's
  is (ADR 0019).
- **The browser comes back to the composer** with `posted=<post URN>` or
  `error=<kind>`. The tab keeps the person's text in `sessionStorage` while
  away, so a refusal returns to their words.
- **A person at the keyboard only**: every route refuses an agent token
  (`personAtKeyboard`), and no MCP tool posts.
- **Off unless `LINKEDIN_POSTING=1`.** The Share on LinkedIn product may need
  LinkedIn's approval (#18); until the app has it, the composer offers only the
  fallback (copy the text, save the picture, LinkedIn's share-offsite dialog on
  the page link), which needs no LinkedIn app at all.

## The owner's picture has its own address (#70)

`/og/{handle}.png` is now **always the anonymous card**, whatever cookie or
token comes with the request, so one URL is one picture and caching it by URL
is safe. The owner's own picture of a selection is `GET
/api/me/share-image.png` (`day`, `session`), a person at the keyboard only,
`private, no-store`. `ShareLinks` gains `myImageUrl` (absent for an agent
token); `imageUrl` keeps meaning the link preview's card. The share sheet shows
both as plain `<img>`s and drops the credential-less blob fetch. Held by
`apps/api/src/sharing.test.ts` ("no image URL gives the owner's week to anyone
else"): every image URL the owner is handed, fetched without credentials,
answers the stranger's card or 401, never the owner's week, and the owner's own
request to an `/og/` URL answers the same bytes a stranger gets.

## A fake LinkedIn to drive it locally

`npm run fake:linkedin` serves the test fake over HTTP with a consent page and
a feed page that shows each post with its picture. With dev sign-in on,
`LINKEDIN_FAKE_URL` points every LinkedIn address of the Worker at it, so
sign-in, linking and posting run end to end under `npm run dev` without
anything reaching LinkedIn.

Rejected: adding `w_member_social` to sign-in and keeping the token (a stored
credential to post as someone, for one post a week); holding the draft in the
browser and sending it back through the callback (it would have to travel
through LinkedIn or a cookie, and could be changed after consent); `Vary:
Cookie` on one `/og/` URL (a cache that ignores Vary, or keys before the
Worker, would still mix them, and the web still needed a workaround to show
both).
