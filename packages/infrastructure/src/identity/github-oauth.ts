// Sign in with GitHub. GitHub is OAuth 2, not OpenID Connect (ADR 0018): who
// signed in is `GET /user`, by its numeric id (a login can be renamed and
// reused); the email is `GET /user/emails` with GitHub's own `verified` flag,
// because the profile's email may be private or absent.
//
// While the token is in hand, the people this person follows are read too
// (`GET /user/following`), for #63's follows (ADR 0019). The token itself is
// dropped when `identify` returns: Hallway holds no credential to anyone's
// GitHub account.
import type { GitHubUser, IdentityProvider } from "@hallway/application";
import { getWithToken, oauthClient, type OAuthClient, type OAuthClientConfig } from "./oauth-client.ts";

export const gitHubEndpoints = {
  authorization: "https://github.com/login/oauth/authorize",
  token: "https://github.com/login/oauth/access_token",
  api: "https://api.github.com",
} as const;

/** 100 a page, GitHub's maximum. */
const followingPageSize = 100;
/**
 * A Worker may make 50 subrequests per request on the free plan; the token,
 * user and emails calls take three, so 40 pages (4,000 people followed) keeps
 * well inside it. Past that the list is cut short, not failed.
 */
export const maxFollowingPages = 40;

interface GitHubProfile {
  id?: unknown;
  login?: unknown;
  name?: unknown;
  avatar_url?: unknown;
}

interface GitHubEmail {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
}

// GitHub's REST API refuses a request without a User-Agent.
const apiHeaders = { accept: "application/vnd.github+json", "user-agent": "Hallway", "x-github-api-version": "2022-11-28" };

export function gitHubOAuth(config: OAuthClientConfig): IdentityProvider {
  const client = oauthClient("GitHub", gitHubEndpoints, "read:user user:email", config);
  const get = <T>(path: string, token: string) =>
    getWithToken<T>(client, "GitHub", `${gitHubEndpoints.api}${path}`, token, apiHeaders);
  return {
    authorizationUrl: client.authorizationUrl,
    async identify(input) {
      const token = await client.redeem(input);
      if (!token) return undefined;
      const profile = await get<GitHubProfile>("/user", token.accessToken);
      if (typeof profile.id !== "number" || typeof profile.login !== "string") return undefined;
      const email = verifiedEmail(await get<GitHubEmail[]>("/user/emails", token.accessToken));
      return {
        subject: String(profile.id),
        // GitHub's name may be null; the login stands in for it (ADR 0018).
        name: typeof profile.name === "string" && profile.name.trim() !== "" ? profile.name : profile.login,
        username: profile.login,
        ...(typeof profile.avatar_url === "string" && { picture: profile.avatar_url }),
        ...(email !== undefined && { email }),
        emailVerified: email !== undefined,
        following: await following(client, token.accessToken),
      };
    },
  };
}

/** The primary email if GitHub verified it, else the first verified one. An unverified email is not kept. */
function verifiedEmail(emails: GitHubEmail[]): string | undefined {
  const verified = emails.filter(
    (entry): entry is GitHubEmail & { email: string } => entry.verified === true && typeof entry.email === "string",
  );
  return (verified.find((entry) => entry.primary === true) ?? verified[0])?.email;
}

async function following(client: OAuthClient, accessToken: string): Promise<GitHubUser[]> {
  const found: GitHubUser[] = [];
  for (let page = 1; page <= maxFollowingPages; page += 1) {
    const users = await getWithToken<GitHubProfile[]>(
      client,
      "GitHub",
      `${gitHubEndpoints.api}/user/following?per_page=${followingPageSize}&page=${page}`,
      accessToken,
      apiHeaders,
    );
    for (const user of users) {
      if (typeof user.id === "number" && typeof user.login === "string") found.push({ id: String(user.id), login: user.login });
    }
    if (users.length < followingPageSize) break;
  }
  return found;
}
