// The access code a deployed Meety can ask for at sign-up. A link with ?access= fills it in, this browser keeps it
// once it opened a profile, and the invite link that person shares carries it, so the friend who opens the link never types it.

// The name of the query part that carries the code in a link.
export const ACCESS_PARAM = "access";
// Where this browser keeps the code that opened its profile.
const STORAGE_KEY = "meet-first.access-code";

// The code in a link's query, or "" when it has none.
export function accessCodeIn(search: string): string {
  return (new URLSearchParams(search).get(ACCESS_PARAM) ?? "").trim();
}

// The link with the code added as ?access=, or the link as it came when there is no code or it is not a link this page can read.
export function withAccessCode(link: string, code: string): string {
  if (code === "") return link;
  try {
    const url = new URL(link);
    url.searchParams.set(ACCESS_PARAM, code);
    return url.toString();
  } catch {
    return link;
  }
}

// Keeps the code that opened this profile.
export function rememberAccessCode(code: string): void {
  if (code === "") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Storage is off in this browser, so the invite links go out without the code and the friend types it.
  }
}

// The code this browser kept, or "" when it kept none.
export function readAccessCode(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}
