import { spawn, spawnSync } from "node:child_process";
import { renameSync, writeFileSync, writeSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Schema } from "effect";

export async function runVerification(plan: VerificationPlan): Promise<VerificationOutcome> {
  plan.signal.throwIfAborted();
  const recovered = await acquireLock(plan);
  const owner = new OwnerJournal(plan.lockDirectory);
  const steps: Array<CleanupStep> = [];
  const commands: Array<CommandRecord> = [];
  let failure: unknown;
  try {
    await using resources = new AsyncDisposableStack();
    let origins: ReadonlyArray<URL> = [];
    resources.defer(() => cleanupStep(steps, "release owned ports", () => portsReleased(origins)));
    const processes = new OwnedProcesses(processJournal(plan.directory), []);
    resources.defer(() =>
      cleanupStep(steps, "stop owned processes", () =>
        processes.stop(plan.shutdownMs, plan.urgent),
      ),
    );
    for (const command of plan.prepare ?? []) {
      await runCommand(command, plan, processes, commands);
    }
    const stack = await acquireInfrastructure(plan, owner, resources, steps, (pid) =>
      processes.adopt(pid),
    );
    origins = Object.values(stack.ports).map((port) => new URL(`http://127.0.0.1:${port}`));
    await owner.setPorts(origins);
    for (const command of plan.commands(stack)) {
      await runCommand(command, plan, processes, commands);
    }
  } catch (error) {
    failure = error;
  }
  return finish(plan, owner, { steps, commands, recovered }, failure);
}

export async function recoverVerification(
  lockDirectory: string,
  infrastructureNamed: (name: string) => OwnedInfrastructure,
  shutdownMs: number,
  options: RecoveryOptions = {},
): Promise<RecoveryOutcome> {
  const urgent = options.urgent ?? new AbortController().signal;
  const journal = new OwnerJournal(lockDirectory);
  const seen = await journal.read();
  if (isAlive(seen.owner)) {
    return { status: "owner-running", owner: seen };
  }
  const claimed = await claimRecovery(lockDirectory);
  if (claimed.kind === "in-progress") {
    return { status: "recovery-in-progress", owner: seen };
  }
  if (claimed.kind === "damaged") {
    return { status: "damaged-recovery-claim", owner: seen };
  }
  const claim = claimed.path;

  const owner = await journal.read();
  if (owner.runId !== seen.runId || isAlive(owner.owner)) {
    await rm(claim, { recursive: true, force: true });
    return { status: "lock-changed", owner };
  }
  const steps: Array<CleanupStep> = [];
  await cleanupStep(steps, "stop journaled processes", async () => {
    const recorded = await readOwnedProcesses(processJournal(owner.directory));
    return new OwnedProcesses(processJournal(owner.directory), recorded).stop(shutdownMs, urgent);
  });
  const database = infrastructureNamed(owner.infrastructure.name);
  await cleanupStep(steps, `destroy infrastructure ${database.name}`, (signal) =>
    releaseJournaledInfrastructure(owner.infrastructure.state, database, signal),
  );
  await cleanupStep(steps, "release owned ports", () =>
    portsReleased(owner.ports.map((port) => new URL(port))),
  );
  const complete = steps.every((step) => step.status === "done");
  await writeFile(
    join(owner.directory, "recovery.json"),
    JSON.stringify({ runId: owner.runId, complete, steps, recoveredAt: now() }, null, 2),
  );

  if (complete) {
    await rm(lockDirectory, { recursive: true });
  } else {
    await rm(claim, { recursive: true });
  }
  return { status: complete ? "recovered" : "incomplete", owner, steps };
}

export async function isOrphaned(lockDirectory: string, databaseName: string): Promise<boolean> {
  try {
    return (await new OwnerJournal(lockDirectory).read()).infrastructure.name !== databaseName;
  } catch {
    try {
      await stat(lockDirectory);
      return false;
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "ENOENT";
    }
  }
}

