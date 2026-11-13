// My week, as a placeholder until the schedule screen issue. It already reads
// the Event through the API client, so the line saying what the times are in
// comes from the event's own name and dates.
import type { Event } from "@hallway/contracts";
import { Link, useLoaderData } from "react-router";
import { api } from "../api/client.ts";
import { Empty } from "../shell/Empty.tsx";
import { Screen } from "../shell/Screen.tsx";
import { zoneAbbreviation } from "../time.ts";

export const EVENT_ID = "reinvent2026";

export function myWeekLoader(): Promise<Event> {
  return api.getEvent(EVENT_ID);
}

export function MyWeek() {
  const event = useLoaderData<typeof myWeekLoader>();
  return (
    <Screen title="My week" sub={`${event.name} · times are Las Vegas time (${zoneAbbreviation(event.startDate)})`}>
      <Empty
        icon="week"
        title="Nothing on your week yet"
        action={
          <Link className="btn" to="/connect">
            Connect your agent
          </Link>
        }
      >
        Ask your agent to sync, or add a session from someone's week.
      </Empty>
    </Screen>
  );
}
