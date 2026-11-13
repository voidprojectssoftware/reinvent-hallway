// "There is already a Hallway account for this email" (ADR 0018). Signing in
// with a provider whose verified email is already another account's neither
// signs in to that account nor makes a second one; the API sends the browser
// to /sign-in?error=account-exists&provider=<p>, and the sign-in screen sends
// it here. The page says so in plain words and offers the other ways in, so
// the person signs in the way they did before and adds this provider in
// Settings.
import { Link, useLoaderData } from "react-router";
import type { SignInOptions, SignInProvider } from "../api/client.ts";
import { Screen } from "../shell/Screen.tsx";
import { signInPath } from "../shell/signed-in.ts";
import { ProviderButtons } from "../signin/ProviderButtons.tsx";
import { isProvider, providerName } from "../signin/providers.ts";
import { signInOptionsFor } from "./SignIn.tsx";

export async function accountExistsLoader({ request }: { request: Request }): Promise<
  SignInOptions & { returnTo: string | null; provider: SignInProvider | null }
> {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  return { ...(await signInOptionsFor(url)), provider: isProvider(provider) ? provider : null };
}

export function AccountExists() {
  const { provider, providers, returnTo } = useLoaderData<typeof accountExistsLoader>();
  const name = provider ? providerName[provider] : "this provider";
  const others = providers.filter((other) => other !== provider);
  return (
    <Screen
      title="You already have an account"
      long
      sub={`There is already a Hallway account for the email on this ${provider ? `${name} account` : "account"}. Sign in the way you did before, then add ${name} in Settings.`}
    >
      <section className="section">
        <h2 className="ghead">Other ways to sign in</h2>
        {others.length > 0 ? (
          // Without a page to go back to, land in Settings, where adding
          // this provider is the next step.
          <ProviderButtons providers={others} returnTo={returnTo ?? "/settings"} />
        ) : (
          <div className="group">
            <p className="cell">This Hallway has no other way to sign in set up.</p>
          </div>
        )}
        <p className="gfoot">
          Hallway never joins two accounts because their emails match: a shared or reassigned address does not prove they belong to
          the same person.
        </p>
      </section>

      <section className="section">
        <ul className="group">
          <li>
            <Link className="cell action lead" to={signInPath(returnTo ?? "/")}>
              Back to sign-in
            </Link>
          </li>
        </ul>
      </section>
    </Screen>
  );
}
