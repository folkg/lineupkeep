import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import type { RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Box } from "#browser/shared-ui/Box.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { CheckboxField } from "#browser/shared-ui/CheckboxField.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Notice } from "#browser/shared-ui/Notice.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Quote } from "#browser/shared-ui/Quote.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { Split } from "#browser/shared-ui/Split.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type {
  TransactionReviewItemView,
  TransactionReviewPlayerView,
  TransactionReviewTeamView,
  TransactionReviewView,
} from "#contracts/connections/transactionContract.ts";

import {
  TransactionReviewAuthenticationFailure,
  TransactionReviewFailure,
} from "./transactionFailure";
import type { TransactionReviewQueryOptions } from "./transactionQueries";
import { useTransactionReviewPage } from "./useTransactionReviewPage";
import type { TransactionReviewModel } from "./useTransactionReviewPage";

export function TransactionReviewPage(props: TransactionReviewPageProps): JSX.Element {
  const page = useTransactionReviewPage({ reviewQuery: () => props.reviewQuery() });

  return (
    <AppShell>
      <Page title="Proposed moves">
        <Show
          fallback={<LoadingState label="Loading proposal">Checking this proposal…</LoadingState>}
          when={!page.isLoading()}
        >
          <Show
            fallback={
              <ReviewFailure error={page.failure()} onRetry={page.retry} signIn={page.signIn} />
            }
            when={page.model()}
          >
            {(model) => (
              <Review
                isItemIncluded={page.isItemIncluded}
                model={model()}
                onToggle={page.toggleItem}
              />
            )}
          </Show>
        </Show>
      </Page>
    </AppShell>
  );
}

function ReviewFailure(props: ReviewFailureProps): JSX.Element {
  return (
    <Show
      fallback={
        <Show
          fallback={
            <ActionFeedback
              feedback={{
                type: "attention",
                message: "We could not load this proposal. Try again.",
                recovery: {
                  label: "Try again",
                  pendingLabel: "Checking again…",
                  onAction: props.onRetry,
                },
              }}
            />
          }
          when={isNotFoundFailure(props.error)}
        >
          <EmptyState title="Proposal not found.">
            This proposal is not available to the current account. Open your{" "}
            <TextLink to="/teams">teams</TextLink> to continue.
          </EmptyState>
        </Show>
      }
      when={props.error instanceof TransactionReviewAuthenticationFailure}
    >
      <ActionFeedback
        feedback={{
          type: "attention",
          message:
            "Your session ended before this proposal could be read. Sign in again to continue.",
          recovery: props.signIn,
        }}
      />
    </Show>
  );
}

function isNotFoundFailure(error: unknown): boolean {
  return (
    error instanceof TransactionReviewFailure &&
    (error.reason === "transactions.set_not_found" || error.reason === "transactions.input_invalid")
  );
}

function Review(props: ReviewProps): JSX.Element {
  return (
    <Stack gap="xl">
      <Stack gap="sm">
        <ProposalSummary
          checkedAt={props.model.checkedAt}
          review={props.model.review}
          staleCount={props.model.staleCount}
          total={props.model.total}
          teamCount={props.model.teamsWithItems.length}
        />
        <Show when={props.model.review.set.expired}>
          <ExpiredNotice expiresAt={props.model.review.set.expiresAt} />
        </Show>
      </Stack>

      <Show
        fallback={
          <EmptyState title="Nothing was proposed.">
            This set has no moves for any team. Ask the agent to propose transactions again.
          </EmptyState>
        }
        when={props.model.total > 0}
      >
        <For each={props.model.teamsWithItems}>
          {(team) => (
            <TeamProposal
              expired={props.model.review.set.expired}
              isItemIncluded={props.isItemIncluded}
              team={team}
              onToggle={props.onToggle}
            />
          )}
        </For>
        <Show when={props.model.quietTeams.length > 0}>
          <QuietTeams teams={props.model.quietTeams} />
        </Show>
        <Show when={!props.model.review.set.expired}>
          <SubmissionPanel
            faab={props.model.includedFaab}
            included={props.model.includedCount}
            total={props.model.total}
            waivers={props.model.includedWaivers}
          />
        </Show>
      </Show>
    </Stack>
  );
}

