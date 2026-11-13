// Settings, "Sign-in methods" (ADR 0018): the providers I sign in with, Add
// for each other one the server has set up, Remove while another remains.
// Adding is a round trip to the provider with `link=1`, back to /settings;
// a refused one comes back with `?error=<kind>&provider=<p>`, said in this
// section's footer. The server holds the last-one rule (409); the screen
// only stops offering Remove on the last one.
import type { Identity } from "@hallway/contracts";
import { signInProviders } from "@hallway/contracts";
import { useEffect, useRef, useState } from "react";
import { useLocation, useRevalidator } from "react-router";
import { api, signInHref, type SignInProvider } from "../api/client.ts";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { ProviderMark } from "../signin/ProviderMark.tsx";
import { linkRefusalText, providerName, refusalOf } from "../signin/providers.ts";

const settingsPath = "/settings";

export function SignInMethods({ identities, offered }: { identities: Identity[]; offered: readonly SignInProvider[] }) {
  const revalidator = useRevalidator();
  const here = useLocation();
  const [failed, setFailed] = useState<Failed | null>(() => {
    const refusal = refusalOf(new URL(here.pathname + here.search, window.location.origin));
    return refusal && { failure: linkRefusalText(refusal) };
  });
  const [busy, setBusy] = useState(false);
  // Back from a refused Add, the page opens at the top and this section is
  // well below the fold on a phone: bring the refusal into view.
  const section = useRef<HTMLElement>(null);
  const cameBackRefused = useRef(failed !== null);
  useEffect(() => {
    if (cameBackRefused.current) section.current?.scrollIntoView({ block: "center" });
  }, []);

  const linked = new Map(identities.map((identity) => [identity.provider, identity]));
  // Every provider I have, set up here or not (so one switched off can still
  // be removed), then each one the server offers that I could add.
  const rows = signInProviders.filter((provider) => linked.has(provider) || offered.includes(provider));
  const dev = linked.get("dev");
  const canRemove = identities.length > 1;

  async function remove(provider: SignInProvider) {
    if (!window.confirm(`Stop signing in with ${providerName[provider]}? You can add it again later.`)) return;
    setFailed(null);
    setBusy(true);
    try {
      await api.unlinkIdentity(provider);
      await revalidator.revalidate();
    } catch (failure) {
      setFailed({ failure, retry: () => void remove(provider) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" ref={section}>
      <h2 className="ghead">Sign-in methods</h2>
      <ul className="group">
        {rows.map((provider) => {
          const identity = linked.get(provider);
          return (
            <li key={provider}>
              <div className="cell lead-ico">
                <span className={`ico brand ${provider}`}>
                  <ProviderMark provider={provider} />
                </span>
                <div className="cellmain">
                  <span>{providerName[provider]}</span>
                  <span className="cellsub">{identity ? describe(identity) : "Not added"}</span>
                </div>
                {identity
                  ? canRemove && (
                      <button className="minibtn" type="button" disabled={busy} onClick={() => remove(provider)}>
                        Remove
                      </button>
                    )
                  : offered.includes(provider) && (
                      <a className="minibtn" href={signInHref(provider, settingsPath, true)} aria-label={`Add ${providerName[provider]}`}>
                        Add
                      </a>
                    )}
              </div>
            </li>
          );
        })}
        {dev && (
          <li>
            <div className="cell lead-ico">
              <span className="ico gray">
                <Icon name="key" />
              </span>
              <div className="cellmain">
                <span>Dev sign-in</span>
                <span className="cellsub">This machine only</span>
              </div>
            </div>
          </li>
        )}
      </ul>
      <Foot failed={failed}>
        {canRemove
          ? "Sign in with any of these. Removing one does not touch the account at the provider."
          : "Your only way to sign in cannot be removed. Add another first if you want to switch."}
      </Foot>
    </section>
  );
}

/**
 * Which account it is: the GitHub login, else the email the provider gave.
 * Not when it was added: on a phone that pushed each row to three lines.
 */
function describe(identity: Identity): string {
  return identity.username ? `@${identity.username}` : (identity.email ?? "Added");
}
