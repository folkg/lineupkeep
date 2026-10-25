import { createHash } from "node:crypto";

import {
  docker,
  image,
  serverSettings,
  waitUntilReady,
} from "@lineupkeep/tools/local-stack/postgresContainer.ts";
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { Effect, Layer, Redacted, Schema } from "effect";

import { DatabaseDeployment } from "#infra/services/DatabaseDeployment.ts";

export const DevelopmentPostgres = Resource<
  Resource<
    "Lineupkeep.DevelopmentPostgres",
    DevelopmentDatabaseIdentity,
    { url: Redacted.Redacted<string> }
  >
>("Lineupkeep.DevelopmentPostgres");

export const developmentDatabase = Alchemy.Stack(
  "LineupkeepDevelopmentDatabase",
  { providers: developmentPostgresProvider(), state: Alchemy.localState() },
  Effect.gen(function* () {
    if (!(yield* AlchemyContext).dev) {
      return yield* Effect.die(new Error("Development database requires local mode"));
    }
    const database = yield* DevelopmentPostgres("Postgres", developmentDatabaseIdentity());
    return { url: database.url };
  }),
);

export const developmentDatabaseLayer = Layer.effect(DatabaseDeployment)(
  Effect.gen(function* () {
    const database = yield* DevelopmentPostgres.ref("Postgres", {
      stack: "LineupkeepDevelopmentDatabase",
      stage: "development",
    });
    return { runtimeUrl: database.url, directUrl: database.url };
  }),
);

export function developmentDatabaseIdentity(): {
  name: string;
  volume: string;
  checkout: string;
  restartPolicy: "unless-stopped";
} {
  const checkout = new URL("../../", import.meta.url).pathname;
  const hash = createHash("sha256").update(checkout).digest("hex").slice(0, 10);
  return {
    name: `lineupkeep-dev-${hash}`,
    volume: `lineupkeep-dev-${hash}-data`,
    checkout,
    restartPolicy: "unless-stopped",
  };
}

export async function resetDevelopmentDatabase(
  identity: DevelopmentDatabaseIdentity,
): Promise<void> {
  const { name, volume, checkout } = identity;
  if (await inspectContainer(identity)) {
    await docker(["rm", "--force", name]);
  }
  const volumes = await docker(["volume", "ls", "--quiet", "--filter", `name=^${volume}$`]);
  if (volumes !== "") {
    const [entry] = Schema.decodeSync(Volumes)(await docker(["volume", "inspect", volume]));
    if (entry?.Labels?.[ownerLabel] !== checkout || entry.Labels[purposeLabel] !== "development") {
      throw new Error("Refusing reset of a volume with different ownership labels");
    }
    await docker(["volume", "rm", volume]);
  }
}

export function developmentPostgresProvider(): Layer.Layer<
  Alchemy.Provider<
    Resource<
      "Lineupkeep.DevelopmentPostgres",
      DevelopmentDatabaseIdentity,
      {
        url: Redacted.Redacted<string>;
      }
    >
  >,
  never,
  never
> {
  return Provider.succeed(DevelopmentPostgres, {
    read: () => Effect.succeed(undefined),
    diff: () => Effect.succeed({ action: "update" as const }),
    reconcile: ({ news }) => Effect.tryPromise(() => startDatabase(news)),
    delete: ({ olds }) =>
      Effect.tryPromise(async () => {
        if (await inspectContainer(olds)) {
          await docker(["stop", olds.name]);
        }
      }),
  });
}

async function startDatabase(identity: DevelopmentDatabaseIdentity): Promise<{
  url: Redacted.Redacted<string>;
}> {
  const { name, volume, checkout } = identity;
  if (!(await inspectContainer(identity))) {
    await docker(["image", "inspect", image]).catch(() => docker(["pull", "--quiet", image]));
    const volumes = await docker(["volume", "ls", "--quiet", "--filter", `name=^${volume}$`]);
    if (volumes === "") {
      await docker([
        "volume",
        "create",
        "--label",
        `${ownerLabel}=${checkout}`,
        "--label",
        `${purposeLabel}=development`,
        volume,
      ]);
    }
    const [entry] = Schema.decodeSync(Volumes)(await docker(["volume", "inspect", volume]));
    if (entry?.Labels?.[ownerLabel] !== checkout || entry.Labels[purposeLabel] !== "development") {
      throw new Error("Refusing a development volume owned elsewhere");
    }
    await docker([
      "create",
      "--name",
      name,
      "--restart",
      identity.restartPolicy,
      "--label",
      `${ownerLabel}=${checkout}`,
      "--label",
      `${purposeLabel}=development`,
      "--publish",
      "127.0.0.1::5432",
      "--mount",
      `type=volume,src=${volume},dst=/var/lib/postgresql`,
      "--env",
      "POSTGRES_USER=lineupkeep_dev",
      "--env",
      "POSTGRES_PASSWORD=lineupkeep_dev_local_only",
      "--env",
      "POSTGRES_DB=lineupkeep_dev",
      image,
      ...serverSettings.flatMap((setting) => ["-c", setting]),
    ]);
  }
  await docker(["start", name]);
  const published = await docker(["port", name, "5432/tcp"]);
  const port = /^127\.0\.0\.1:(\d+)$/mu.exec(published)?.[1];
  if (port === undefined) {
    throw new Error("Development database has no loopback port");
  }
  const url = new URL(
    `postgres://lineupkeep_dev:lineupkeep_dev_local_only@127.0.0.1:${port}/lineupkeep_dev`,
  );
  await waitUntilReady(url, AbortSignal.timeout(60_000));
  return { url: Redacted.make(url.href) };
}

async function inspectContainer(identity: DevelopmentDatabaseIdentity): Promise<boolean> {
  const { name, volume, checkout } = identity;
  const names = await docker([
    "ps",
    "--all",
    "--format",
    "{{.Names}}",
    "--filter",
    `name=^/${name}$`,
  ]);
  if (names === "") {
    return false;
  }
  const [entry] = Schema.decodeSync(Containers)(await docker(["inspect", name]));
  if (
    entry?.Config.Labels?.[ownerLabel] !== checkout ||
    entry.Config.Labels[purposeLabel] !== "development" ||
    !entry.Mounts.some(
      (mount) => mount.Name === volume && mount.Destination === "/var/lib/postgresql",
    )
  ) {
    throw new Error("Refusing a development container with different ownership or storage");
  }
  return true;
}

type DevelopmentDatabaseIdentity = {
  readonly name: string;
  readonly volume: string;
  readonly checkout: string;
  readonly restartPolicy: "no" | "unless-stopped";
};

const ownerLabel = "lineupkeep.checkout";
const purposeLabel = "lineupkeep.purpose";
const Labels = Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String)));
const Volumes = Schema.fromJsonString(Schema.Array(Schema.Struct({ Labels })));
const Containers = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      Config: Schema.Struct({ Labels }),
      Mounts: Schema.Array(
        Schema.Struct({ Name: Schema.optional(Schema.String), Destination: Schema.String }),
      ),
    }),
  ),
);
