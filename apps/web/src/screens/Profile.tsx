// My profile, behind the card at the top of Settings. The design links that
// card and draws nothing behind it, so this is the iOS grouped form: one
// field per row, the reason under the group, Save at the foot. Each field
// stops at the contract's length, and what the contract would refuse is said
// under the field's group before anything is sent (profile-form.ts).
import type { Me, UpdateProfileInput } from "@hallway/contracts";
import { useState, type FormEvent, type ReactNode } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { api } from "../api/client.ts";
import { profileLimits, profileProblems, type FieldProblems } from "../profile/profile-form.ts";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";

export function profileLoader({ request }: { request: Request }): Promise<Me> {
  return requireSignIn(api.me(), request);
}

export function Profile() {
  const me = useLoaderData<typeof profileLoader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [form, setForm] = useState({
    displayName: me.displayName,
    handle: me.handle,
    headline: me.headline ?? "",
    linkedinProfileUrl: me.linkedinProfileUrl ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [problems, setProblems] = useState<FieldProblems>({});

  const set = (field: keyof typeof form) => (e: { currentTarget: HTMLInputElement }) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  async function save(event?: FormEvent) {
    event?.preventDefault();
    setFailed(null);
    // An emptied optional field is cleared (null), not left as it was.
    const input: UpdateProfileInput = {
      displayName: form.displayName.trim(),
      handle: form.handle.trim(),
      headline: form.headline.trim() || null,
      linkedinProfileUrl: form.linkedinProfileUrl.trim() || null,
    };
    const found = profileProblems(input);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await api.updateProfile(input);
      // The frame's `me` too, so a handle just chosen stops the prompt and
      // the share sheet's nudge.
      await revalidator.revalidate();
      await navigate("/settings");
    } catch (failure) {
      setFailed({ failure, retry: () => void save() });
      setBusy(false);
    }
  }

  return (
    <Screen title="Profile" back={{ to: "/settings", label: "Settings" }}>
      <form onSubmit={save}>
        <section className="section">
          <ul className="group">
            <Row label="Name">
              <input
                className="field"
                name="displayName"
                autoComplete="name"
                required
                maxLength={profileLimits.displayName}
                aria-invalid={problems.displayName ? true : undefined}
                value={form.displayName}
                onChange={set("displayName")}
              />
            </Row>
            <Row label="Headline">
              <input
                className="field"
                name="headline"
                placeholder="Role, company"
                maxLength={profileLimits.headline}
                aria-invalid={problems.headline ? true : undefined}
                value={form.headline}
                onChange={set("headline")}
              />
            </Row>
          </ul>
          <FieldFoot problems={[problems.displayName, problems.headline]}>
            {me.verifiedName && `LinkedIn verified your name as ${me.verifiedName}.`}
          </FieldFoot>
        </section>

        <section className="section">
          <h2 className="ghead">Your link</h2>
          <ul className="group">
            <Row label="Handle">
              <input
                className="field"
                name="handle"
                autoCapitalize="none"
                spellCheck={false}
                required
                autoFocus={me.handlePlaceholder}
                aria-invalid={problems.handle ? true : undefined}
                value={form.handle}
                onChange={set("handle")}
              />
            </Row>
          </ul>
          {problems.handle ? (
            <FieldFoot problems={[problems.handle]} />
          ) : me.handlePlaceholder ? (
            <p className="gfoot">
              Hallway made /@{me.handle} because it could not make a link from your name. Choose one people will recognise: a-z, 0-9
              and hyphens, as LinkedIn and other sites show a link plainly only in those letters.
            </p>
          ) : (
            <p className="gfoot">
              Your page is /@{form.handle.trim() || me.handle}. Changing it breaks links you already shared.
            </p>
          )}
        </section>

        <section className="section">
          <h2 className="ghead">LinkedIn</h2>
          <ul className="group">
            <Row label="Profile URL">
              <input
                className="field"
                name="linkedinProfileUrl"
                type="url"
                inputMode="url"
                placeholder="https://www.linkedin.com/in/…"
                maxLength={profileLimits.linkedinProfileUrl}
                aria-invalid={problems.linkedinProfileUrl ? true : undefined}
                value={form.linkedinProfileUrl}
                onChange={set("linkedinProfileUrl")}
              />
            </Row>
          </ul>
          <FieldFoot problems={[problems.linkedinProfileUrl]}>Shown on your page as a link. Hallway does not check it.</FieldFoot>
        </section>

        <section className="section">
          <button className="btn block" type="submit" disabled={busy}>
            Save
          </button>
          <Foot failed={failed} />
        </section>
      </form>
    </Screen>
  );
}

/** A group's footer: what is wrong with its fields, in red, else its own words. */
function FieldFoot({ problems, children }: { problems: (string | undefined)[]; children?: ReactNode }) {
  const said = problems.filter(Boolean);
  return <Foot failed={said.length > 0 ? { failure: said.join(" ") } : null}>{children}</Foot>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li>
      <label className="cell">
        <span className="form-k">{label}</span>
        {children}
      </label>
    </li>
  );
}
