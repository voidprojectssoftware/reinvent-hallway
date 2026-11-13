// A fake GitHub: its token endpoint (which, like GitHub's, refuses a bad code
// with 200 and an `error` field), `/user`, `/user/emails` and paged
// `/user/following`, so the real adapter (github-oauth.ts) runs unchanged in
// tests and nothing calls GitHub.
import { fakeOAuthServer, json, type FakeProvider } from "./fake-oauth-server.ts";
import { gitHubEndpoints } from "./github-oauth.ts";

export interface FakeGitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url?: string;
  /** The profile's public email, which the adapter must not rely on. */
  email?: string | null;
  emails: { email: string; primary: boolean; verified: boolean }[];
  following?: { id: number; login: string }[];
}

export type FakeGitHub = FakeProvider<FakeGitHubUser>;

export const fakeGitHub = (): FakeGitHub =>
  fakeOAuthServer("github", {
    tokenUrl: gitHubEndpoints.token,
    refusalStatus: 200,
    tokenExtras: () => ({ scope: "read:user,user:email" }),
    api(request, { emails, following = [], ...profile }) {
      if (!request.headers.get("user-agent")) return json({ message: "Request forbidden by administrative rules." }, 403);
      const url = new URL(request.url);
      if (url.origin !== gitHubEndpoints.api) return undefined;
      if (url.pathname === "/user") return json({ ...profile, email: profile.email ?? null });
      if (url.pathname === "/user/emails") return json(emails.map((entry) => ({ ...entry, visibility: null })));
      if (url.pathname === "/user/following") {
        const perPage = Number(url.searchParams.get("per_page") ?? 30);
        const page = Number(url.searchParams.get("page") ?? 1);
        return json(following.slice((page - 1) * perPage, page * perPage));
      }
      return undefined;
    },
  });
