import { useMutation, useQuery } from "@tanstack/solid-query";

import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";

import { consentMutation } from "./consentMutations";
import type { ConsentRequestQuery } from "./consentQueries";
import type { ConsentRemote } from "./consentRemote";

export function useConsent(props: {
  readonly query: string;
  readonly requestQuery: () => ConsentRequestQuery;
  readonly remote: ConsentRemote;
  readonly onConfirmed: (url: string) => void;
}): {
  request: () =>
    | {
        readonly status: "valid";
        readonly client: {
          readonly id: string;
          readonly name: string | null;
          readonly host: string;
        };
        readonly scopes: ReadonlyArray<
          import("@lineupkeep/backend/auth/AuthorizationScopes").AuthorizationScope
        >;
      }
    | undefined;
  title: () => "Connect a client?" | "Invalid authorization request";
  lede: () =>
    | "No access can be granted from this page."
    | "Only connect a client you trust. Review the permissions before allowing access.";
  isPending: () => boolean;
  isApproving: () => boolean;
  isDenying: () => boolean;
  feedback: () => ActionFeedbackState | undefined;
  approve: () => Promise<string>;
  deny: () => Promise<string>;
} {
  const request = useQuery(() => props.requestQuery());
  const decision = useMutation(() => ({
    ...consentMutation(props.remote),
    onSuccess: props.onConfirmed,
  }));
  const details = ():
    | {
        readonly status: "valid";
        readonly client: {
          readonly id: string;
          readonly name: string | null;
          readonly host: string;
        };
        readonly scopes: ReadonlyArray<
          import("@lineupkeep/backend/auth/AuthorizationScopes").AuthorizationScope
        >;
      }
    | undefined => {
    const data = request.data;
    return data.status === "valid" ? data : undefined;
  };
  return {
    request: details,
    title: () => (details() === undefined ? "Invalid authorization request" : "Connect a client?"),
    lede: () =>
      details() === undefined
        ? "No access can be granted from this page."
        : "Only connect a client you trust. Review the permissions before allowing access.",
    isPending: () => decision.isPending,
    isApproving: () => decision.isPending && decision.variables?.accept === true,
    isDenying: () => decision.isPending && decision.variables?.accept === false,
    feedback: (): ActionFeedbackState | undefined =>
      decision.isError
        ? {
            type: "attention",
            message:
              "We couldn't confirm your decision. Return to your client and start connecting again; no access is confirmed here.",
          }
        : undefined,
    approve: () => decision.mutate({ query: props.query, accept: true }),
    deny: () => decision.mutate({ query: props.query, accept: false }),
  };
}
