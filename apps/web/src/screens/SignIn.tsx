// Sign in: LinkedIn, and on a developer's machine a dev sign-in by name.
// Each shows only when the API says it is on (GET /api/auth/options), so a
// build served anywhere else never offers dev sign-in, and a server without
// LinkedIn credentials never offers a button that answers 404. A failed or
// missing answer counts as both off.
//
// A page that sends someone here to sign in names itself in `?returnTo=`
// (a person's page, a session): both ways of signing in land back there, and
// someone already signed in goes straight there (`returnPathOf`).
//
// The provider buttons are a list drawn from the options, so a provider the
// server adds is one more row in `providers`, not another branch here.
import { useState, type FormEvent } from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { api, linkedInSignInHref, type SignInOptions } from "../api/client.ts";
import { Empty } from "../shell/Empty.tsx";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { Screen } from "../shell/Screen.tsx";
import { ifSignedIn, returnPathOf } from "../shell/signed-in.ts";

export async function signInLoader({ request }: { request: Request }): Promise<SignInOptions & { returnTo: string | null }> {
  const returnTo = returnPathOf(new URL(request.url));
  const [me, options] = await Promise.all([
    ifSignedIn(api.me()).catch(() => null),
    api.signInOptions().catch(() => ({ devSignIn: false, providers: [], linkedIn: false })),
  ]);
  if (me) throw redirect(returnTo ?? "/");
  return { ...options, returnTo };
}

/** Each way to sign in that leaves for a provider, when the server says it is on. */
const providers: { on: (options: SignInOptions) => boolean; label: string; href: (returnTo: string | null) => string; note: string }[] = [
  {
    on: (options) => options.linkedIn,
    label: "Sign in with LinkedIn",
    href: linkedInSignInHref,
    note: "Hallway gets your name, picture and email from LinkedIn. Never your connections or your posts.",
  },
];

export function SignIn() {
  const { returnTo, ...options } = useLoaderData<typeof signInLoader>();
  const offered = providers.filter((provider) => provider.on(options));
  return (
    <Screen
      title="Hallway"
      sub={
        returnTo
          ? "Sign in and you go straight back to the page you were on."
          : "See where the people you know will be at re:Invent 2026, and let your agent plan around them."
      }
    >
      {offered.map((provider) => (
        <section className="section" key={provider.label}>
          <a className="btn block" href={provider.href(returnTo)}>
            {provider.label}
          </a>
          <p className="gfoot">{provider.note}</p>
        </section>
      ))}

      {options.devSignIn && <DevSignIn returnTo={returnTo} />}

      {offered.length === 0 && !options.devSignIn && (
        <Empty icon="lock" title="Signing in is not open yet">
          This Hallway has no way to sign in set up. Try again later.
        </Empty>
      )}
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