async function acquireInfrastructure(
  plan: VerificationPlan,
  owner: OwnerJournal,
  resources: AsyncDisposableStack,
  steps: Array<CleanupStep>,
  adopt: (pid: number) => void,
): Promise<Stack> {
  plan.signal.throwIfAborted();
  await owner.setInfrastructure("creating");
  let confirmed = false;

  resources.defer(() =>
    cleanupStep(steps, `destroy infrastructure ${plan.infrastructure.name}`, async (signal) => {
      await plan.infrastructure.remove(signal, confirmed);
      await owner.setInfrastructure("absent");
    }),
  );
  const stack = await plan.infrastructure.create(plan.signal, adopt);
  confirmed = true;
  await owner.setInfrastructure("created");
  return stack;
}

async function releaseJournaledInfrastructure(
  state: InfrastructureState,
  database: OwnedInfrastructure,
  signal: AbortSignal,
): Promise<void> {
  if (state !== "absent") {
    await database.remove(signal, state === "created");
  }
}

async function finish(
  plan: VerificationPlan,
  owner: OwnerJournal,
  record: {
    readonly steps: ReadonlyArray<CleanupStep>;
    readonly commands: ReadonlyArray<CommandRecord>;
    readonly recovered: RecoveryOutcome | undefined;
  },
  failure: unknown,
): Promise<VerificationOutcome> {
  const complete = record.steps.every((step) => step.status === "done");
  const outcome = {
    status: failure === undefined ? "completed" : plan.signal.aborted ? "interrupted" : "failed",
    failure: failure === undefined ? undefined : describe(failure),
    cleanupComplete: complete,
    steps: record.steps,
    commands: record.commands,
    recoveredRun: record.recovered?.owner.runId,
    lock: complete ? "released" : "retained",
  } satisfies Omit<VerificationOutcome, "problems">;
  const problems: Array<string> = [];
  try {
    await writeFile(
      join(plan.directory, "cleanup.json"),
      JSON.stringify({ runId: plan.runId, ...outcome, finishedAt: now() }, null, 2),
    );
  } catch (error) {
    problems.push(`Cleanup report could not be written: ${describe(error)}`);
  }
  try {
    if (complete) {
      await rm(plan.lockDirectory, { recursive: true });
    } else {
      await owner.markCleanupIncomplete();
    }
  } catch (error) {
    problems.push(`Lock could not be updated: ${describe(error)}`);
  }
  return { ...outcome, problems };
}

async function runCommand(
  command: VerificationCommand,
  plan: VerificationPlan,
  processes: OwnedProcesses,
  record: Array<CommandRecord>,
): Promise<void> {
  plan.signal.throwIfAborted();
  console.log(`Application verification: ${command.name}`);
  const started = Date.now();
  await using log = await open(join(plan.directory, `${command.name}.log`), "wx");
  plan.signal.throwIfAborted();
  const output = command.echo === true ? "pipe" : log.fd;
  const child = spawn(command.executable, command.arguments, {
    cwd: command.cwd,
    env: command.environment,
    detached: true,
    stdio: ["ignore", output, output],
  });

  let lostOutput: unknown;
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk: Buffer) => {
      try {
        writeSync(log.fd, chunk);
        process.stdout.write(chunk);
      } catch (error) {
        lostOutput ??= error;
      }
    });
  }
  const exit = new Promise<{ readonly code: number | null; readonly signal: string | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    },
  );
  const group = child.pid;
  if (group !== undefined) {
    processes.adopt(group);
  }
  let escalation: NodeJS.Timeout | undefined;
  const stop = (): void => {
    signalGroup(group, "SIGINT");
    escalation = setTimeout(() => signalGroup(group, "SIGKILL"), plan.shutdownMs);
  };
  const kill = (): void => signalGroup(group, "SIGKILL");
  plan.signal.addEventListener("abort", stop, { once: true });
  plan.urgent.addEventListener("abort", kill, { once: true });

  if (plan.signal.aborted) {
    stop();
  }
  if (plan.urgent.aborted) {
    kill();
  }
  let status: CommandRecord["status"] = "failed";
  try {
    const { code, signal } = await exit;

    await Promise.race([
      Promise.all(
        [child.stdout, child.stderr].map(
          (stream) =>
            new Promise((resolve) => {
              if (stream === null || stream.readableEnded) {
                resolve(undefined);
              } else {
                stream.once("close", resolve);
              }
            }),
        ),
      ),
      delay(outputDrainMs),
    ]);
    if (plan.signal.aborted) {
      status = "stopped";
      throw new Error(`${command.name} was stopped: ${describe(plan.signal.reason)}`);
    }
    if (code !== 0) {
      throw new Error(
        `${command.name} did not complete successfully (${code ?? signal}). See ${command.name}.log.`,
      );
    }
    if (lostOutput !== undefined) {
      throw new Error(`${command.name}'s output could not be logged: ${describe(lostOutput)}`);
    }
    status = "completed";
  } finally {
    plan.signal.removeEventListener("abort", stop);
    plan.urgent.removeEventListener("abort", kill);
    clearTimeout(escalation);
    record.push({ name: command.name, status, durationMs: Date.now() - started });
  }
}

