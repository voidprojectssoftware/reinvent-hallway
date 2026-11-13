// Connect your agent (docs/design/connect-agent.html): the import path
// (domain.md, "Constraints"). The attendee's own agent reads AWS and writes
// here, so this screen hands them three things to paste: the AWS Events MCP
// server, Hallway's /mcp with a fresh token, and the prompt. The token's
// secret is in the one answer that issues it and nowhere after (ADR 0008),
// so it lives in this screen's state and is gone on reload.
import type { IssuedAgentToken, MySchedule } from "@hallway/contracts";
import { useState, type FormEvent } from "react";
import { Link, useLoaderData } from "react-router";
import { api } from "../api/client.ts";
import { copyText } from "../copy.ts";
import { EVENT_ID } from "../event.ts";
import { Foot, failureText } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";

export function connectAgentLoader(): Promise<MySchedule> {
  return requireSignIn(api.mySchedule(EVENT_ID));
}

const AWS_EVENTS_MCP = "https://api.awsevents.com/mcp";
const PROMPT = "Put my re:Invent 2026 schedule on Hallway.";

type Agent = "claude" | "kiro";

const agents: Record<Agent, { name: string; label: string; awsSetup: string; hallwaySetup: (url: string, secret: string) => string; where: string }> = {
  claude: {
    name: "Claude Code",
    label: "Claude Code on laptop",
    awsSetup: `claude mcp add --transport http \\\n  aws-events ${AWS_EVENTS_MCP}`,
    hallwaySetup: (url, secret) =>
      `claude mcp add --transport http \\\n  hallway ${url} \\\n  --header "Authorization: Bearer ${secret}"`,
    where: "Run it in a terminal.",
  },
  kiro: {
    name: "Kiro",
    label: "Kiro on laptop",
    awsSetup: kiroConfig({ "aws-events": { url: AWS_EVENTS_MCP } }),
    hallwaySetup: (url, secret) => kiroConfig({ hallway: { url, headers: { Authorization: `Bearer ${secret}` } } }),
    where: "Add it under mcpServers in ~/.kiro/settings/mcp.json (or .kiro/settings/mcp.json in one workspace).",
  },
};

function kiroConfig(servers: Record<string, unknown>): string {
  return JSON.stringify({ mcpServers: servers }, null, 2);
}

export function ConnectAgent() {
  const schedule = useLoaderData<typeof connectAgentLoader>();
  const [agent, setAgent] = useState<Agent>("claude");
  const [issued, setIssued] = useState<IssuedAgentToken | null>(null);
  const chosen = agents[agent];

  return (
    <Screen
      title="Connect your agent"
      long
      sub="Your AI agent reads your re:Invent favorites and reservations from AWS and puts them here. Hallway never sees your AWS sign-in."
    >
      <section className="section">
        <div className="seg" role="group" aria-label="Your agent">
          {(Object.keys(agents) as Agent[]).map((key) => (
            <button key={key} type="button" aria-pressed={key === agent} onClick={() => setAgent(key)}>
              {agents[key].name}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="ghead">1. Add the AWS Events MCP server</h2>
        <div className="group">
          <pre className="codebox">{chosen.awsSetup}</pre>
          <CopyCell text={chosen.awsSetup} label={agent === "claude" ? "Copy command" : "Copy settings"} />
        </div>
        <p className="gfoot">
          {agent === "kiro" && `${chosen.where} `}
          Your agent signs you in with your AWS Builder ID the first time it uses it. Other agents: add the same URL as a remote MCP server.
        </p>
      </section>

      <HallwayStep agent={agent} issued={issued} onIssued={setIssued} />

      <section className="section">
        <h2 className="ghead">3. Ask your agent</h2>
        <div className="group">
          <p className="prompt">{PROMPT}</p>
          <CopyCell text={PROMPT} label="Copy prompt" />
        </div>
        <p className="gfoot">
          Ask again whenever you change your favorites or reservations. A sync replaces what the last one sent and keeps what you added or hid here.
        </p>
      </section>

      <SyncedSoFar schedule={schedule} />
    </Screen>
  );
}

function HallwayStep({ agent, issued, onIssued }: { agent: Agent; issued: IssuedAgentToken | null; onIssued: (t: IssuedAgentToken) => void }) {
  const chosen = agents[agent];
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onIssued(await api.issueAgentToken(label.trim() || chosen.label));
    } catch (failure) {
      setError(failureText(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!issued) {
    return (
      <form className="section" onSubmit={issue}>
        <h2 className="ghead">2. Add Hallway with a token</h2>
        <ul className="group">
          <li>
            <label className="cell">
              <span className="vh">Name this token</span>
              <input className="field" name="label" placeholder={chosen.label} maxLength={100} value={label} onChange={(e) => setLabel(e.target.value)} />
            </label>
          </li>
          <li>
            <button className="cell action lead" type="submit" disabled={busy}>
              Make a token
            </button>
          </li>
        </ul>
        <Foot error={error}>Name it for the agent and the machine, so you know which to revoke. The token acts as you and nothing more.</Foot>
      </form>
    );
  }

  const setup = chosen.hallwaySetup(new URL("/mcp", window.location.origin).toString(), issued.secret);
  return (
    <section className="section">
      <h2 className="ghead">2. Add Hallway with a token</h2>
      <div className="group">
        <div className="cell lead-ico">
          <span className="ico green">
            <Icon name="key" />
          </span>
          <div className="cellmain">
            <span>Token for "{issued.token.label}"</span>
            <span className="cellsub">Copy it now. Hallway shows it once.</span>
          </div>
        </div>
        <pre className="codebox">{setup}</pre>
        <CopyCell text={setup} label={agent === "claude" ? "Copy command" : "Copy settings"} />
      </div>
      <p className="gfoot">
        {agent === "kiro" && `${chosen.where} `}
        The token acts as you and nothing more. Revoke it any time in Settings.
      </p>
    </section>
  );
}

function CopyCell({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "refused">("idle");
  return (
    <button
      className="cell action lead"
      type="button"
      onClick={async () => setState((await copyText(text)) ? "copied" : "refused")}
      onBlur={() => setState("idle")}
    >
      {state === "copied" ? "Copied" : state === "refused" ? "Copying was not allowed: select the text above" : label}
    </button>
  );
}

function SyncedSoFar({ schedule }: { schedule: MySchedule }) {
  const synced = schedule.entries.filter((entry) => entry.source === "agent-sync");
  const reserved = synced.filter((entry) => entry.intent === "reserved").length;
  // TODO: the design's "14 sessions, 12 minutes ago" and "3 added, 1 removed,
  // 10 unchanged" need the last sync's time and SyncResult, which no
  // resource returns yet. Until then this counts what the agent has put here.
  return (
    <section className="section">
      <h2 className="ghead">From your agent</h2>
      <ul className="group">
        <li>
          <div className="cell lead-ico">
            <span className={synced.length > 0 ? "ico green" : "ico gray"}>
              <Icon name={synced.length > 0 ? "check" : "agent"} />
            </span>
            <div className="cellmain">
              <span>{synced.length === 0 ? "Nothing synced yet" : synced.length === 1 ? "1 session synced" : `${synced.length} sessions synced`}</span>
              <span className="cellsub">
                {synced.length === 0 ? "Ask your agent once the steps above are done." : `${reserved} reserved, ${synced.length - reserved} interested`}
              </span>
            </div>
          </div>
        </li>
        <li>
          <Link className="cell action lead" to="/">
            See my week
          </Link>
        </li>
      </ul>
    </section>
  );
}
