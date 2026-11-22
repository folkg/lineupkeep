import { EffectArray, EffectString } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { Card } from "#browser/shared-ui/Card.tsx";
import { Definition, DefinitionList } from "#browser/shared-ui/DefinitionList.tsx";
import { Disclosure } from "#browser/shared-ui/Disclosure.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Notice } from "#browser/shared-ui/Notice.tsx";
import { SeasonArea } from "#browser/shared-ui/SeasonArea.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { OverviewLoadingRows } from "#browser/shared-ui/Skeleton.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import type { TeamOverviewView } from "#contracts/connections/teamContract.ts";

import { scoringLabel } from "./TeamSeasonFacts";

export function TeamSeasonOverview(props: {
  readonly facts: TeamOverviewView | undefined;
  readonly loading: boolean;
  readonly failed: boolean;
}): JSX.Element {
  const facts = (): TeamOverviewView | undefined => props.facts;
  const league = (): TeamOverviewView["league"] => facts()?.league;
  const standing = (): TeamOverviewView["standing"] => facts()?.standing;
  const matchup = (): TeamOverviewView["matchup"] => facts()?.matchup;
  const number = (value: number | null | undefined): string =>
    value === null || value === undefined
      ? "Not published"
      : value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const cap = (): NonNullable<TeamOverviewView["league"]>["gamesCaps"] | undefined =>
    league()?.gamesCaps;
  const hasCap = (): boolean =>
    cap()?.gamesPlayed !== undefined || cap()?.inningsPitched !== undefined;
  const usage = ():
    | Extract<NonNullable<TeamOverviewView["gamesUsage"]>, { readonly status: "available" }>
    | undefined => {
    const value = facts()?.gamesUsage;
    return value?.status === "available" ? value : undefined;
  };
  const usageReason = (): string => {
    const value = facts()?.gamesUsage;
    return value?.status === "not_published"
      ? value.detail
      : "The provider did not publish this team's cap usage.";
  };
  return (
    <Card
      header={<SectionTitle id="team-season-title">Season overview</SectionTitle>}
      labelledBy="team-season-title"
    >
      <Stack gap="md">
        <SeasonArea detail loading={props.loading}>
          <Show
            fallback={
              <Show
                fallback={
                  <Text type="meta" tone="muted">
                    {props.failed
                      ? "Season facts could not be loaded. Controls and activity remain available."
                      : (facts()?.reason ?? "Season facts were not published.")}
                  </Text>
                }
                when={props.loading}
              >
                <Stack gap="md">
                  <Text type="meta" tone="muted">
                    Loading season facts.
                  </Text>
                  <OverviewLoadingRows count={10} paired />
                  <Stack gap="sm">
                    <SectionTitle level={3}>Current matchup</SectionTitle>
                    <OverviewLoadingRows count={6} paired />
                  </Stack>
                  <Stack gap="sm">
                    <SectionTitle level={3}>Season caps</SectionTitle>
                    <OverviewLoadingRows count={2} />
                  </Stack>
                </Stack>
              </Show>
            }
            when={facts() !== undefined && facts()?.reason === undefined}
          >
            <Stack gap="md">
              <DefinitionList compact paired>
                <Definition
                  compact
                  wide={standing()?.rank === null || standing()?.rank === undefined}
                  term="Place"
                  value={
                    standing()?.rank === null || standing()?.rank === undefined
                      ? (facts()?.standingReason ?? "Place not published.")
                      : `${standing()?.rank} of ${league()?.teamCount ?? "team count not published"}`
                  }
                />
                <Definition
                  compact
                  wide={facts()?.record === undefined || facts()?.record?.percentage === null}
                  term="Record"
                  value={
                    facts()?.record === undefined
                      ? (facts()?.recordReason ?? "Record not published.")
                      : recordLabel(facts()?.record)
                  }
                />
                <Definition compact term="Points" value={number(standing()?.pointsFor)} />
                <Definition
                  compact
                  term="Points against"
                  value={number(standing()?.pointsAgainst)}
                />
                <Definition compact term="Behind leader" value={number(standing()?.pointsBack)} />
                <Definition
                  compact
                  wide={
                    (scoringLabel(league()?.scoringLabel) ?? scoringFormatLabel(facts()?.format))
                      .length > 24
                  }
                  term="Scoring format"
                  value={
                    scoringLabel(league()?.scoringLabel) ?? scoringFormatLabel(facts()?.format)
                  }
                />
                <Show when={cap()?.gamesPlayed !== undefined}>
                  <Definition compact term="Games cap" value={number(cap()?.gamesPlayed)} />
                </Show>
                <Show when={cap()?.inningsPitched !== undefined}>
                  <Definition compact term="Innings cap" value={number(cap()?.inningsPitched)} />
                </Show>
                <Show
                  when={
                    league()?.weeklyDeadline !== undefined &&
                    league()?.weeklyDeadline !== "" &&
                    league()?.weeklyDeadline !== "intraday"
                  }
                >
                  <Definition compact term="Lineup changes" value="Weekly" />
                </Show>
                <Show
                  when={
                    facts()?.seasonProgress?.currentPeriod !== undefined &&
                    facts()?.seasonProgress?.lastPeriod !== undefined &&
                    (facts()?.seasonProgress?.currentPeriod ?? 0) <=
                      (facts()?.seasonProgress?.lastPeriod ?? 0)
                  }
                >
                  <Definition
                    compact
                    term="Season progress"
                    value={`Week ${facts()?.seasonProgress?.currentPeriod} of ${facts()?.seasonProgress?.lastPeriod}`}
                  />
                </Show>
                <Show
                  when={
                    (facts()?.seasonProgress?.currentPeriod === undefined ||
                      (facts()?.seasonProgress?.currentPeriod ?? 0) >
                        (facts()?.seasonProgress?.lastPeriod ?? Number.POSITIVE_INFINITY)) &&
                    (facts()?.seasonProgress?.endDate ?? league()?.endDate)
                  }
                >
                  <Definition
                    compact
                    term={
                      (facts()?.seasonProgress?.currentPeriod ?? 0) >
                      (facts()?.seasonProgress?.lastPeriod ?? Number.POSITIVE_INFINITY)
                        ? "Season ended"
                        : "Season ends"
                    }
                    value={facts()?.seasonProgress?.endDate ?? league()?.endDate ?? ""}
                  />
                </Show>
              </DefinitionList>
              <Stack gap="sm">
                <SectionTitle level={3}>Current matchup</SectionTitle>
                <Show
                  fallback={
                    <Text type="meta" tone="muted">
                      {facts()?.matchupReason ?? "No current matchup was published."}
                    </Text>
                  }
                  when={matchup()}
                >
                  {(current) => (
                    <>
                      <Inline gap="sm">
                        <Text type="body">
                          Week {current().week} · Against {current().opponent}
                        </Text>
                        <Show when={current().statusLabel}>
                          <Text type="meta" tone="muted">
                            {current().statusLabel}
                          </Text>
                        </Show>
                      </Inline>
                      <DefinitionList compact paired>
                        <Definition compact term="Your points" value={number(current().points)} />
                        <Definition
                          compact
                          term="Opponent points"
                          value={number(current().opponentPoints)}
                        />
                        <Definition
                          compact
                          term="Your projected points"
                          value={number(current().projectedPoints)}
                        />
                        <Definition
                          compact
                          term="Opponent projected points"
                          value={number(current().opponentProjectedPoints)}
                        />
                        <Show when={current().remainingGames !== undefined}>
                          <Definition
                            compact
                            term="Your remaining games"
                            value={number(current().remainingGames)}
                          />
                        </Show>
                        <Show when={current().opponentRemainingGames !== undefined}>
                          <Definition
                            compact
                            term="Opponent remaining games"
                            value={number(current().opponentRemainingGames)}
                          />
                        </Show>
                      </DefinitionList>
                    </>
                  )}
                </Show>
              </Stack>
              <Disclosure summary="Scoring detail">
                <Stack gap="sm">
                  <Show
                    when={facts()?.format === "rotisserie"}
                    fallback={
                      <Show
                        when={(matchup()?.categories.length ?? 0) > 0}
                        fallback={
                          <Text type="meta" tone="muted">
                            {facts()?.categoryReason ?? "Category values were not published."}
                          </Text>
                        }
                      >
                        <DefinitionList compact>
                          {EffectArray.map(matchup()?.categories ?? [], (row) => (
                            <Definition
                              compact
                              term={`${row.name}${row.scoring === "informational" ? " (informational)" : ""}`}
                              value={`You: ${number(row.own)} · Opponent: ${number(row.opponent)}`}
                            />
                          ))}
                        </DefinitionList>
                      </Show>
                    }
                  >
                    <Show
                      when={(facts()?.categoryPoints?.length ?? 0) > 0}
                      fallback={
                        <Text type="meta" tone="muted">
                          {facts()?.categoryReason ?? "Season category points were not published."}
                        </Text>
                      }
                    >
                      <DefinitionList compact>
                        {EffectArray.map(facts()?.categoryPoints ?? [], (row) => (
                          <Definition
                            compact
                            term={`${row.name}${row.scoring === "informational" ? " (informational)" : ""}`}
                            value={number(row.value)}
                          />
                        ))}
                      </DefinitionList>
                    </Show>
                  </Show>
                </Stack>
              </Disclosure>
              <Show when={hasCap()}>
                <Stack gap="sm">
                  <SectionTitle level={3}>Season caps</SectionTitle>
                  <DefinitionList compact>
                    <Show when={usage()}>
                      <>
                        {EffectArray.map(usage()?.games ?? [], (row) => (
                          <Definition
                            compact
                            term={`${row.position} games`}
                            value={`${number(row.played)} played · ${number(row.projected)} projected`}
                          />
                        ))}
                        <Show when={usage()?.innings}>
                          {(innings) => (
                            <Definition
                              compact
                              term="Innings pitched"
                              value={`${number(innings().pitched)} pitched · ${number(innings().projected)} projected`}
                            />
                          )}
                        </Show>
                      </>
                    </Show>
                  </DefinitionList>
                  <Show when={usage() === undefined}>
                    <Notice tone="neutral" title="Usage not published">
                      <Text type="meta">{usageReason()}</Text>
                    </Notice>
                  </Show>
                </Stack>
              </Show>
            </Stack>
          </Show>
        </SeasonArea>
      </Stack>
    </Card>
  );
}

function scoringFormatLabel(format: TeamOverviewView["format"]): string {
  switch (format) {
    case "head_to_head_categories":
      return "Head to head categories";
    case "head_to_head_points":
      return "Head to head points";
    case "rotisserie":
      return "Rotisserie";
    case "unknown":
    case undefined:
      return "Unknown scoring format";
  }
}

function recordLabel(record: TeamOverviewView["record"]): string {
  if (record === undefined) {
    return "Record not published.";
  }
  const totals = `${record.wins}-${record.losses}-${record.ties}`;
  return record.percentage === null
    ? `${totals} (percentage not published)`
    : `${totals} (${EffectString.replace(record.percentage.toFixed(3), /^0/u, "")})`;
}
