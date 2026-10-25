import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { browserSignInDestinations } from "#browser/auth/authNavigation.ts";
import { AuthPage } from "#browser/auth/AuthPage.tsx";
import { isApplicationPath } from "#browser/auth/signInDestination.ts";
import { signInQueries } from "#browser/auth/signInQueries.ts";
import { signInRemote } from "#browser/auth/signInRemote.ts";

export const Route = createFileRoute("/auth")({
  validateSearch: parseAuthSearch,
  context: () => ({ signInMethodsQuery: signInQueries.methods(signInRemote) }),

  loader: ({ context }) => context.queryClient.prefetchQuery(context.signInMethodsQuery),
  component: AuthRoute,
});

function AuthRoute(): JSX.Element {
  const search = Route.useSearch();
  const context = Route.useRouteContext();
  const navigate = Route.useNavigate();
  const destinations = (): {
    returnTo: string;
    errorReturnTo: string;
  } => browserSignInDestinations(search().redirect);

  return (
    <AuthPage
      remote={signInRemote}
      methodsQuery={() => context().signInMethodsQuery}
      returnTo={destinations().returnTo}
      googleErrorReturnTo={destinations().errorReturnTo}
      googleError={search().error}
      onAuthenticated={() =>
        context()
          .queryClient.resetQueries()
          .then(() => navigate({ href: destinations().returnTo }))
      }
    />
  );
}

function parseAuthSearch(input: Record<string, unknown>): AuthSearch {
  const redirect = input["redirect"];
  const error = input["error"];
  return {
    ...(typeof redirect === "string" && isApplicationPath(redirect) ? { redirect } : {}),
    ...(typeof error === "string" ? { error } : {}),
  };
}

type AuthSearch = {
  readonly redirect?: string;

  readonly error?: string;
};
