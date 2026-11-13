// Drafts of LinkedIn posts waiting for the member's consent (ADR 0026), on D1
// and in memory. post-drafts.test.ts holds the two to the same answers.
//
// A draft is taken once: the read deletes it, in one statement on D1, so two
// callbacks with the same state cannot both post. One that is never taken
// (the person closed LinkedIn's page) is cleared by the next put after it
// expires, so the table only ever holds the last ten minutes' drafts.
import type { PostDraftRecord, PostDraftRepository } from "@hallway/application";
import type { ShareSelection } from "@hallway/domain";
import { eq, lt } from "drizzle-orm";
import type { Database } from "../persistence/d1/database.ts";
import { linkedinPostDrafts } from "../persistence/d1/entities/sharing.ts";

export function postDraftsOnD1(db: Database): PostDraftRepository {
  return {
    async put(draft) {
      await db.batch([
        db.delete(linkedinPostDrafts).where(lt(linkedinPostDrafts.expiresAt, draft.createdAt)),
        db.insert(linkedinPostDrafts).values({ ...draft, selection: JSON.stringify(draft.selection) }),
      ]);
    },
    async take(stateSha256, now) {
      const [row] = await db
        .delete(linkedinPostDrafts)
        .where(eq(linkedinPostDrafts.stateSha256, stateSha256))
        .returning();
      if (!row || row.expiresAt <= now) return undefined;
      return { ...row, selection: JSON.parse(row.selection) as ShareSelection };
    },
  };
}

/** Beside the port, `all()`: what is waiting, for tests that check a draft was used up. */
export function postDraftsInMemory(): PostDraftRepository & { all(): PostDraftRecord[] } {
  const drafts = new Map<string, PostDraftRecord>();
  return {
    async put(draft) {
      for (const [key, waiting] of drafts) if (waiting.expiresAt < draft.createdAt) drafts.delete(key);
      if (drafts.has(draft.stateSha256)) throw new Error("UNIQUE constraint failed: linkedin_post_drafts.state_sha256");
      drafts.set(draft.stateSha256, structuredClone(draft));
    },
    async take(stateSha256, now) {
      const draft = drafts.get(stateSha256);
      drafts.delete(stateSha256);
      return draft && draft.expiresAt > now ? draft : undefined;
    },
    all: () => [...drafts.values()].map((draft) => structuredClone(draft)),
  };
}
