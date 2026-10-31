import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Box } from "#browser/shared-ui/Box.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { CheckboxField } from "#browser/shared-ui/CheckboxField.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Dock, DockSpacer } from "#browser/shared-ui/Dock.tsx";
import { FocusRegion } from "#browser/shared-ui/FocusRegion.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
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
  TransactionReviewExecutionView,
  TransactionReviewItemView,
  TransactionReviewPlayerView,
  TransactionReviewStepView,
  TransactionReviewTeamView,
  TransactionReviewView,
} from "#contracts/connections/transactionContract.ts";

import {
  TransactionReviewAuthenticationFailure,
  TransactionReviewFailure,
} from "./transactionFailure";
import type { TransactionReviewQueryOptions } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";
import { resultSummaryId, useTransactionReviewPage } from "./useTransactionReviewPage";
import type {
  TransactionReviewModel,
  TransactionReviewModelOutcome,
} from "./useTransactionReviewPage";

export function TransactionReviewPage(props: TransactionReviewPageProps): JSX.Element {
  const page = useTransactionReviewPage({
    reviewQuery: () => props.reviewQuery(),
    remote: () => props.remote(),
  });

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
                feedback={page.feedback()}
                isItemIncluded={page.isItemIncluded}
                model={model()}
                onSubmit={page.submit}
                onToggle={page.toggleItem}
                submitting={page.submitting()}
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
  const submitted = (): boolean => props.model.submitted;
  return (
    <Stack gap="xl">
      <Stack gap="sm">
        <Show
          fallback={
            <ProposalSummary
              checkedAt={props.model.checkedAt}
              review={props.model.review}
              staleCount={props.model.staleCount}
              total={props.model.total}
              teamCount={props.model.teamsWithItems.length}
            />
          }
          when={props.model.review.set.submission}
        >
          {(submission) => (
            <SubmittedSummary
              counts={props.model.counts}
              finished={props.model.finished}
              review={props.model.review}
              submittedAt={submission().submittedAt}
            />
          )}
        </Show>
        <Show when={props.model.review.set.expired && !submitted()}>
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
        <DockSpacer active={!submitted()}>
          <Stack gap="xl">
            <For each={props.model.teamsWithItems}>
              {(team) => (
                <TeamProposal
                  expired={props.model.review.set.expired}
                  submitted={submitted()}
                  submitting={props.submitting}
                  isItemIncluded={props.isItemIncluded}
                  team={team}
                  onToggle={props.onToggle}
                />
              )}
            </For>
            <Show when={props.model.quietTeams.length > 0}>
              <QuietTeams teams={props.model.quietTeams} />
            </Show>
          </Stack>
        </DockSpacer>
        <Show when={!props.model.review.set.expired && !submitted()}>
          <SubmissionPanel
            faab={props.model.includedFaab}
            feedback={props.feedback}
            included={props.model.includedCount}
            staleCount={props.model.staleCount}
            submitting={props.submitting}
            total={props.model.total}
            waivers={props.model.includedWaivers}
            onSubmit={props.onSubmit}
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
        <Show when={props.staleCount > 0}>
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

function SubmittedSummary(props: SubmittedSummaryProps): JSX.Element {
  return (
    <FocusRegion id={resultSummaryId} labelledBy="submitted-title">
      <Box rule="bottom" space="lg">
        <Stack gap="sm">
          <Inline gap="sm" align="baseline">
            <Heading id="submitted-title" level={2} size="section">
              Submitted
            </Heading>
            <Badge tone="accent">Audit record</Badge>
          </Inline>
          <Text size="body" weight="semibold" live="polite">
            {outcomeSummary(props.counts)}
          </Text>
          <Text size="caption" tone="muted">
            Submitted by you{" "}
            <Time datetime={props.submittedAt}>{formatReaderTime(props.submittedAt)}</Time>.{" "}
            <Show
              fallback={
                <>
                  The submission did not finish recording outcomes, so the results below are
                  incomplete. Nothing is retried automatically.
                </>
              }
              when={props.finished}
            >
              Every included move has a recorded outcome below.
            </Show>
          </Text>
          <Show when={props.counts.failed + props.counts.unknown > 0}>
            <Notice
              tone="danger"
              title={`${String(props.counts.failed + props.counts.unknown)} ${props.counts.failed + props.counts.unknown === 1 ? "move needs" : "moves need"} your attention`}
            >
              <Text size="caption" tone="danger">
                Read the outcome beside each move before making another change. A move that may have
                applied is never retried automatically.
              </Text>
            </Notice>
          </Show>
          <Text size="caption" tone="faint">
            This set cannot be submitted again. Propose a new set for another move.
          </Text>
        </Stack>
      </Box>
    </FocusRegion>
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
              submitted={props.submitted}
              submitting={props.submitting}
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
  const result = (): TransactionReviewExecutionView | undefined => props.item.execution;
  const staleId = (): string => `stale-${props.item.id}`;
  return (
    <RuleListItem
      layout={props.submitted || props.item.staleness.status === "stale" ? "stack" : "leading"}
    >
      <Show when={!props.submitted && !props.expired}>
        <CheckboxField
          checked={props.included}
          disabled={stale() || props.submitting}
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
          <Show when={result()}>
            {(execution) => (
              <Badge tone={isAttention(execution().outcome) ? "neutral" : "accent"}>
                {outcomeLabel(execution().outcome)}
              </Badge>
            )}
          </Show>
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

        <Show when={!stale() && result() === undefined && props.item.reserveMove}>
          {(move) => (
            <Notice tone="neutral" title="Makes room first">
              <Text size="caption" tone="muted">
                Move {move().playerName ?? "this player"} from {move().fromSlot} to {move().toSlot}{" "}
                before the add. That reserve move is reported as its own step.
              </Text>
            </Notice>
          )}
        </Show>

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

        <Show when={result()}>{(execution) => <ExecutionResult execution={execution()} />}</Show>
      </Stack>
    </RuleListItem>
  );
}

function ExecutionResult(props: {
  readonly execution: TransactionReviewExecutionView;
}): JSX.Element {
  return (
    <Stack gap="sm">
      <Show when={props.execution.steps.length > 0}>
        <RuleList>
          <For each={props.execution.steps}>
            {(step) => (
              <RuleListItem layout="stack">
                <Inline gap="sm" align="baseline">
                  <Text size="caption" weight="semibold">
                    {stepLabel(step)}
                  </Text>
                  <Text size="caption" tone={isAttention(step.outcome) ? "danger" : "muted"}>
                    {outcomeLabel(step.outcome)}
                  </Text>
                </Inline>
                <Show when={step.detail}>
                  {(detail) => (
                    <Text size="caption" tone="muted">
                      {detail()}
                    </Text>
                  )}
                </Show>
              </RuleListItem>
            )}
          </For>
        </RuleList>
      </Show>
      <Show when={props.execution.steps.length === 0 && props.execution.detail}>
        {(detail) => (
          <Text size="caption" tone="muted">
            {detail()}
          </Text>
        )}
      </Show>
      <Show when={props.execution.outcome === "failed"}>
        <Notice tone="danger" title="This move failed">
          <Text size="caption" tone="danger">
            It was attempted once and not retried. Read the provider's wording above before
            proposing it again.
          </Text>
        </Notice>
      </Show>
      <Show when={props.execution.outcome === "unknown"}>
        <Notice tone="danger" title="Not confirmed">
          <Text size="caption" tone="danger">
            This request may or may not have applied. It was not retried. Check the team before
            proposing another move.
          </Text>
        </Notice>
      </Show>
      <Show when={props.execution.outcome === "pending"}>
        <Notice tone="neutral" title="Pending on waivers">
          <Text size="caption" tone="muted">
            The provider will process this claim later. It is not done, and it is not a failure.
          </Text>
        </Notice>
      </Show>
      <Show when={props.execution.outcome === "skipped" && props.execution.steps.length > 0}>
        <Notice tone="neutral" title="Skipped">
          <Text size="caption" tone="muted">
            This move was left out or stopped before it could be sent. The reason is above.
          </Text>
        </Notice>
      </Show>
    </Stack>
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
    <Dock id="submission-panel">
      <Box rule="top" space="lg">
        <Form gap="sm" onSubmit={props.onSubmit}>
          <Stack as="section" gap="sm" labelledBy="submission-title">
            <Heading id="submission-title" level={2} size="section">
              Submit
            </Heading>
            <Inline gap="lg" justify="between" collapse>
              <Stack gap="xs">
                <Text size="body" weight="semibold" live="polite">
                  {includedTally(
                    props.included,
                    props.total,
                    props.waivers,
                    props.faab,
                    props.submitting,
                  )}
                </Text>
                <Text id="submission-note" size="caption" tone="muted">
                  One provider transaction per move, sent in this order, with no retries. Waiver
                  claims stay pending until the provider processes them.
                </Text>
                <Show when={props.staleCount > 0}>
                  <Text size="caption" tone="muted">
                    {props.staleCount} stale {props.staleCount === 1 ? "move is" : "moves are"}{" "}
                    excluded.
                  </Text>
                </Show>
              </Stack>
              <Button
                type="submit"
                pending={props.submitting}
                pendingLabel={submittingLabel(props.included)}
                disabled={props.included === 0 || props.submitting}
                aria-describedby="submission-note"
              >
                {submitLabel(props.included)}
              </Button>
            </Inline>
            <ActionFeedback feedback={props.feedback} />
          </Stack>
        </Form>
      </Box>
    </Dock>
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

function includedTally(
  included: number,
  total: number,
  waivers: number,
  faab: number,
  submitting: boolean,
): string {
  const base = `${String(included)} of ${String(total)} ${total === 1 ? "move" : "moves"} included.`;
  const spending =
    waivers === 0
      ? "No FAAB is spent."
      : `${String(waivers)} waiver ${waivers === 1 ? "claim spends" : "claims spend"} ${String(faab)} FAAB.`;
  return submitting ? `${base} ${spending} Sending to the provider now.` : `${base} ${spending}`;
}

function submitLabel(included: number): string {
  if (included === 0) {
    return "Submit moves";
  }
  return `Submit ${String(included)} ${included === 1 ? "move" : "moves"}`;
}

function submittingLabel(included: number): string {
  return `Submitting ${String(included)} ${included === 1 ? "move" : "moves"}…`;
}

function outcomeLabel(outcome: TransactionReviewModelOutcome): string {
  switch (outcome) {
    case "executed":
      return "Executed";
    case "pending":
      return "Pending on waivers";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "unknown":
      return "Unknown, may have applied";
  }
}

function isAttention(outcome: TransactionReviewModelOutcome): boolean {
  return outcome === "failed" || outcome === "unknown";
}

function stepLabel(step: TransactionReviewStepView): string {
  switch (step.kind) {
    case "reserve_move":
      return `Move ${step.playerName ?? "player"} to ${step.toSlot ?? "reserve"}${
        step.fromSlot === undefined ? "" : ` from ${step.fromSlot}`
      }`;
    case "add":
      return `Add ${step.playerName ?? "player"}`;
    case "drop":
      return `Drop ${step.playerName ?? "player"}`;
  }
}

function outcomeSummary(counts: TransactionReviewModel["counts"]): string {
  const parts = [
    counts.executed > 0 ? `${String(counts.executed)} executed` : undefined,
    counts.pending > 0 ? `${String(counts.pending)} pending on waivers` : undefined,
    counts.failed > 0 ? `${String(counts.failed)} failed` : undefined,
    counts.unknown > 0 ? `${String(counts.unknown)} unknown` : undefined,
    counts.skipped > 0 ? `${String(counts.skipped)} skipped` : undefined,
  ].flatMap((part) => (part === undefined ? [] : [part]));
  return parts.length === 0 ? "No outcome was recorded." : `${parts.join(" · ")}.`;
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
  readonly remote: Accessor<TransactionRemote>;
};

type ReviewProps = {
  readonly model: TransactionReviewModel;
  readonly isItemIncluded: (item: TransactionReviewItemView) => boolean;
  readonly onToggle: (item: string, included: boolean) => void;
  readonly onSubmit: () => void;
  readonly submitting: boolean;
  readonly feedback: ActionFeedbackState | undefined;
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

type SubmittedSummaryProps = {
  readonly review: TransactionReviewView;
  readonly submittedAt: string;
  readonly finished: boolean;
  readonly counts: TransactionReviewModel["counts"];
};

type ExpiredNoticeProps = {
  readonly expiresAt: string;
};

type TeamProposalProps = {
  readonly team: TransactionReviewTeamView;
  readonly expired: boolean;
  readonly submitted: boolean;
  readonly submitting: boolean;
  readonly isItemIncluded: (item: TransactionReviewItemView) => boolean;
  readonly onToggle: (item: string, included: boolean) => void;
};

type ProposalItemProps = {
  readonly item: TransactionReviewItemView;
  readonly expired: boolean;
  readonly submitted: boolean;
  readonly submitting: boolean;
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
  readonly staleCount: number;
  readonly submitting: boolean;
  readonly feedback: ActionFeedbackState | undefined;
  readonly onSubmit: () => void;
};