class OwnedProcesses {
  constructor(journal: string, recorded: ReadonlyArray<OwnedProcess>) {
    this.journal = journal;
    for (const entry of recorded) {
      this.known.set(identity(entry), entry);
    }
    this.persist();
  }

  adopt(pid: number): void {
    const table = processTable();
    const root = table.find((entry) => entry.pid === pid);
    if (root !== undefined) {
      this.known.set(identity(root), root);
      this.persist();
    }
    this.observe(table);
    this.timer ??= setInterval(() => this.observe(processTable()), samplingMs);
  }

  async stop(graceMs: number, urgent: AbortSignal): Promise<string | void> {
    clearInterval(this.timer);
    const waitForExit = async (): Promise<void> => {
      const deadline = Date.now() + graceMs;
      while (this.alive().length > 0 && Date.now() < deadline && !urgent.aborted) {
        await delay(samplingMs);
      }
    };
    await waitForExit();
    if (this.alive().length === 0) {
      return;
    }
    const signalled = new Map<string, OwnedProcess>();
    const send = (entries: ReadonlyArray<OwnedProcess>, signal: NodeJS.Signals): void => {
      for (const entry of entries) {
        signalled.set(identity(entry), entry);
        signalProcess(entry.pid, signal);
      }
    };
    send(this.alive(), "SIGTERM");
    await waitForExit();

    let survivors = this.alive();
    let frozen = new Set<string>();
    while (survivors.some((entry) => !frozen.has(identity(entry)))) {
      send(survivors, "SIGSTOP");
      frozen = new Set(survivors.map(identity));
      survivors = this.alive();
    }
    send(survivors, "SIGKILL");
    await delay(200);
    const remaining = this.alive();
    if (remaining.length > 0) {
      throw new Error(
        `Owned processes survived SIGKILL: ${remaining.map(describeProcess).join("; ")}`,
      );
    }
    return `Stopped processes that outlived their command: ${[...signalled.values()].map(describeProcess).join("; ")}`;
  }

  private alive(): ReadonlyArray<OwnedProcess> {
    const table = processTable();
    this.observe(table);
    const running = new Set(table.map(identity));
    return [...this.known.values()].filter((entry) => running.has(identity(entry)));
  }

  private observe(table: ReadonlyArray<OwnedProcess>): void {
    const size = this.known.size;
    const live = (): {
      readonly pid: number;
      readonly ppid: number;
      readonly pgid: number;
      readonly started: string;
      readonly command: string;
    }[] => table.filter((entry) => this.known.has(identity(entry)));
    let grew = true;
    while (grew) {
      const owned = live();
      const parents = new Set(owned.map((entry) => entry.pid));
      const groups = new Set(owned.map((entry) => entry.pgid));
      const joined = table.filter(
        (entry) =>
          !this.known.has(identity(entry)) && (parents.has(entry.ppid) || groups.has(entry.pgid)),
      );
      for (const entry of joined) {
        this.known.set(identity(entry), entry);
      }
      grew = joined.length > 0;
    }
    if (this.known.size !== size) {
      this.persist();
    }
  }

