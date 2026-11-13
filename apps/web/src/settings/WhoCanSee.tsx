// Who can see my week: the three-way switch from Settings (settings.html),
// also offered in the share sheet, where what it decides is what a posted
// link's preview shows.
import type { Visibility } from "@hallway/contracts";
import { useId, useState } from "react";
import { useRevalidator } from "react-router";
import { api } from "../api/client.ts";
import { Foot, type Failed } from "../shell/Foot.tsx";

const choices: { value: Visibility; label: string; explain: string }[] = [
  { value: "public", label: "Anyone", explain: "Anyone with your link sees your sessions. Hidden sessions stay yours alone." },
  {
    value: "network",
    label: "My network",
    explain:
      'Your connections and the people you follow on GitHub or from your LinkedIn import see your sessions and you in "who is going". Following you does not let anyone in. Hidden sessions stay yours alone.',
  },
  { value: "private", label: "Only me", explain: "No one else sees your sessions or counts you as going." },
];

interface WhoCanSeeProps {
  visibility: Visibility;
  /** After a change has been saved and the screen re-read. */
  onChanged?: () => void;
}

export function WhoCanSee({ visibility, onChanged }: WhoCanSeeProps) {
  const revalidator = useRevalidator();
  const [failed, setFailed] = useState<Failed | null>(null);
  const [pending, setPending] = useState<Visibility | null>(null);
  const shown = pending ?? visibility;
  const headingId = useId();

  async function choose(value: Visibility) {
    setPending(value);
    setFailed(null);
    try {
      await api.setVisibility(value);
      await revalidator.revalidate();
      onChanged?.();
    } catch (failure) {
      setFailed({ failure, retry: () => void choose(value) });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="section">
      <h2 className="ghead" id={headingId}>
        Who can see my week
      </h2>
      <div className="seg" role="group" aria-labelledby={headingId}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            type="button"
            aria-pressed={choice.value === shown}
            disabled={pending !== null}
            onClick={() => choose(choice.value)}
          >
            {choice.label}
          </button>
        ))}
      </div>
      <Foot failed={failed}>{choices.find((choice) => choice.value === shown)?.explain}</Foot>
    </section>
  );
}
