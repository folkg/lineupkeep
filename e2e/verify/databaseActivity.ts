import { setTimeout as delay } from "node:timers/promises";

import { Option, Schema } from "effect";
import postgres from "postgres";

export function postgresProbe(databaseUrl: string): DatabaseProbe {
  return {
    observe: async () => {
      const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => undefined });
      let log: LogPosition;
      try {
        await sql`set auto_explain.log_min_duration = -1`;
        log = await logPosition(sql);
        await sql`select pg_stat_statements_reset()`;
      } catch (error) {
        await sql.end({ timeout: 5 });
        throw error;
      }
      return async () => {
        try {
          const statements = await sql<StatementRow[]>`
            select query, calls::int, total_exec_time, rows::int,
                   shared_blks_hit::int, shared_blks_read::int
            from pg_stat_statements
            order by total_exec_time desc`;
          const end = await settledLogPosition(sql, log.path);
          const lines =
            end.size > log.size
              ? ((
                  await sql<{ text: string }[]>`
                    select pg_read_file(${log.path}, ${log.size}, ${end.size - log.size}) as text`
                )[0]?.text ?? "")
              : "";
          return {
            statements: statements
              .filter((row) => !isProbeStatement(row.query))
              .map((row) => ({
                query: row.query,
                calls: row.calls,
                totalMs: tenths(row.total_exec_time),
                meanMs: tenths(row.total_exec_time / Math.max(row.calls, 1)),
                rows: row.rows,
                sharedBlocksHit: row.shared_blks_hit,
                sharedBlocksRead: row.shared_blks_read,
              })),
            plans: parsePlanLog(lines).filter((plan) => !isProbeStatement(plan.query)),
          };
        } finally {
          await sql.end({ timeout: 5 });
        }
      };
    },
  };
}

export function parsePlanLog(lines: string): ReadonlyArray<StatementPlan> {
  return lines.split("\n").flatMap((line) => {
    const entry = Option.getOrUndefined(Schema.decodeOption(LogLine)(line));
    const match =
      entry === undefined ? null : /^duration: ([\d.]+) ms\s+plan:\n/u.exec(entry.message);
    if (entry === undefined || match === null) {
      return [];
    }
    const explained = Option.getOrUndefined(
      Schema.decodeOption(Explained)(entry.message.slice(match[0].length)),
    );
    if (explained === undefined) {
      return [];
    }
    const top = explained.Plan;
    return [
      {
        query: explained["Query Text"].trim(),
        durationMs: tenths(Number(match[1])),
        plan: describePlan(top),
        rows: numberAt(top, "Actual Rows"),
        sharedBlocksHit: numberAt(top, "Shared Hit Blocks"),
        sharedBlocksRead: numberAt(top, "Shared Read Blocks"),
        sequentialScans: planNodes(top)
          .filter((node) => node["Node Type"] === "Seq Scan")
          .map((node) => text(node["Relation Name"])),
        detail: top,
      },
    ];
  });
}

export function describePlan(plan: PlanNode): string {
  return planNodes(plan)
    .map((node) => {
      const relation = text(node["Relation Name"]);
      const index = text(node["Index Name"]);
      return `${text(node["Node Type"])}${index === "" ? "" : ` using ${index}`}${relation === "" ? "" : ` on ${relation}`}`;
    })
    .join(" → ");
}

function planNodes(plan: PlanNode): ReadonlyArray<PlanNode> {
  const children = plan["Plans"];
  return [plan, ...(Array.isArray(children) ? children.filter(isPlanNode).flatMap(planNodes) : [])];
}

function isPlanNode(value: unknown): value is PlanNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberAt(node: PlanNode, key: string): number | undefined {
  const value = node[key];
  return typeof value === "number" ? value : undefined;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function logPosition(sql: postgres.Sql): Promise<LogPosition> {
  const [current] = await sql<{ path: string | null }[]>`
    select pg_current_logfile('jsonlog') as path`;
  if (current?.path === undefined || current.path === null) {
    throw new Error("The database does not log JSON, so its query plans cannot be read.");
  }
  return { path: current.path, size: await logSize(sql, current.path) };
}

async function settledLogPosition(sql: postgres.Sql, path: string): Promise<LogPosition> {
  let size = await logSize(sql, path);
  for (let polls = 0; polls < logSettlePolls; polls += 1) {
    await delay(logSettleIntervalMs);
    const next = await logSize(sql, path);
    if (next === size) {
      return { path, size };
    }
    size = next;
  }
  throw new Error(
    "The database log kept growing, so the interaction's plans could not be bounded.",
  );
}

async function logSize(sql: postgres.Sql, path: string): Promise<number> {
  const [file] = await sql<{ size: number }[]>`select (pg_stat_file(${path})).size::int as size`;
  if (file === undefined) {
    throw new Error(`The database log ${path} could not be read.`);
  }
  return file.size;
}

function isProbeStatement(query: string): boolean {
  return /pg_stat_statements|pg_current_logfile|pg_stat_file|pg_read_file/u.test(query);
}

function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

const logSettleIntervalMs = 100;
const logSettlePolls = 30;

const LogLine = Schema.fromJsonString(Schema.Struct({ message: Schema.String }));
const Explained = Schema.fromJsonString(
  Schema.Struct({
    "Query Text": Schema.String,
    Plan: Schema.Record(Schema.String, Schema.Unknown),
  }),
);

type PlanNode = Readonly<Record<string, unknown>>;

type LogPosition = { readonly path: string; readonly size: number };

type StatementRow = {
  readonly query: string;
  readonly calls: number;
  readonly total_exec_time: number;
  readonly rows: number;
  readonly shared_blks_hit: number;
  readonly shared_blks_read: number;
};

export type StatementPlan = {
  readonly query: string;
  readonly durationMs: number;
  readonly plan: string;
  readonly rows: number | undefined;
  readonly sharedBlocksHit: number | undefined;
  readonly sharedBlocksRead: number | undefined;
  readonly sequentialScans: ReadonlyArray<string>;
  readonly detail: PlanNode;
};

export type DatabaseActivity = {
  readonly statements: ReadonlyArray<{
    readonly query: string;
    readonly calls: number;
    readonly totalMs: number;
    readonly meanMs: number;
    readonly rows: number;
    readonly sharedBlocksHit: number;
    readonly sharedBlocksRead: number;
  }>;
  readonly plans: ReadonlyArray<StatementPlan>;
};

export type DatabaseProbe = {
  readonly observe: () => Promise<() => Promise<DatabaseActivity>>;
};
