// A person's week at /@handle, as a placeholder until the person screen issue.
// The Open Graph tags for this path are the Worker's job (ADR 0005), not this.
import { useParams } from "react-router";
import { handleFromSegment } from "../handle.ts";
import { Empty } from "../shell/Empty.tsx";
import { Screen } from "../shell/Screen.tsx";
import { NotFound } from "./NotFound.tsx";

export function Person() {
  const handle = handleFromSegment(useParams().segment);
  if (handle === null) return <NotFound />;
  return (
    <Screen title={`@${handle}`} back={{ to: "/network", label: "Network" }}>
      <Empty icon="people" title="Their week is not here yet">
        Their card and, when they share it with you, their week will be here.
      </Empty>
    </Screen>
  );
}
