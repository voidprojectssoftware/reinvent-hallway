// The LinkedIn Connections.csv upload (settings.html, "LinkedIn connections"),
// on Settings and, until there is a first import, on Network. It says what
// Hallway keeps (ADR 0004) and how to get the file from LinkedIn, because the
// file is about people who never signed up.
import { maxContactsCsvBytes, type ContactImport } from "@hallway/contracts";
import { useId, useState, type ChangeEvent } from "react";
import { useRevalidator } from "react-router";
import { api } from "../api/client.ts";
import { Foot, failureText } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { formatDate, eventDate } from "../time.ts";

export function ContactsImport({ last }: { last: ContactImport | undefined }) {
  const revalidator = useRevalidator();
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setError(null);
    setDone(null);
    if (file.size > maxContactsCsvBytes) {
      setError(`That file is ${Math.round(file.size / 1_000_000)} MB. LinkedIn's Connections.csv is far smaller: check it is the right file.`);
      return;
    }
    setBusy(true);
    try {
      const kept = await api.importContacts(await file.text());
      await revalidator.revalidate();
      setDone(`Imported: ${kept.count === 1 ? "1 contact" : `${kept.count} contacts`} kept.`);
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section">
      <h2 className="ghead">LinkedIn connections</h2>
      <ul className="group">
        {last && (
          <li>
            <div className="cell lead-ico">
              <span className="ico blue">
                <Icon name="doc" />
              </span>
              <div className="cellmain">
                <span>Connections.csv</span>
                <span className="cellsub">
                  {last.count === 1 ? "1 contact" : `${last.count} contacts`}, imported {formatDate(eventDate(last.importedAt))}
                </span>
              </div>
            </div>
          </li>
        )}
        <li>
          {/* A label styled as the action row opens the file picker; the input itself is visually hidden. */}
          <label className={busy ? "cell action lead busy" : "cell action lead"} htmlFor={inputId}>
            {busy ? "Importing…" : last ? "Import a new file" : "Import Connections.csv"}
          </label>
          <input id={inputId} className="vh" type="file" accept=".csv,text/csv" disabled={busy} onChange={upload} />
        </li>
      </ul>
      <Foot error={error}>
        {done && `${done} `}
        From LinkedIn: Settings, Data privacy, Get a copy of your data, Connections. Hallway keeps each contact's profile link, name and a
        one-way hash of the email, to find them here, and drops the rest.
      </Foot>
    </section>
  );
}
