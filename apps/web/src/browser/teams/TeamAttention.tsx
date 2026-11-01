import type { JSX } from "@solidjs/web";
import { Match, Show, Switch } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";
import type { TeamSummaryView } from "#contracts/connections/teamContract.ts";

import type { TeamRemote } from "./teamRemote";
import { useTeamCheck } from "./useTeamCheck";

export function TeamAttention(props: TeamAttentionProps): JSX.Element {
  const provider = (): string => providerDisplayName(props.team.team.provider);
  const availability = (): TeamSummaryView["team"]["availability"] => props.team.team.availability;
  const check = useTeamCheck({ team: () => props.team, remote: () => props.remote });
  const canCheck = (): boolean => props.team.connectionStatus === "ready";

  return (
    <>
      <Show when={hasAttention(props.team)}>
        <Stack gap="xs">
          <Switch>
            <Match when={unavailableAvailability(availability())}>
              {(refused) => (
                <Stack gap="xs">
                  <Text size="caption" weight="semibold">
                    Lineupkeep cannot read this team.
                  </Text>
                  <Text size="caption">{refused().detail}</Text>
                  <Text size="caption" tone="muted">
                    {availabilityMeaning(refused().reason)}
                  </Text>
                  <Text size="caption" tone="muted">
                    <Show when={refused().reason === "provider_refused"}>
                      <Show
                        fallback={<>Seen once. The next check will try again. </>}
                        when={refused().consecutiveRefusals > 1}
                      >
                        Seen on {refused().consecutiveRefusals} consecutive checks. The next check
                        will try again.{" "}
                      </Show>
                    </Show>
                    Last observed{" "}
                    <Time datetime={refused().observedAt}>
                      {formatReaderTime(refused().observedAt)}
                    </Time>
                    . Lineup checks skip it until it can be read.
                  </Text>
                  <CheckAgain check={check} enabled={canCheck()} />
                </Stack>
              )}
            </Match>
            <Match when={staleAvailability(availability())}>
              {(stale) => (
                <Stack gap="xs">
                  <Text size="caption" weight="semibold">
                    Lineupkeep has not checked this team recently.
                  </Text>
                  <Text size="caption">
                    The last readable check was{" "}
                    <Time datetime={stale().observedAt}>
                      {formatReaderTime(stale().observedAt)}
                    </Time>
                    , which is older than the three hours Lineupkeep treats as current. It cannot
                    say this team is readable now.
                  </Text>
                  <CheckAgain check={check} enabled={canCheck()} />
                </Stack>
              )}
            </Match>
            <Match when={availability().status === "unobserved"}>
              <Stack gap="xs">
                <Text size="caption" weight="semibold">
                  Lineupkeep has not checked this team yet.
                </Text>
                <Text size="caption">
                  Its availability is unknown until the next hourly check or a check now.
                </Text>
                <CheckAgain check={check} enabled={canCheck()} />
              </Stack>
            </Match>
          </Switch>
          <ConnectionAttention provider={provider()} status={props.team.connectionStatus} />
        </Stack>
      </Show>
      <Show when={check.feedback()}>{(state) => <ActionFeedback feedback={state()} />}</Show>
    </>
  );
}

function CheckAgain(props: {
  readonly check: ReturnType<typeof useTeamCheck>;
  readonly enabled: boolean;
}): JSX.Element {
  return (
    <Show when={props.enabled}>
      <Inline gap="sm">
        <Button
          pending={props.check.checking()}
          pendingLabel="Checking…"
          variant="quiet"
          onClick={props.check.check}
        >
          Check this team again
        </Button>
      </Inline>
    </Show>
  );
}

function ConnectionAttention(props: {
  readonly provider: string;
  readonly status: TeamSummaryView["connectionStatus"];
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.status === "reconnect-required"}>
        <Inline gap="sm">
          <Text as="span" size="caption">
            {props.provider} needs a new sign-in before lineup checks can run.
          </Text>
          <TextLink to="/connections">Reconnect {props.provider}</TextLink>
        </Inline>
      </Match>
      <Match when={props.status === "disconnected"}>
        <Inline gap="sm">
          <Text as="span" size="caption">
            {props.provider} is disconnected, so lineup checks cannot run.
          </Text>
          <TextLink to="/connections">Reconnect {props.provider}</TextLink>
        </Inline>
      </Match>
      <Match when={props.status === "linking"}>
        <Text size="caption">{props.provider} sign-in is in progress.</Text>
      </Match>
    </Switch>
  );
}

function availabilityMeaning(reason: UnavailableAvailability["reason"]): string {
  switch (reason) {
    case "provider_refused":
      return "That usually means this team is no longer in the league it belongs to, or this account may no longer read it. Nothing was deleted.";
    case "not_listed":
      return "This account's own team list no longer includes it. Its note and history are kept.";
    case "connection_unavailable":
      return "Reconnect the provider, then check the team again.";
  }
}

function hasReadAttention(team: TeamSummaryView): boolean {
  const status = team.team.availability.status;
  return status === "unavailable" || status === "stale" || status === "unobserved";
}

function hasAttention(team: TeamSummaryView): boolean {
  return team.connectionStatus !== "ready" || hasReadAttention(team);
}

function unavailableAvailability(
  availability: TeamSummaryView["team"]["availability"],
): UnavailableAvailability | undefined {
  return availability.status === "unavailable" ? availability : undefined;
}

function staleAvailability(
  availability: TeamSummaryView["team"]["availability"],
): StaleAvailability | undefined {
  return availability.status === "stale" ? availability : undefined;
}

type TeamAttentionProps = {
  readonly team: TeamSummaryView;
  readonly remote: TeamRemote;
};

type UnavailableAvailability = Extract<
  TeamSummaryView["team"]["availability"],
  { readonly status: "unavailable" }
>;

type StaleAvailability = Extract<
  TeamSummaryView["team"]["availability"],
  { readonly status: "stale" }
>;