function ProposalSummary(props: ProposalSummaryProps): JSX.Element {
  return (
    <Box rule="bottom" space="lg">
      <Stack gap="sm">
        <Text size="item" weight="semibold">
          {moveCount(props.total)} across {teamCount(props.teamCount)}.
        </Text>
        <Text size="caption" tone="muted">
          Proposed by {proposerLabel(props.review.set.proposedBy.kind)}{" "}
          <Time datetime={props.review.set.createdAt}>
            {formatReaderTime(props.review.set.createdAt)}
          </Time>
          .{" "}
          <Show
            fallback={<>This set has not been checked against current state.</>}
            when={props.checkedAt}
          >
            {(checkedAt) => (
              <>
                Checked against current state{" "}
                <Time datetime={checkedAt()}>{formatReaderTime(checkedAt())}</Time>.
              </>
            )}
          </Show>{" "}
          <Show when={!props.review.set.expired}>
            Expires{" "}
            <Time datetime={props.review.set.expiresAt}>
              {formatReaderTime(props.review.set.expiresAt)}
            </Time>
            .
          </Show>
        </Text>
        <Show when={!props.review.set.expired && props.staleCount > 0}>
          <Text size="caption" tone="danger" weight="semibold">
            {props.staleCount} of {props.total === 1 ? "1 move" : `${String(props.total)} moves`} no
            longer {props.staleCount === 1 ? "matches" : "match"} current state and{" "}
            {props.staleCount === 1 ? "is" : "are"} excluded.
          </Text>
        </Show>
      </Stack>
    </Box>
  );
}

function ExpiredNotice(props: ExpiredNoticeProps): JSX.Element {
  return (
    <Notice
      tone="neutral"
      title={
        <>
          Expired <Time datetime={props.expiresAt}>{formatReaderTime(props.expiresAt)}</Time>.
        </>
      }
    >
      <Text size="body" tone="muted">
        Nothing can be submitted from this set. Ask the agent to propose these moves again.
      </Text>
    </Notice>
  );
}

function TeamProposal(props: TeamProposalProps): JSX.Element {
  const headingId = (): string => `team-${props.team.team.id}`;
  return (
    <Stack as="section" gap="sm" labelledBy={headingId()}>
      <Stack gap="xs">
        <Heading id={headingId()} level={2} size="section">
          <TextLink params={{ teamId: props.team.team.id }} to="/teams/$teamId">
            {props.team.team.name}
          </TextLink>
        </Heading>
        <Text size="caption" tone="muted">
          {leagueLabel(props.team.team.league)} · {sportLabel(props.team.team.sport)}{" "}
          {String(props.team.team.season)}
        </Text>
        <Show when={props.team.budget}>
          {(budget) => (
            <Text size="caption" tone="muted">
              {budgetLine(budget())}
            </Text>
          )}
        </Show>
        <Show when={props.team.failure}>
          {(failure) => (
            <Text size="caption" tone="muted">
              {failure()} <TextLink to="/connections">Review the connection</TextLink>
            </Text>
          )}
        </Show>
      </Stack>
      <RuleList>
        <For each={props.team.items}>
          {(item) => (
            <ProposalItem
              expired={props.expired}
              included={props.isItemIncluded(item)}
              item={item}
              onToggle={(includedNow) => props.onToggle(item.id, includedNow)}
            />
          )}
        </For>
      </RuleList>
    </Stack>
  );
}

