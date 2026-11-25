// How record.ts files a response and server.ts finds it again: the decoded path
// and its query parameters in sorted order, so encoding differences don't matter.
export function fixtureKey(url: URL): string {
  const params = [...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b));
  const query = params.map(([k, v]) => `${k}=${v}`).join('&');
  return `${decodeURIComponent(url.pathname)}${query ? `?${query}` : ''}`;
}
