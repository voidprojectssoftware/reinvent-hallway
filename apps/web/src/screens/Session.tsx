// One session, as a placeholder until the session screen issue. Never an
// abstract: the real screen links to re:Invent for the description.
import { useParams } from "react-router";
import { Empty } from "../shell/Empty.tsx";
import { Screen } from "../shell/Screen.tsx";

export function Session() {
  const { sessionId = "" } = useParams();
  return (
    <Screen title="Session" sub={sessionId} back={{ to: "/", label: "My week" }}>
      <Empty icon="doc" title="Session details are not here yet">
        When, where, who from your network is going and the link to re:Invent will be here.
      </Empty>
    </Screen>
  );
}
