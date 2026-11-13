// Connect your agent (docs/design/connect-agent.html): the import path
// (domain.md, "Constraints"). The attendee's own agent reads AWS and writes
// here, so this screen hands them three things to paste: the AWS Events MCP
// server, Hallway's /mcp with a fresh token, and the prompt. The token's
// secret is in the one answer that issues it and nowhere after (ADR 0008),
// so it lives in this screen's state and is gone on reload.
//
// This is where a person waits for their agent's first sync, so the last
// sync is re-read without a reload (which would lose the token): whenever
// the window comes back into view, and every few seconds while the sync it
// asks for has not arrived.
import type { IssuedAgentToken, MySchedule } from "@hallway/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLoaderData, useRevalidator } from "react-router";
import { api } from "../api/client.ts";
import { copyText } from "../copy.ts";
import { EVENT_ID } from "../event.ts";
import { Foot, type Failed } from "../shell/Foot.tsx";
import { Icon } from "../shell/Icon.tsx";
import { Screen } from "../shell/Screen.tsx";
import { requireSignIn } from "../shell/signed-in.ts";
import { sessions, syncCounts } from "../schedule/sync.ts";
import { formatAgo } from "../time.ts";
import { whyAgentLine } from "../why/copy.ts";
import { WhyLink } from "../why/WhySheet.tsx";

export function connectAgentLoader({ request }: { request: Request }): Promise<MySchedule> {
  return requireSignIn(api.mySchedule(EVENT_ID), request);
}

// AWS's sign-in has one shared public client, which accepts only fixed
// loopback callbacks, so each agent's setup must name that client and a
// fixed port or Builder ID sign-in fails with a redirect mismatch
// (docs/discovery/aws-events-api.md, "Adding the server to an agent").
const AWS_EVENTS_MCP = "https://api.awsevents.com/mcp";
const AWS_CLIENT_ID = "7vmom55m1qstvq8i71ph127bfq";
const PROMPT = "Put my re:Invent 2026 schedule on Hallway.";

type Agent = "claude" | "kiro";

const agents: Record<Agent, { name: string; label: string; awsSetup: string; hallwaySetup: (url: string, secret: string) => string; where: string }> = {
  claude: {
    name: "Claude Code",
    label: "Claude Code on laptop",
    // AWS's command in AWS's order, broken so no line wraps at 390 px.
    awsSetup: `claude mcp add --transport http \\\n  --scope user awsevents \\\n  ${AWS_EVENTS_MCP} \\\n  --callback-port 8484 \\\n  --client-id ${AWS_CLIENT_ID}`,
    hallwaySetup: (url, secret) =>
      // User scope, as AWS's: the default (this folder only) would leave
      // Hallway out of every other project the person asks from.
      `claude mcp add --transport http \\\n  --scope user hallway ${url} \\\n  --header "Authorization: Bearer ${secret}"`,
    where: "Run it in a terminal.",
  },
  kiro: {
    name: "Kiro",
    label: "Kiro on laptop",
    // Kiro appends /oauth/callback to redirectUri itself, so it ends at the port.
    awsSetup: kiroConfig({
      awsevents: {
        url: AWS_EVENTS_MCP,
        oauth: { clientId: AWS_CLIENT_ID, redirectUri: "http://127.0.0.1:8976", oauthScopes: ["openid", "email", "events/access"] },
      },
    }),
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
  useSyncWatch(schedule, issued);

  return (
    <Screen
      title="Connect your agent"
      long
      sub={
        <>
          Your AI agent reads your re:Invent favorites and reservations from AWS and puts them here. Hallway never sees your AWS sign-in.{" "}
          {whyAgentLine} <WhyLink section="schedule" />
        </>
      }
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
          Your agent signs you in with your AWS Builder ID the first time it uses it. Other agents: add the same URL as a remote MCP server with a fixed loopback callback port and the client id {AWS_CLIENT_ID}; AWS refuses sign-in without both.
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
  const [failed, setFailed] = useState<Failed | null>(null);

  async function issue(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setFailed(null);
    try {
      onIssued(await api.issueAgentToken(label.trim() || chosen.label));
    } catch (failure) {
      setFailed({ failure, retry: () => void issue() });
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
        <Foot failed={failed}>Name it for the agent and the machine, so you know which to revoke. The token acts as you and nothing more.</Foot>
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

/** Every so often while waiting: a sync takes an agent a minute or two. */
const pollEvery = 5_000;

/**
 * Re-reads the schedule when the window comes back into view, and on a timer
 * while a sync is awaited: none yet, or none since the token just made.
 */
function useSyncWatch(schedule: MySchedule, issued: IssuedAgentToken | null): void {
  const revalidator = useRevalidator();
  const again = useRef(revalidator.revalidate);
  again.current = revalidator.revalidate;
  const last = schedule.lastSync;
  const waiting = !last || (issued !== null && Date.parse(last.syncedAt) < Date.parse(issued.token.createdAt));

  useEffect(() => {
    const reread = () => {
      if (document.visibilityState === "visible") void again.current();
    };
    window.addEventListener("focus", reread);
    document.addEventListener("visibilitychange", reread);
    const timer = waiting ? setInterval(reread, pollEvery) : undefined;
    return () => {
      window.removeEventListener("focus", reread);
      document.removeEventListener("visibilitychange", reread);
      clearInterval(timer);
    };
  }, [waiting]);
}

function SyncedSoFar({ schedule }: { schedule: MySchedule }) {
  const last = schedule.lastSync;
  const total = last ? last.added + last.changed + last.unchanged : 0;
  return (
    <section className="section">
      <h2 className="ghead">Last sync</h2>
      {/* Announced when it changes by itself, as it does once the agent syncs. */}
      <ul className="group" aria-live="polite">
        <li>
          <div className="cell lead-ico">
            <span className={last ? "ico green" : "ico gray"}>
              <Icon name={last ? "check" : "agent"} />
            </span>
            <div className="cellmain">
              {last ? (
                <>
                  <span>
                    {sessions(total)}, {formatAgo(last.syncedAt)}
                  </span>
                  <span className="cellsub">
                    {total === 0 ? "Your agent found no favorites or reservations on re:Invent." : syncCounts(last)}
                  </span>
                </>
              ) : (
                <>
                  <span>Nothing synced yet</span>
                  <span className="cellsub">Ask your agent once the steps above are done. This updates by itself.</span>
                </>
              )}
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
