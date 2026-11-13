// Connect your agent, as a placeholder until its screen issue.
import { Empty } from "../shell/Empty.tsx";
import { Screen } from "../shell/Screen.tsx";

export function ConnectAgent() {
  return (
    <Screen
      title="Connect your agent"
      long
      sub="Your AI agent reads your re:Invent favorites and reservations from AWS and puts them here. Hallway never sees your AWS sign-in."
    >
      <Empty icon="agent" title="No agent connected yet">
        The steps to add the AWS Events and Hallway MCP servers will be here.
      </Empty>
    </Screen>
  );
}
