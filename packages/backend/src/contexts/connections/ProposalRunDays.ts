import type { DateTime } from "effect";

import { startOfFantasyDay } from "./FantasyDay.ts";
import type { ProposalOrderTimingRule } from "./ProposalOrder.ts";
import type { ProviderFantasyDay } from "./Provider.ts";

export type ProposalRunDayGroup<Item> = {
  readonly date: string;
  readonly triggerAt: DateTime.Utc;
  readonly timeZone: string;
  readonly effectiveRule: ProposalOrderTimingRule;
  readonly items: ReadonlyArray<Item>;
};

export function proposalRunDayGroups<Item extends { readonly window?: string }>(input: {
  readonly items: ReadonlyArray<Item>;
  readonly today: string;
  readonly effectiveRule: ProposalOrderTimingRule;
  readonly fantasyDay: ProviderFantasyDay;
}): ReadonlyArray<ProposalRunDayGroup<Item>> {
  const byDate = new Map<string, Array<Item>>();
  for (const item of input.items) {
    const date = runsOn(item, input.today);
    const current = byDate.get(date) ?? [];
    current.push(item);
    byDate.set(date, current);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, items]) => ({
      date,
      triggerAt: startOfFantasyDay(date, input.fantasyDay),
      timeZone: input.fantasyDay.timeZone,
      effectiveRule: input.effectiveRule,
      items,
    }));
}

function runsOn(item: { readonly window?: string }, today: string): string {
  return item.window !== undefined && item.window > today ? item.window : today;
}
