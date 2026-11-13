// The fake LinkedIn as a local web server (`npm run fake:linkedin`, ADR
// 0026), so a person or playwright-cli can drive sign-in and posting end to
// end against `npm run dev` without anything reaching LinkedIn. The Worker
// sends every LinkedIn address here when LINKEDIN_FAKE_URL is set with dev
// sign-in on (apps/api/src/index.ts).
//
// It adds what fake-linkedin.ts leaves out because tests never need it: a
// consent page a browser can click through, and a feed page showing every
// post with its picture, which is the evidence that a post went out.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fakeLinkedIn, type FakeLinkedIn } from "./fake-linkedin.ts";
import { linkedInEndpoints } from "./linkedin-oidc.ts";

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
/** Little text as LinkedIn shows it: the escapes gone. */
const shown = (commentary: string) => commentary.replace(/\\(.)/g, "$1");

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>
body{font:16px/1.45 system-ui,sans-serif;margin:0;background:#f4f2ee;color:#191919}
header{background:#fff;border-bottom:1px solid #ddd;padding:12px 16px;font-weight:700;color:#0a66c2}
main{max-width:620px;margin:16px auto;padding:0 16px}
.card{background:#fff;border:1px solid #ddd;border-radius:10px;padding:16px;margin-bottom:16px}
.card img{width:100%;height:auto;border-radius:6px;margin-top:12px;display:block}
pre{white-space:pre-wrap;font:inherit;margin:8px 0 0}
label{display:block;margin:12px 0 4px;font-weight:600}
input{font:inherit;padding:8px;width:100%;box-sizing:border-box}
button{font:inherit;padding:10px 18px;border-radius:20px;border:1px solid #0a66c2;margin:16px 8px 0 0;cursor:pointer}
.go{background:#0a66c2;color:#fff}.no{background:#fff;color:#0a66c2}
.meta{color:#666;font-size:14px}
</style></head><body><header>Fake LinkedIn (local, nothing leaves this machine)</header><main>${body}</main></body></html>`;

/** Each real LinkedIn address the adapters call, moved back from this server's origin so the fake recognises it. */
function linkedInUrl(path: string, origin: string): string {
  if (path.startsWith("/oauth/")) return new URL(path, new URL(linkedInEndpoints.token).origin).href;
  if (path.startsWith("/v2/") || path.startsWith("/rest/")) return new URL(path, new URL(linkedInEndpoints.userinfo).origin).href;
  return new URL(path, origin).href;
}

async function body(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

export interface FakeLinkedInServer {
  origin: string;
  linkedIn: FakeLinkedIn;
  close(): Promise<void>;
}

export async function startFakeLinkedInServer(port = 0): Promise<FakeLinkedInServer> {
  let origin = "";
  let linkedIn: FakeLinkedIn | undefined;

  const handle = async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", origin);
    const send = (status: number, html: string) => {
      response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
    };
    const fake = linkedIn!;

    if (url.pathname === "/oauth/v2/authorization") {
      const q = url.searchParams;
      const hidden = ["redirect_uri", "state"].map((n) => `<input type="hidden" name="${n}" value="${escape(q.get(n) ?? "")}">`).join("");
      const asks = (q.get("scope") ?? "").split(/[ ,]+/).filter(Boolean);
      return send(
        200,
        page(
          "Fake LinkedIn: allow access",
          `<form class="card" action="/fake/consent" method="get">${hidden}
<h1 style="font-size:20px;margin:0">Allow Hallway to use your LinkedIn account?</h1>
<p class="meta">Hallway asks for: ${asks.map((s) => `<code>${escape(s)}</code>`).join(", ")}${asks.includes("w_member_social") ? ". It wants to post once in your name." : "."}</p>
<label for="name">Your name</label><input id="name" name="name" value="Blake Hastings">
<label for="sub">Your LinkedIn member id (sub)</label><input id="sub" name="sub" value="li-blake">
<button class="go" type="submit" name="decision" value="allow">Allow</button><button class="no" type="submit" name="decision" value="cancel">Cancel</button>
</form>`,
        ),
      );
    }

    if (url.pathname === "/fake/consent") {
      const q = url.searchParams;
      const back = new URL(q.get("redirect_uri") ?? "");
      back.searchParams.set("state", q.get("state") ?? "");
      if (q.get("decision") === "allow") {
        back.searchParams.set("code", fake.issueCode({ sub: q.get("sub") ?? "li-blake", name: q.get("name") ?? "Blake Hastings" }, back.origin + back.pathname));
      } else {
        back.searchParams.set("error", "user_cancelled_authorize");
      }
      response.writeHead(302, { location: back.href });
      return response.end();
    }

    const image = /^\/fake\/images\/(\d+)\.png$/.exec(url.pathname);
    if (image) {
      const bytes = fake.images[Number(image[1]) - 1]?.bytes;
      if (!bytes) return send(404, page("No image", "<p>No such image.</p>"));
      response.writeHead(200, { "content-type": "image/png" });
      return response.end(Buffer.from(bytes));
    }

    if (url.pathname === "/" || url.pathname.startsWith("/feed/update/")) {
      const posts = [...fake.posts].reverse();
      const cards = posts.map((post) => {
        const n = fake.images.findIndex((i) => i.urn === post.imageUrn) + 1;
        return `<article class="card" id="${escape(post.urn)}"><div class="meta">${escape(post.author)} · ${escape(post.urn)}</div>
<pre>${escape(shown(post.commentary))}</pre><img src="/fake/images/${n}.png" alt="${escape(post.altText ?? "")}" width="1200" height="627"></article>`;
      });
      return send(200, page("Fake LinkedIn: feed", cards.join("") || `<p class="card">Nothing posted yet.</p>`));
    }

    // An adapter's call: hand it to the fake as the LinkedIn address it stands for.
    const sent = request.method === "GET" || request.method === "HEAD" ? undefined : await body(request);
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value);
    const answer = await fake.fetch(linkedInUrl(`${url.pathname}${url.search}`, origin), {
      method: request.method ?? "GET",
      headers,
      ...(sent && { body: new Uint8Array(sent) }),
    });
    response.writeHead(answer.status, Object.fromEntries(answer.headers));
    response.end(Buffer.from(await answer.arrayBuffer()));
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((failure: unknown) => {
      console.error(failure);
      response.writeHead(500).end();
    });
  });
  await new Promise<void>((done) => server.listen(port, "127.0.0.1", done));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`;
  linkedIn = fakeLinkedIn({ uploadBase: `${origin}/dms-uploads/fake/` });
  return { origin, linkedIn, close: () => new Promise((done) => server.close(() => done())) };
}