function ProposalItem(props: ProposalItemProps): JSX.Element {
  const stale = (): boolean => props.item.staleness.status === "stale";
  const staleId = (): string => `stale-${props.item.id}`;
  return (
    <RuleListItem layout={props.expired ? "stack" : "leading"}>
      <Show when={!props.expired}>
        <CheckboxField
          checked={props.included}
          disabled={stale()}
          label={stale() ? "Stale, not included" : "Include"}
          ariaLabel={`${stale() ? "Stale, not included" : "Include"}: ${moveSummary(props.item)}`}
          describedBy={stale() ? staleId() : undefined}
          onChange={props.onToggle}
        />
      </Show>

      <Stack gap="md">
        <Inline gap="sm" align="baseline">
          <Badge tone={props.item.kind === "waiver_claim" ? "accent" : "neutral"}>
            {kindLabel(props.item.kind)}
          </Badge>
          <Text as="span" size="caption" tone="muted">
            {consequenceLine(props.item)}
          </Text>
        </Inline>

        <Split columns={props.item.adds.length > 0 && props.item.drops.length > 0 ? 2 : undefined}>
          <Show when={props.item.adds.length > 0}>
            <PlayerColumn label="Add" players={props.item.adds} />
          </Show>
          <Show when={props.item.drops.length > 0}>
            <PlayerColumn label="Drop" players={props.item.drops} />
          </Show>
        </Split>

        <Quote label="Reason">
          <Text size="body">{props.item.reason}</Text>
        </Quote>

        <Show when={stale()}>
          <Notice
            id={staleId()}
            tone="danger"
            title="No longer current"
            items={props.item.staleness.reasons.map((reason) => reason.detail)}
          />
        </Show>
      </Stack>
    </RuleListItem>
  );
}

function PlayerColumn(props: PlayerColumnProps): JSX.Element {
  return (
    <Stack gap="xs">
      <Text size="caption" tone="faint" weight="semibold">
        {props.label}
      </Text>
      <For each={props.players}>
        {(player) => (
          <Stack gap="2xs">
            <Text size="item" weight="semibold" wrap="words">
              {player.name ?? "Player name unavailable"}
            </Text>
            <Show when={playerDetailLine(player)}>
              {(detail) => (
                <Text size="caption" tone="muted">
                  {detail()}
                </Text>
              )}
            </Show>
          </Stack>
        )}
      </For>
    </Stack>
  );
}

function QuietTeams(props: QuietTeamsProps): JSX.Element {
  return (
    <Stack as="section" gap="sm" labelledBy="quiet-teams-title">
      <Heading id="quiet-teams-title" level={2} size="section">
        Teams with nothing proposed
      </Heading>
      <Text size="body" tone="muted">
        {props.teams.map((team) => team.team.name).join(", ")}
      </Text>
    </Stack>
  );
}

function SubmissionPanel(props: SubmissionPanelProps): JSX.Element {
  return (
    <Box rule="top" space="lg">
      <Stack as="section" gap="sm" labelledBy="submission-title">
        <Heading id="submission-title" level={2} size="section">
          Submission
        </Heading>
        <Inline gap="lg" justify="between" collapse>
          <Stack gap="xs">
            <Text size="body" weight="semibold" live="polite">
              {includedTally(props.included, props.total, props.waivers, props.faab)}
            </Text>
            <Text id="submission-not-open" size="caption" tone="muted">
              Submission is not open yet. Nothing will be sent to the provider.
            </Text>
          </Stack>
          <Button variant="secondary" disabled aria-describedby="submission-not-open">
            {submitLabel(props.included)}
          </Button>
        </Inline>
      </Stack>
    </Box>
  );
}

function budgetLine(budget: NonNullable<TransactionReviewTeamView["budget"]>): string {
  return budget.status === "published" ? `FAAB left: ${String(budget.remaining)}.` : budget.detail;
}

function moveSummary(item: TransactionReviewItemView): string {
  const adds = playerNames(item.adds);
  const drops = playerNames(item.drops);
  if (adds !== undefined && drops !== undefined) {
    return `Add ${adds} and drop ${drops}`;
  }
  if (adds !== undefined) {
    return `Add ${adds}`;
  }
  if (drops !== undefined) {
    return `Drop ${drops}`;
  }
  return "this move";
}

