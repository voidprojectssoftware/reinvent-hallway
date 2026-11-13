// The provider sign-in buttons, one per provider the server offers, in the
// order it gives (Google, Microsoft, LinkedIn, GitHub). Each is drawn to its
// provider's published button: its name ("Sign in with Google"), its mark,
// its colors (app.css, .pbtn). They differ from Hallway's own buttons on
// purpose: a person looks for the button they know.
import { signInHref, type SignInProvider } from "../api/client.ts";
import { ProviderMark } from "./ProviderMark.tsx";
import { providerName } from "./providers.ts";

export function ProviderButtons({ providers, returnTo }: { providers: readonly SignInProvider[]; returnTo: string | null }) {
  return (
    <div className="pbtns">
      {providers.map((provider) => (
        <a key={provider} className={`pbtn ${provider}`} href={signInHref(provider, returnTo)}>
          <ProviderMark provider={provider} className="pmark" />
          Sign in with {providerName[provider]}
        </a>
      ))}
    </div>
  );
}