  private persist(): void {
    const temporary = `${this.journal}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.known.values()], null, 2));
    renameSync(temporary, this.journal);
  }

  private readonly journal: string;
  private readonly known = new Map<string, OwnedProcess>();
  private timer: NodeJS.Timeout | undefined;
}

function describeProcess(entry: OwnedProcess): string {
  return `${entry.pid} ${entry.command.slice(0, 160)}`;
}

async function acquireLock(plan: VerificationPlan): Promise<RecoveryOutcome | undefined> {
  const self = ownProcess();
  await mkdir(dirname(plan.lockDirectory), { recursive: true });
  const staging = `${plan.lockDirectory}.${plan.runId}`;
  await mkdir(staging);
  await writeFile(processJournal(plan.directory), "[]");
  const owner: OwnerRecord = {
    runId: plan.runId,
    status: "running",
    owner: self,
    directory: plan.directory,
    infrastructure: { name: plan.infrastructure.name, state: "absent" },
    ports: [],
    startedAt: now(),
    ...(plan.alchemy === undefined ? {} : { alchemy: plan.alchemy }),
  };
  await writeFile(join(staging, "owner.json"), JSON.stringify(owner, null, 2));
  try {
    await rename(staging, plan.lockDirectory);
    return undefined;
  } catch (error) {
    let recovery: string;
    let inProgress = false;
    try {
      const recovered = await recoverVerification(
        plan.lockDirectory,
        plan.infrastructureNamed,
        plan.shutdownMs,
        { urgent: plan.urgent },
      );
      if (recovered.status === "recovered") {
        console.log(`Recovered the resources of abandoned run ${recovered.owner.runId}.`);
        await rename(staging, plan.lockDirectory);
        return recovered;
      }
      recovery = recovered.status;
      inProgress =
        recovered.status === "owner-running" || recovered.status === "recovery-in-progress";
    } catch (recoveryError) {
      recovery = `failed: ${describe(recoveryError)}`;
    }
    await rm(staging, { recursive: true });
    const holder = await readOwnerDescription(plan.lockDirectory);
    throw new LockHeld(plan.lockDirectory, `${holder}; recovery ${recovery}`, inProgress, error);
  }
}

async function claimRecovery(lockDirectory: string): Promise<RecoveryClaim> {
  const claims = (await readdir(lockDirectory)).filter((name) => recoveryClaim.test(name));
  for (const name of claims) {
    const holder = await readFile(join(lockDirectory, name, "holder.json"), "utf8")
      .then((text) => Schema.decodeSync(OwnedProcessJson)(text))
      .catch(() => undefined);

    if (holder === undefined) {
      return { kind: "damaged", name };
    }
    if (isAlive(holder)) {
      return { kind: "in-progress" };
    }
  }
  const next = Math.max(0, ...claims.map((name) => Number(name.slice("recovery-".length)))) + 1;
  const claim = join(lockDirectory, `recovery-${next}`);

  const staging = join(lockDirectory, `staging-${process.pid}-${Date.now()}`);
  await mkdir(staging);
  await writeFile(join(staging, "holder.json"), JSON.stringify(ownProcess()));
  try {
    await rename(staging, claim);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "EEXIST" || error.code === "ENOTEMPTY")
    ) {
      return { kind: "in-progress" };
    }
    throw error;
  }
  return { kind: "claimed", path: claim };
}

class OwnerJournal {
  constructor(lockDirectory: string) {
    this.path = join(lockDirectory, "owner.json");
  }

  async read(): Promise<OwnerRecord> {
    return Schema.decodeSync(OwnerRecordJson)(await readFile(this.path, "utf8"));
  }

  async setInfrastructure(state: InfrastructureState): Promise<void> {
    const owner = await this.read();
    await this.write({ ...owner, infrastructure: { ...owner.infrastructure, state } });
  }

  async setPorts(ports: ReadonlyArray<URL>): Promise<void> {
    await this.write({ ...(await this.read()), ports: ports.map((port) => port.href) });
  }

  async markCleanupIncomplete(): Promise<void> {
    await this.write({ ...(await this.read()), status: "cleanup-incomplete" });
  }

  private async write(owner: OwnerRecord): Promise<void> {
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(owner, null, 2));
    await rename(temporary, this.path);
  }

  private readonly path: string;
}

async function readOwnerDescription(lockDirectory: string): Promise<string> {
  try {
    const owner = await new OwnerJournal(lockDirectory).read();
    const state = isAlive(owner.owner) ? "owner running" : "owner gone";
    return `run ${owner.runId}, ${owner.status}, ${state}, evidence ${owner.directory}`;
  } catch (error) {
    return `owner record unreadable: ${describe(error)}`;
  }
}

async function readOwnedProcesses(path: string): Promise<ReadonlyArray<OwnedProcess>> {
  return Schema.decodeSync(OwnedProcessList)(await readFile(path, "utf8"));
}

function processJournal(directory: string): string {
  return join(directory, "processes.json");
}

async function cleanupStep(
  steps: Array<CleanupStep>,
  name: string,
  release: (signal: AbortSignal) => Promise<string | void>,
): Promise<void> {
  const signal = AbortSignal.timeout(cleanupStepMs);
  const deadline = new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () =>
      reject(new Error(`timed out after ${cleanupStepMs} ms`)),
    );
  });
  try {
    const detail = await Promise.race([release(signal), deadline]);
    steps.push(detail === undefined ? { name, status: "done" } : { name, status: "done", detail });
  } catch (error) {
    steps.push({ name, status: "failed", detail: describe(error) });
  }
}

async function portsReleased(ports: ReadonlyArray<URL>): Promise<void> {
  for (const port of ports) {
    const deadline = Date.now() + 5000;
    while (await isListening(port)) {
      if (Date.now() > deadline) {
        throw new Error(`${port.origin} is still listening after cleanup.`);
      }
      await delay(200);
    }
  }
}

function isListening(url: URL): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/gu, ""), port: Number(url.port) });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`${url.origin} did not answer or refuse a connection.`));
    });
    socket.once("error", (error) => {
      if ("code" in error && error.code === "ECONNREFUSED") {
        resolve(false);
      } else {
        reject(error);
      }
    });
  });
}

function processTable(): ReadonlyArray<OwnedProcess> {
  const result = spawnSync("ps", ["-A", "-o", "pid=,ppid=,pgid=,lstart=,args="], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },

    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`ps failed: ${result.stderr}`);
  }
  return result.stdout.split("\n").flatMap((line) => {
    const match =
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/u.exec(line);
    return match === null
      ? []
      : [
          {
            pid: Number(match[1]),
            ppid: Number(match[2]),
            pgid: Number(match[3]),
            started: match[4]?.replaceAll(/\s+/gu, " ") ?? "",
            command: match[5] ?? "",
          },
        ];
  });
}

function ownProcess(): OwnedProcess {
  const self = processTable().find((entry) => entry.pid === process.pid);
  if (self === undefined) {
    throw new Error("Cannot identify the application verification process in the process table.");
  }
  return self;
}

function isAlive(entry: OwnedProcess): boolean {
  return processTable().some((candidate) => identity(candidate) === identity(entry));
}

function identity(entry: OwnedProcess): string {
  return `${entry.pid}@${entry.started}`;
}

function signalGroup(group: number | undefined, signal: NodeJS.Signals): void {
  if (group !== undefined) {
    signalProcess(-group, signal);
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) {
      throw error;
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function now(): string {
  return new Date().toISOString();
}

const samplingMs = 100;

const cleanupStepMs = 60_000;

const outputDrainMs = 2000;

const recoveryClaim = /^recovery-\d+$/u;

export class LockHeld extends Error {
  readonly inProgress: boolean;

  constructor(lockDirectory: string, owner: string, inProgress: boolean, cause: unknown) {
    super(
      inProgress
        ? `Another application verification is in progress (${owner}).`
        : `Another application verification holds ${lockDirectory} (${owner}), and its recovery was incomplete: read recovery.json in its evidence and ask for help.`,
      { cause },
    );
    this.inProgress = inProgress;
  }
}

const OwnedProcessSchema = Schema.Struct({
  pid: Schema.Int,
  ppid: Schema.Int,
  pgid: Schema.Int,
  started: Schema.String,
  command: Schema.String,
});
type OwnedProcess = typeof OwnedProcessSchema.Type;
const OwnedProcessJson = Schema.fromJsonString(OwnedProcessSchema);
const OwnedProcessList = Schema.fromJsonString(Schema.Array(OwnedProcessSchema));

const InfrastructureStateSchema = Schema.Literals(["absent", "creating", "created"]);
type InfrastructureState = typeof InfrastructureStateSchema.Type;

const AlchemyOwnership = Schema.Struct({
  stage: Schema.String,
  cwd: Schema.String,
  manifest: Schema.String,
  sourceFingerprint: Schema.String,
});

const OwnerRecordSchema = Schema.Struct({
  runId: Schema.String,
  status: Schema.Literals(["running", "cleanup-incomplete"]),
  owner: OwnedProcessSchema,
  directory: Schema.String,
  infrastructure: Schema.Struct({ name: Schema.String, state: InfrastructureStateSchema }),
  ports: Schema.Array(Schema.String),
  startedAt: Schema.String,
  alchemy: Schema.optional(AlchemyOwnership),
});
type OwnerRecord = typeof OwnerRecordSchema.Type;
const OwnerRecordJson = Schema.fromJsonString(OwnerRecordSchema);

export type VerificationPlan = {
  readonly runId: string;
  readonly directory: string;
  readonly lockDirectory: string;
  readonly infrastructure: OwnedInfrastructure;
  readonly alchemy?: typeof AlchemyOwnership.Type;
  readonly prepare?: ReadonlyArray<VerificationCommand>;
  readonly commands: (stack: Stack) => ReadonlyArray<VerificationCommand>;
  readonly signal: AbortSignal;
  readonly urgent: AbortSignal;
  readonly shutdownMs: number;
  readonly infrastructureNamed: (name: string) => OwnedInfrastructure;
};

export type Stack = {
  readonly database: URL;
  readonly ports: Readonly<Record<string, number>>;
  readonly inspector?: string;
};

export type VerificationCommand = {
  readonly name: string;
  readonly echo?: boolean;
  readonly executable: string;
  readonly arguments: ReadonlyArray<string>;
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
};

export type OwnedInfrastructure = {
  readonly name: string;
  readonly create: (signal: AbortSignal, adopt: (pid: number) => void) => Promise<Stack>;
  readonly remove: (signal: AbortSignal, creationConfirmed: boolean) => Promise<void>;
};

export type CleanupStep = {
  readonly name: string;
  readonly status: "done" | "failed";
  readonly detail?: string;
};

export type CommandRecord = {
  readonly name: string;
  readonly status: "completed" | "failed" | "stopped";
  readonly durationMs: number;
};

export type VerificationOutcome = {
  readonly status: "completed" | "failed" | "interrupted";
  readonly failure: string | undefined;
  readonly cleanupComplete: boolean;
  readonly steps: ReadonlyArray<CleanupStep>;
  readonly commands: ReadonlyArray<CommandRecord>;
  readonly recoveredRun: string | undefined;
  readonly lock: "released" | "retained";
  readonly problems: ReadonlyArray<string>;
};

type RecoveryClaim =
  | { readonly kind: "claimed"; readonly path: string }
  | { readonly kind: "in-progress" }
  | { readonly kind: "damaged"; readonly name: string };

export type RecoveryOptions = {
  readonly urgent?: AbortSignal;
};

export type RecoveryOutcome =
  | {
      readonly status:
        | "owner-running"
        | "recovery-in-progress"
        | "damaged-recovery-claim"
        | "lock-changed";
      readonly owner: OwnerRecord;
    }
  | {
      readonly status: "recovered" | "incomplete";
      readonly owner: OwnerRecord;
      readonly steps: ReadonlyArray<CleanupStep>;
    };
