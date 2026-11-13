// The profile form's limits and its words for what the contract refuses.
// The limits are the contract's (UpdateProfileInput), written here as
// numbers for the inputs' maxLength; profile-form.test.ts fails if they
// drift. The form checks with the contract itself before sending, so a
// refusal reaches the person as a sentence under the field it is about,
// never as the parser's issue list.
import { UpdateProfileInput } from "@hallway/contracts";

export const profileLimits = { displayName: 100, headline: 200, linkedinProfileUrl: 300 } as const;

export type ProfileField = "displayName" | "handle" | "headline" | "linkedinProfileUrl";
export type FieldProblems = Partial<Record<ProfileField, string>>;

const named: Record<ProfileField, string> = {
  displayName: "A name",
  handle: "A handle",
  headline: "A headline",
  linkedinProfileUrl: "A profile URL",
};

/** What is wrong with each field of `input`, in words; empty when the contract accepts it. */
export function profileProblems(input: UpdateProfileInput): FieldProblems {
  const parsed = UpdateProfileInput.safeParse(input);
  if (parsed.success) return {};
  const problems: FieldProblems = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as ProfileField;
    if (problems[field]) continue;
    if (field === "handle") problems.handle = "A handle is 3 to 30 of a-z, 0-9 and single hyphens.";
    else if (issue.code === "too_big") problems[field] = `${named[field]} is at most ${String(issue.maximum)} characters.`;
    else if (issue.code === "too_small") problems[field] = `${named[field]} cannot be empty.`;
    else problems[field] = `${named[field]} is not one Hallway can take.`;
  }
  return problems;
}
