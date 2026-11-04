// True when the page the server sent can be taken over as it is: the address has no query and no
// fragment, so the first render in the browser matches the markup rendered at build time, which
// saw the bare path. A query (an access code, a Google sign-in result) or a fragment changes what
// the first render shows, so such a page is rendered from nothing instead of hydrated.
export function canHydrate(search: string, hash: string): boolean {
  return search === "" && hash === "";
}
