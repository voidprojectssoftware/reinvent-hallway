// Sign in: one button per provider the server has set up (Google, Microsoft,
// LinkedIn, GitHub, in that order: GET /api/auth/options), and on a
// developer's machine a dev sign-in by name. Each shows only when the API
// says it is on, so a build served anywhere else never offers dev sign-in,
// and a provider without credentials never offers a button that answers 404.
// A failed or missing answer counts as all off.
//
// A page that sends someone here to sign in names itself in `?returnTo=`
// (a person's page, a session): every way of signing in lands back there,
// and someone already signed in goes straight there (`returnPathOf`).
//
// A provider that refused comes back here with `?error=<kind>&provider=<p>`
// (ADR 0018), said under the buttons; `account-exists` has its own page.
import { useState, type FormEvent } from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { api, type SignInOptions } from "../api/client.ts";
import { ProviderButtons } from "../signin/ProviderButtons.tsx";
import { refusalOf, signInRefusalText, type Refusal } from "../signin/providers.ts";
import { Empty } from "../shell/Empty.tsx";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { MadeBy } from "../shell/MadeBy.tsx";
import { Screen } from "../shell/Screen.tsx";
import { ifSignedIn, returnPathOf } from "../shell/signed-in.ts";

const noOptions: SignInOptions = { devSignIn: false, providers: [], linkedIn: false };

/** What both sign-in screens need: the options, where to go back to, and who is signed in already. */
export async function signInOptionsFor(url: URL): Promise<SignInOptions & { returnTo: string | null }> {
  const returnTo = returnPathOf(url);
  const [me, options] = await Promise.all([ifSignedIn(api.me()).catch(() => null), api.signInOptions().catch(() => noOptions)]);
  if (me) throw redirect(returnTo ?? "/");
  return { ...options, returnTo };
}

export async function signInLoader({ request }: { request: Request }): Promise<
  SignInOptions & { returnTo: string | null; refusal: Refusal | null }
> {
  const url = new URL(request.url);
  const refusal = refusalOf(url);
  if (refusal?.kind === "account-exists") {
    const next = new URLSearchParams();
    if (refusal.provider) next.set("provider", refusal.provider);
    const returnTo = returnPathOf(url);
    if (returnTo) next.set("returnTo", returnTo);
    throw redirect(`/sign-in/account-exists${next.size > 0 ? `?${next}` : ""}`);
  }
  return { ...(await signInOptionsFor(url)), refusal };
}

export function SignIn() {
  const { returnTo, refusal, providers, devSignIn } = useLoaderData<typeof signInLoader>();
  return (
    <Screen
      title="Hallway"
      sub={
        returnTo
          ? "Sign in and you go straight back to the page you were on."
          : "See where the people you know will be at re:Invent 2026, and let your agent plan around them."
      }
    >
      {providers.length > 0 && (
        <section className="section">
          <ProviderButtons providers={providers} returnTo={returnTo} />
          <Foot failed={refusal && { failure: signInRefusalText(refusal) }}>
            Hallway gets your name, picture and email from the account you choose
            {providers.includes("github") && ", and from GitHub who you follow there"}. Never your posts or your contacts.
          </Foot>
        </section>
      )}

      {devSignIn && <DevSignIn returnTo={returnTo} />}

      {providers.length === 0 && !devSignIn && (
        <Empty icon="lock" title="Signing in is not open yet">
          This Hallway has no way to sign in set up. Try again later.
        </Empty>
      )}

      <MadeBy />
    </Screen>
  );
}

function DevSignIn({ returnTo }: { returnTo: string | null }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [failed, setFailed] = useState<Failed | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      await api.devSignIn(name.trim());
      // In place of the sign-in screen, so Back from where I land does not
      // come here again (and the back button names where I was before).
      await navigate(returnTo ?? "/", { replace: true });
    } catch (failure) {
      setFailed({ failure, retry: () => void submit() });
      setBusy(false);
    }
  }

  return (
    <form className="section" onSubmit={submit}>
      <h2 className="ghead">Dev sign-in</h2>
      <div className="group">
        <label className="cell">
          <span className="vh">Name</span>
          <input
            className="field"
            name="name"
            placeholder="Your name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <button className="cell action lead" type="submit" disabled={busy || name.trim() === ""}>
          Sign in as this name
        </button>
      </div>
      <Foot failed={failed}>Only on this machine: the API has dev sign-in on (DEV_SIGN_IN=1 in apps/api/.dev.vars).</Foot>
    </form>
  );
}
