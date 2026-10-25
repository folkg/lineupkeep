import { isServer } from "@solidjs/web";

import { signInDestinations } from "./signInDestination";

export function browserSignInDestinations(redirect: string | undefined): {
  returnTo: string;
  errorReturnTo: string;
} {
  return signInDestinations(isServer ? "" : window.location.search, redirect);
}
