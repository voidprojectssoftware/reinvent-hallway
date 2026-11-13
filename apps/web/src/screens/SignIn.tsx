// Sign in: LinkedIn, and on a developer's machine a dev sign-in by name.
// Each shows only when the API says it is on (GET /api/auth/options), so a
// build served anywhere else never offers dev sign-in, and a server without
// LinkedIn credentials never offers a button that answers 404. A failed or
// missing answer counts as both off.
//
// A page that sends someone here to sign in names itself in `?returnTo=`
// (a person's page, a session): both ways of signing in land back there, and
// someone already signed in goes straight there (`returnPathOf`).
import { useState, type FormEvent } from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import { api, ApiFailure, linkedInSignInHref, type SignInOptions } from "../api/client.ts";
import { Empty } from "../shell/Empty.tsx";
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

export function SignIn() {
  const { devSignIn, linkedIn, returnTo } = useLoaderData<typeof signInLoader>();
  return (
    <Screen title="Hallway" sub="See where the people you know will be at re:Invent 2026, and let your agent plan around them.">
      {linkedIn && (
        <section className="section">
          <a className="btn block" href={linkedInSignInHref(returnTo)}>
            Sign in with LinkedIn
          </a>
          <p className="gfoot">Hallway gets your name, picture and email from LinkedIn. Never your connections or your posts.</p>
        </section>
      )}

      {devSignIn && <DevSignIn returnTo={returnTo} />}

      {!linkedIn && !devSignIn && (
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
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.devSignIn(name.trim());
      await navigate(returnTo ?? "/");
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : String(failure));
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
      {error ? (
        <p className="gfoot error" role="alert">
          {error}
        </p>
      ) : (
        <p className="gfoot">Only on this machine: the API has dev sign-in on (DEV_SIGN_IN=1 in apps/api/.dev.vars).</p>
      )}
    </form>
  );
}
