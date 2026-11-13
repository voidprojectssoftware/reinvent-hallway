// A person's page is /@handle. React Router matches whole segments only, so
// the route is /:segment and this decides whether the segment is a handle;
// anything else at the top level is not a page.
export function handleFromSegment(segment: string | undefined): string | null {
  if (!segment?.startsWith("@") || segment.length === 1) return null;
  return segment.slice(1);
}
