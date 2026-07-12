// Query-string builder for list filters/sort/pagination.
// Array values are serialized as comma-separated (CSV) per ARCHITECTURE §18
// (e.g. `status=active,attention`, `tags=electronics,urgent`). Empty arrays and
// nullish values are omitted so cache keys stay stable.
export type QueryParamPrimitive = string | number | boolean;
export type QueryParamValue =
  | QueryParamPrimitive
  | ReadonlyArray<QueryParamPrimitive>
  | undefined
  | null;

export function buildQueryString(
  params: Readonly<Record<string, QueryParamValue>>,
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.map(String).join(','));
    } else {
      search.set(key, String(value));
    }
  }

  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