function playerNames(players: ReadonlyArray<TransactionReviewPlayerView>): string | undefined {
  const names = players.flatMap((player) => (player.name === undefined ? [] : [player.name]));
  if (names.length === 0) {
    return undefined;
  }
  if (names.length === 1) {
    return names[0];
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function playerDetailLine(player: TransactionReviewPlayerView): string | undefined {
  const identity = [player.position, player.proTeam]
    .flatMap((value) => (value === undefined ? [] : [value]))
    .join(" · ");
  if (identity === "") {
    return player.availability;
  }
  return player.availability === undefined ? identity : `${identity} · ${player.availability}`;
}

function kindLabel(kind: TransactionReviewItemView["kind"]): string {
  switch (kind) {
    case "waiver_claim":
      return "Waiver claim";
    case "free_agent_add":
      return "Free agent add";
    case "drop":
      return "Drop";
  }
}

function consequenceLine(item: TransactionReviewItemView): string {
  if (item.kind !== "waiver_claim") {
    return "No FAAB. Usually reversible.";
  }
  const bid = item.bid ?? 0;
  return `Spends ${String(bid)} FAAB and cannot be undone.`;
}

function includedTally(included: number, total: number, waivers: number, faab: number): string {
  const base = `${String(included)} of ${String(total)} ${total === 1 ? "move" : "moves"} included.`;
  if (waivers === 0) {
    return `${base} No FAAB is spent.`;
  }
  return `${base} ${String(waivers)} waiver ${waivers === 1 ? "claim spends" : "claims spend"} ${String(faab)} FAAB.`;
}

function submitLabel(included: number): string {
  if (included === 0) {
    return "Submit moves";
  }
  return `Submit ${String(included)} ${included === 1 ? "move" : "moves"}`;
}

function proposerLabel(kind: TransactionReviewView["set"]["proposedBy"]["kind"]): string {
  return kind === "agent" ? "an agent" : "you";
}

function moveCount(count: number): string {
  return `${String(count)} ${count === 1 ? "move" : "moves"}`;
}

function teamCount(count: number): string {
  return `${String(count)} ${count === 1 ? "team" : "teams"}`;
}

function leagueLabel(league: TransactionReviewTeamView["team"]["league"]): string {
  return league === "nfl" ? "NFL" : "NHL";
}

function sportLabel(sport: TransactionReviewTeamView["team"]["sport"]): string {
  return sport === "football" ? "Football" : "Hockey";
}

type TransactionReviewPageProps = {
  readonly reviewQuery: Accessor<TransactionReviewQueryOptions>;
};

type ReviewProps = {
  readonly model: TransactionReviewModel;
  readonly isItemIncluded: (item: TransactionReviewItemView) => boolean;
  readonly onToggle: (item: string, included: boolean) => void;
};

type ReviewFailureProps = {
  readonly error: unknown;
  readonly onRetry: () => Promise<void>;
  readonly signIn: RecoveryAction;
};

type ProposalSummaryProps = {
  readonly review: TransactionReviewView;
  readonly checkedAt: string | undefined;
  readonly staleCount: number;
  readonly total: number;
  readonly teamCount: number;
};

type ExpiredNoticeProps = {
  readonly expiresAt: string;
};

type TeamProposalProps = {
  readonly team: TransactionReviewTeamView;
  readonly expired: boolean;
  readonly isItemIncluded: (item: TransactionReviewItemView) => boolean;
  readonly onToggle: (item: string, included: boolean) => void;
};

type ProposalItemProps = {
  readonly item: TransactionReviewItemView;
  readonly expired: boolean;
  readonly included: boolean;
  readonly onToggle: (included: boolean) => void;
};

type PlayerColumnProps = {
  readonly label: "Add" | "Drop";
  readonly players: ReadonlyArray<TransactionReviewPlayerView>;
};

type QuietTeamsProps = {
  readonly teams: ReadonlyArray<TransactionReviewTeamView>;
};

type SubmissionPanelProps = {
  readonly included: number;
  readonly total: number;
  readonly waivers: number;
  readonly faab: number;
};
