// My profile, behind the card at the top of Settings. The design links that
// card and draws nothing behind it, so this is the iOS grouped form: one
// field per row, the reason under the group, Save at the foot.
import type { Me, UpdateProfileInput } from "@hallway/contracts";
import { useState, type FormEvent, type ReactNode } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { api } from "../api/client.ts";
import { Foot, failureText } from "../shell/Foot.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";

export function profileLoader(): Promise<Me> {
  return requireSignIn(api.me());
}

export function Profile() {
  const me = useLoaderData<typeof profileLoader>();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    displayName: me.displayName,
    handle: me.handle,
    headline: me.headline ?? "",
    linkedinProfileUrl: me.linkedinProfileUrl ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (field: keyof typeof form) => (e: { currentTarget: HTMLInputElement }) => {
    const value = e.currentTarget.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // An emptied optional field is cleared (null), not left as it was.
    const input: UpdateProfileInput = {
      displayName: form.displayName.trim(),
      handle: form.handle.trim(),
      headline: form.headline.trim() || null,
      linkedinProfileUrl: form.linkedinProfileUrl.trim() || null,
    };
    try {
      await api.updateProfile(input);
      await navigate("/settings");
    } catch (failure) {
      setError(failureText(failure));
      setBusy(false);
    }
  }

  return (
    <Screen title="Profile" back={{ to: "/settings", label: "Settings" }}>
      <form onSubmit={save}>
        <section className="section">
          <ul className="group">
            <Row label="Name">
              <input className="field" name="displayName" autoComplete="name" required value={form.displayName} onChange={set("displayName")} />
            </Row>
            <Row label="Headline">
              <input className="field" name="headline" placeholder="Role, company" value={form.headline} onChange={set("headline")} />
            </Row>
          </ul>
          {me.verifiedName && <p className="gfoot">LinkedIn verified your name as {me.verifiedName}.</p>}
        </section>

        <section className="section">
          <h2 className="ghead">Your link</h2>
          <ul className="group">
            <Row label="Handle">
              <input className="field" name="handle" autoCapitalize="none" spellCheck={false} required value={form.handle} onChange={set("handle")} />
            </Row>
          </ul>
          <p className="gfoot">
            Your page is /@{form.handle.trim() || me.handle}. Changing it breaks links you already shared.
          </p>
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
                value={form.linkedinProfileUrl}
                onChange={set("linkedinProfileUrl")}
              />
            </Row>
          </ul>
          <p className="gfoot">Shown on your page as a link. Hallway does not check it.</p>
        </section>

        <section className="section">
          <button className="btn block" type="submit" disabled={busy}>
            Save
          </button>
          <Foot error={error} />
        </section>
      </form>
    </Screen>
  );
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
