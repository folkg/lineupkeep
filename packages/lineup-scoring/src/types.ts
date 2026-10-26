export type StatId = string;

export type ScoringCategory = {
  readonly statId: StatId;
  readonly label: string;
};

export type ScoringRule = {
  readonly statId: StatId;
  readonly points: Exact;
};

export type ScoringProfile = {
  readonly categories: ReadonlyArray<ScoringCategory>;
  readonly rules: ReadonlyArray<ScoringRule>;
  readonly scale: number;
};

export type StatValue = string | number;

export type StatObservation = {
  readonly statId: StatId;
  readonly value: StatValue | null;
};

export type PeriodScore =
  | { readonly kind: "scored"; readonly points: Exact; readonly coverage: PeriodCoverage }
  | {
      readonly kind: "unknown";
      readonly reasons: ReadonlyArray<PeriodScoreUnknown>;
      readonly coverage: PeriodCoverage;
    };

export type PeriodScoreUnknown =
  | { readonly kind: "no-observations" }
  | { readonly kind: "value-unknown"; readonly statId: StatId };

export type PeriodCoverage = {
  readonly scored: ReadonlyArray<StatId>;
  readonly absent: ReadonlyArray<StatId>;
  readonly unknown: ReadonlyArray<StatId>;
  readonly unscored: ReadonlyArray<StatId>;
};

export type ScoringCoverage = {
  readonly scored: ReadonlyArray<StatId>;
  readonly unscored: ReadonlyArray<StatId>;
  readonly unusedRules: ReadonlyArray<StatId>;
  readonly rulesWithoutCategory: ReadonlyArray<StatId>;
  readonly categoriesWithoutRule: ReadonlyArray<StatId>;
};

export type Exact = {
  readonly units: bigint;
  readonly scale: number;
};
