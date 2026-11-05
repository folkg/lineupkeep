import { dirname, relative } from "node:path";

import { expect, it } from "vitest";

import { checkArchitecture, checkLint } from "./architectureFixture.ts";
it("permits a view, its controller, and a pure workflow", async () => {
  const lint = await checkLint(referenceFeature);
  const architecture = await checkArchitecture(referenceFeature);

  expect(lint.status, lint.output).toBe(0);
  expect(architecture.status, architecture.output).toBe(0);
});

it.each([
  ["a query", 'import { useQuery } from "@tanstack/solid-query";', "useQuery"],
  ["a write", 'import { noteMutations } from "./noteMutations.ts";', "noteMutations"],
  [
    "a workflow",
    'import { noteEditorWorkflow } from "./noteEditorWorkflow.ts";',
    "noteEditorWorkflow",
  ],
  ["navigation", 'import { useNavigate } from "@tanstack/solid-router";', "useNavigate"],
])("rejects %s started by a view", async (_name, statement, binding) => {
  const files = {
    ...referenceFeature,
    "apps/web/src/browser/notes/NoteEditor.tsx": `${statement}
      export function NoteEditor() {
        return <>{String(${binding})}</>;
      }`,
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("views-render-controller-models");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("move them into a use*.ts controller");
});

it.each([
  ["Solid", 'import { createSignal } from "solid-js";', "createSignal"],
  ["a remote", 'import { noteRemote } from "./noteRemote.ts";', "noteRemote"],
  ["a controller", 'import { useNoteEditor } from "./useNoteEditor.ts";', "useNoteEditor"],
])("rejects a workflow that depends on %s", async (_name, statement, binding) => {
  const files = {
    ...referenceFeature,
    "apps/web/src/browser/notes/noteRemote.ts": "export const noteRemote = 1;",
    "apps/web/src/browser/notes/noteEditorWorkflow.ts": `${statement}
      export const noteEditorWorkflow = ${binding};`,
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toMatch(
    /workflows-(?:are-pure-transitions|import-no-requests-or-controllers)/,
  );
});

it("rejects running a workflow outside a controller, even through a helper", async () => {
  const files = {
    ...referenceFeature,
    "apps/web/src/browser/notes/editorHelper.ts": `
      import { useWorkflow } from "#browser/workflow/useWorkflow.ts";
      import { noteEditorWorkflow } from "./noteEditorWorkflow.ts";
      export const runEditor = () => useWorkflow(noteEditorWorkflow);`,
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("controllers-alone-run-workflows-and-writes");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("start them in a use*.ts controller");
});

it.each(["infra/stage.ts", "infra/alchemy.run.ts"])(
  "accepts feature infrastructure selected by %s",
  async (path) => {
    const result = await checkArchitecture({
      ...featureFixture,
      [path]: `export { uploads } from "./${relative(dirname(path), featureModule)}";`,
    });

    expect(result.status, result.output).toBe(0);
  },
);

it.each([
  "packages/backend/src/contexts/uploads/Upload.ts",

  "infra/features/other/cloudflare.ts",
])("rejects feature infrastructure imported by %s", async (path) => {
  const result = await checkArchitecture({
    ...featureFixture,
    [path]: `export { uploads } from "./${relative(dirname(path), featureModule)}";`,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("feature-infrastructure-only-used-by-stage-composition");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "register the Layer in infra/stage.ts or",
  );
});

it.each([
  "packages/backend/src/contexts/other/Other.ts",

  "packages/backend/src/contexts/uploads/internal/UploadRepository.ts",

  "infra/config.ts",
])("rejects feature infrastructure importing %s", async (path) => {
  const result = await checkArchitecture({
    ...featureFixture,
    [path]: "export const value = 1;",
    [featureModule]: `export { value } from "./${relative(dirname(featureModule), path)}";`,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("feature-infrastructure-uses-owned-public-contracts");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("import only its own root public");
});

it.each(["node:fs", "postgres"])(
  "rejects unrelated dependency %s in feature infrastructure",
  async (dependency) => {
    const result = await checkArchitecture({
      ...featureFixture,
      [featureModule]: `import * as dependency from "${dependency}"; export const uploads = dependency;`,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("feature-infrastructure-uses-owned-public-contracts");
    expect(result.output.replaceAll(/\s+/g, " ")).toContain("import only its own root public");
  },
);

it.each([
  "packages/backend/src/contexts/uploads/Uploads.ts",

  "apps/web/src/server-functions/uploads.ts",
])("rejects Alchemy and provider SDKs in %s", async (path) => {
  const result = await checkArchitecture({
    ...featureFixture,
    [path]:
      'export { Stack } from "alchemy"; export { Worker } from "alchemy/Cloudflare"; import * as sdk from "@google-cloud/storage"; export { sdk };',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("application-independent-of-provisioning");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "receive plain configuration or services from",
  );
  expect(result.output).toContain("alchemy");
  expect(result.output).toContain("@google-cloud/storage");
});

it("accepts consumers of the domain contract and an in-memory Layer without infrastructure", async () => {
  const result = await checkArchitecture({
    ...featureFixture,
    "packages/backend/src/contexts/uploads/internal/UploadWorkflow.ts":
      'export { Uploads } from "#contexts/uploads/Uploads.ts";',
    "packages/backend/src/contexts/uploads/UploadsTest.ts":
      'import { Effect, Layer } from "effect"; import { Uploads } from "./Uploads.ts"; export const uploadsTest = Layer.succeed(Uploads)({ read: () => Effect.succeed("contents") });',
    "apps/web/src/server/mcp/uploadTools.ts":
      'export { Uploads } from "@lineupkeep/backend/uploads/Uploads";',
  });

  expect(result.status, result.output).toBe(0);
});

it("permits same-domain package contracts without a configuration edit", async () => {
  const result = await checkArchitecture({
    "packages/backend/src/contexts/calendar/internal/CalendarLive.ts":
      'export { value } from "@lineupkeep/backend/calendar/Calendar";',
    "packages/backend/src/contexts/calendar/Calendar.ts": "export const value = 1;",
  });

  expect(result.status, result.output).toBe(0);
});

it.each([["@lineupkeep/backend/calendar/internal/CalendarRepository", "CalendarRepository.ts"]])(
  "rejects forbidden package imports through %s",
  async (specifier, file) => {
    const result = await checkArchitecture({
      "apps/web/src/server/calendar/read.ts": `export { value } from "${specifier}";`,
      [`packages/backend/src/contexts/calendar/internal/${file}`]: "export const value = 1;",
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("no-context-internals-outside-composition-roots");
    expect(result.output).not.toContain("no-unresolved-imports");
  },
);

it.each([
  'export type { Value } from "@lineupkeep/backend/calendar/internal/CalendarRepository";',
  'import { value as repositoryValue } from "@lineupkeep/backend/calendar/internal/CalendarRepository"; export const value = repositoryValue;',
])("rejects private package imports regardless of import form: %s", async (source) => {
  const result = await checkArchitecture({
    "apps/web/src/server/calendar/read.ts": source,
    "packages/backend/src/contexts/calendar/internal/CalendarRepository.ts":
      "export const value = 1; export type Value = string;",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-context-internals-outside-composition-roots");
  expect(result.output).not.toContain("no-unresolved-imports");
});

it("rejects runtime Test resources through wildcard package exports", async () => {
  const result = await checkArchitecture({
    "apps/web/src/server/calendar/read.ts":
      'export { value } from "@lineupkeep/backend/runtime/CalendarTest";',
    "packages/backend/src/runtime/CalendarTest.ts": "export const value = 1;",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("test-resources-only-used-by-tests");
  expect(result.output).not.toContain("no-unresolved-imports");
});

it("permits temporal helpers in controllers and primitives but not workflows", async () => {
  const helper = "apps/web/src/browser/timing/delay.ts";
  const files = { [helper]: "export const delay = 1;" };
  const accepted = await checkArchitecture({
    ...files,
    "apps/web/src/browser/calendar/useCalendar.ts":
      'export { delay } from "#browser/timing/delay.ts";',
    "apps/web/src/browser/shared-ui/Spinner.ts":
      'export { delay } from "#browser/timing/delay.ts";',
  });
  const rejected = await checkArchitecture({
    ...files,
    "apps/web/src/browser/calendar/CalendarWorkflow.ts":
      'export { delay } from "#browser/timing/delay.ts";',
  });

  expect(accepted.status, accepted.output).toBe(0);
  expect(rejected.status).toBeGreaterThan(0);
  expect(rejected.output).toContain("workflows-import-no-requests-or-controllers");
});

it("permits server helpers in excluded protocol directories but not universal helpers", async () => {
  const base = { "apps/web/src/server/calendar/read.ts": "export const read = 1;" };
  const accepted = {
    ...base,
    "apps/web/src/routes/calendar/-server/read.ts":
      'export { read } from "#server/calendar/read.ts";',
  };
  const rejected = {
    ...base,
    "apps/web/src/shared/calendar/read.ts": 'export { read } from "#server/calendar/read.ts";',
  };

  expect((await checkLint(accepted)).status).toBe(0);
  expect((await checkArchitecture(accepted)).status).toBe(0);
  expect((await checkLint(rejected)).status).toBeGreaterThan(0);
  expect((await checkArchitecture(rejected)).status).toBeGreaterThan(0);
});

it.each(["e2e/helper.ts", "tools/local-stack/example.ts"])(
  "rejects provisioning imports from %s",
  async (path) => {
    const result = await checkArchitecture({
      [path]: 'export { Stack } from "alchemy";',
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("application-independent-of-provisioning");
    expect(result.output.replaceAll(/\s+/g, " ")).toContain(
      "receive plain configuration or services from",
    );
  },
);

it.each([
  "e2e/helper.ts",

  "infra/hosts/example.ts",

  "tools/other/example.ts",
])("rejects shared local-stack imports from %s", async (path) => {
  const contract = "tools/local-stack/contract.ts";
  const result = await checkArchitecture({
    [path]: `export { value } from "./${relative(dirname(path), contract)}";`,
    [contract]: "export const value = 1;",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain(
    "local-stack-tools-only-used-by-local-infrastructure-and-supervisor",
  );
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "keep them in infra/local/, e2e/verify/, or",
  );
});

it.each(["infra/local/example.ts", "e2e/verify/example.ts", "tools/local-stack/example.ts"])(
  "accepts shared local-stack imports from %s",
  async (path) => {
    const contract = "tools/local-stack/contract.ts";
    const result = await checkArchitecture({
      [path]: `export { value } from "./${relative(dirname(path), contract)}";`,
      [contract]: "export const value = 1;",
    });

    expect(result.status, result.output).toBe(0);
  },
);

it("rejects shared local-stack imports of application contracts", async () => {
  const result = await checkArchitecture({
    "tools/local-stack/example.ts":
      'export { value } from "../../packages/backend/src/config/Settings.ts";',
    "packages/backend/src/config/Settings.ts": "export const value = 1;",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("local-stack-tools-are-independent");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "put integrations in infra/local/ or e2e/verify/",
  );
});

it("rejects infrastructure imports of application internals", async () => {
  const result = await checkArchitecture({
    "infra/example.ts": 'export { backend } from "@lineupkeep/web/server/backend.ts";',
    "apps/web/src/server/backend.ts": "export const backend = {};",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("infrastructure-uses-public-contracts-and-build-inputs");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "use public backend contracts or apps/web/deploy",
  );
});

it("rejects provisioning helpers imported by runtime modules", async () => {
  const result = await checkArchitecture({
    "apps/web/src/example.ts": 'export { stage } from "@lineupkeep/infra/stage.ts";',
    "infra/stage.ts": 'export const stage = "production";',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("application-independent-of-provisioning");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "receive plain configuration or services from",
  );
});

it("accepts public backend contracts and pure deployment inputs in infrastructure", async () => {
  const result = await checkArchitecture({
    "infra/example.ts":
      'export { Settings } from "../packages/backend/src/config/Settings.ts"; export { settings } from "@lineupkeep/web/deploy/settings.ts";',
    "packages/backend/src/config/Settings.ts": "export type Settings = { readonly port: number };",
    "apps/web/deploy/settings.ts": "export const settings = {};",
  });

  expect(result.status, result.output).toBe(0);
});

it.each([
  "@alchemy.run/cloudflare-runtime",
  "@distilled.cloud/gcp",

  "@neondatabase/api-client",
  "@aws-sdk/client-s3",
])("rejects provider package %s from application modules", async (name) => {
  const result = await checkArchitecture({
    "packages/backend/src/example.ts": `import * as sdk from "${name}"; export const example = sdk;`,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("application-independent-of-provisioning");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "receive plain configuration or services from",
  );
});

it.each([
  ["../../browser/notes/state.ts", "apps/web/src/browser/notes/state.ts"],

  [
    "../../../../../packages/backend/src/contexts/notes/internal/NoteRepository.ts",
    "packages/backend/src/contexts/notes/internal/NoteRepository.ts",
  ],
])("rejects MCP adapter dependency on %s", async (dependency, path) => {
  const files = {
    "apps/web/src/server/mcp/tools.ts": `export { value } from "${dependency}";`,
    [path]: "export const value = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("mcp-adapter-dependencies");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("use public backend use cases through");
});

it.each(["solid-js", "@tanstack/solid-router", "drizzle-orm", "better-auth"])(
  "rejects %s in MCP implementations",
  async (dependency) => {
    const result = await checkArchitecture({
      "apps/web/src/server/mcp/tools.ts": `import "${dependency}";`,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("mcp-adapter-dependencies");
    expect(result.output.replaceAll(/\s+/g, " ")).toContain("use public backend use cases through");
  },
);

it.each(["apps/web/src/routes/api/other.ts"])(
  "rejects importing MCP implementations from %s",
  async (path) => {
    const files = {
      [path]: 'import "../../server/mcp/tools.ts";',
      "apps/web/src/server/mcp/tools.ts": "export const value = 1;",
    };

    const result = await checkArchitecture(files);

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("mcp-only-used-by-protocol-route");
    expect(result.output.replaceAll(/\s+/g, " ")).toContain("use public backend use cases and");
  },
);

it("rejects backend calls and Effect in the MCP route", async () => {
  const files = { "apps/web/src/routes/mcp.ts": 'import "effect";' };

  const architecture = await checkArchitecture(files);
  const lint = await checkLint(files);

  expect(architecture.output).toContain("mcp-route-delegates-to-adapter");
  expect(architecture.output.replaceAll(/\s+/g, " ")).toContain(
    "delegate to apps/web/src/server/mcp/ and keep only",
  );
  expect(lint.output).toContain("no-restricted-imports");
});

it.each([
  "@better-auth/mcp",
  "@better-auth/cimd",
  "@better-auth/cimd/node",
  "@better-auth/oauth-provider",
])("confines %s to Auth's internal adapter", async (dependency) => {
  const rejected = await checkArchitecture({
    "packages/backend/src/runtime/Foreign.ts": `import "${dependency}";`,
  });
  const accepted = await checkArchitecture({
    "packages/backend/src/contexts/auth/internal/BetterAuthAdapter.ts": `import "${dependency}";`,
  });

  expect(rejected.output).toContain("oauth-packages-only-in-auth-adapter");
  expect(rejected.output.replaceAll(/\s+/g, " ")).toContain(
    "use AuthService and keep plugin composition",
  );
  expect(accepted.status, accepted.output).toBe(0);
});

it("confines the documented OAuth client plugin to the session client adapter", async () => {
  const rejected = await checkArchitecture({
    "apps/web/src/browser/notes/Foreign.ts": 'import "@better-auth/oauth-provider/client";',
  });
  const accepted = await checkArchitecture({
    "apps/web/src/browser/session/authClient.ts": 'import "@better-auth/oauth-provider/client";',
  });

  expect(rejected.output).toContain("oauth-client-only-in-session-adapter");
  expect(rejected.output.replaceAll(/\s+/g, " ")).toContain(
    "use browser/session/authClient.ts and register the plugin",
  );
  expect(accepted.status, accepted.output).toBe(0);
});

it.each(["packages/backend/src/runtime/BackendRuntime.ts"])(
  "keeps context implementation wiring out of %s",
  async (path) => {
    const result = await checkArchitecture({
      [path]: 'export { value } from "#contexts/example/internal/ExampleLive.ts";',
      "packages/backend/src/contexts/example/internal/ExampleLive.ts": "export const value = 1;",
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("no-context-internals-outside-composition-roots");
    expect(result.output).toContain("live-layers-only-used-by-composition-roots");
    expect(result.output).toContain("ApplicationLayer.ts");
  },
);

it("permits context implementation wiring in ApplicationLayer", async () => {
  const result = await checkArchitecture({
    "packages/backend/src/runtime/ApplicationLayer.ts":
      'export { value } from "#contexts/example/internal/ExampleLive.ts";',
    "packages/backend/src/contexts/example/internal/ExampleLive.ts": "export const value = 1;",
  });

  expect(result.status, result.output).toBe(0);
});

it("keeps feature scope catalogues out of Auth and permits application composition", async () => {
  const scope = "packages/backend/src/contexts/connections/TeamScopes.ts";
  const rejected = await checkArchitecture({
    "packages/backend/src/contexts/auth/internal/Foreign.ts":
      'import "#contexts/connections/TeamScopes.ts";',
    [scope]: "export const scopes = [];",
  });
  const accepted = await checkArchitecture({
    "packages/backend/src/runtime/BackendRuntime.ts":
      'import "#contexts/connections/TeamScopes.ts"; import "#contexts/auth/AuthorizationScopes.ts";',
    [scope]: "export const scopes = [];",
    "packages/backend/src/contexts/auth/AuthorizationScopes.ts": "export const scopes = [];",
  });

  expect(rejected.output).toContain("context-dependencies-auth");
  expect(rejected.output.replaceAll(/\s+/g, " ")).toContain(
    "declare only the needed public contract in permittedContextImports",
  );
  expect(accepted.status, accepted.output).toBe(0);
});

it.each(["node:dns/promises", "node:http", "node:https", "node:net", "node:tls"])(
  "confines %s to the process PublicInternet transport",
  async (dependency) => {
    const rejected = await checkArchitecture({
      "packages/backend/src/runtime/Foreign.ts": `import "${dependency}";`,
    });
    const accepted = await checkArchitecture({
      "packages/backend/src/runtime/public-internet/transport/node/PublicInternetProcess.ts": `import "${dependency}";`,
    });

    expect(rejected.output).toContain("public-internet-process-owns-network-primitives");
    expect(rejected.output.replaceAll(/\s+/g, " ")).toContain(
      "use PublicInternet and keep sockets and",
    );
    expect(accepted.status, accepted.output).toBe(0);
  },
);

it.each(["@modelcontextprotocol/sdk", "zod"])(
  "rejects application contracts using %s",
  async (dependency) => {
    const result = await checkArchitecture({
      "apps/web/src/server/mcp/tools.ts": `import "${dependency}";`,
    });

    expect(result.output).toContain("effect-mcp-and-schema-contracts");
    expect(result.output.replaceAll(/\s+/g, " ")).toContain("use Effect Schema and the stateless");
  },
);

it("permits a thin MCP route and Effect tools delegating to a public backend use case", async () => {
  const files = {
    "apps/web/src/routes/mcp.ts":
      'import "@tanstack/solid-router"; export { value } from "#server/mcp/tools.ts";',
    "apps/web/src/server/mcp/tools.ts":
      'import "effect/ai"; export { value } from "@lineupkeep/backend/connections/Connections";',
    "packages/backend/src/contexts/connections/Connections.ts": "export const value = 1;",
  };

  const architecture = await checkArchitecture(files);
  const lint = await checkLint(files);

  expect(architecture.status, architecture.output).toBe(0);
  expect(lint.status, lint.output).toBe(0);
});

it("accepts a previously unnamed domain inside erased validators and handlers", async () => {
  const files = {
    "apps/web/src/server/backendEntry.ts": `
      import type { Effect } from "effect";
      export declare function runUseCase<A, E, R>(program: Effect.Effect<A, E, R>): Promise<A>;
    `,
    "packages/backend/src/contexts/inventory/Inventory.ts": `
      import { Context, Effect, Schema } from "effect";
      export const InventoryInput = Schema.Struct({ id: Schema.String });
      export class Inventory extends Context.Service<Inventory, {
        readonly reserve: (input: ReadonlyArray<typeof InventoryInput.Type>) => Effect.Effect<void>;
      }>()("@lineupkeep/backend/contexts/inventory/Inventory") {}
    `,
    "apps/web/src/server-functions/inventory.ts": `
      import { createServerFn } from "@tanstack/solid-start";
      import { Schema, Effect } from "effect";
      import { InventoryInput, Inventory } from "@lineupkeep/backend/inventory/Inventory";
      import { runUseCase } from "#server/backendEntry.ts";
      export const reserve = createServerFn({ method: "POST" })
        .validator((raw: typeof InventoryInput.Encoded) => Schema.decodeResult(InventoryInput)(raw))
        .handler(({ data }) => runUseCase(Effect.flatMap(Effect.fromResult(data), (input) => Inventory.use((inventory) => inventory.reserve([input])))));
    `,
  };

  const result = await checkLint(files);
  const architecture = await checkArchitecture(files);

  expect(result.status, result.output).toBe(0);
  expect(architecture.status, architecture.output).toBe(0);
});

it("rejects repository dependencies from server functions in the module graph", async () => {
  const result = await checkArchitecture({
    "packages/backend/src/contexts/inventory/internal/InventoryRepository.ts":
      "export const repository = 1;",
    "apps/web/src/server-functions/inventory.ts":
      'import { repository } from "@lineupkeep/backend/inventory/internal/InventoryRepository"; export const reserve = () => repository;',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("server-functions-use-public-backend-contracts");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "call public backend services inside compiler-erased handlers",
  );
});

it("rejects runtime dependencies in shared domain limits", async () => {
  const result = await checkArchitecture({
    "packages/backend/src/contexts/inventory/InventoryLimits.ts":
      'import { Schema } from "effect"; export const limit = Schema.String;',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("domain-limits-have-no-runtime-dependencies");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("export literal limits without imports");
});

it("accepts browser-safe primitive limits in a previously unnamed domain", async () => {
  const files = {
    "packages/backend/src/contexts/inventory/InventoryLimits.ts": "export const maxItems = 200;",
    "apps/web/src/browser/inventory/input.ts":
      'export { maxItems } from "@lineupkeep/backend/inventory/InventoryLimits";',
  };

  const lint = await checkLint(files);
  const architecture = await checkArchitecture(files);

  expect(lint.status, lint.output).toBe(0);
  expect(architecture.status, architecture.output).toBe(0);
});

it("rejects SQL utility imports from domain behavior", async () => {
  const result = await checkArchitecture({
    "packages/backend/src/contexts/notes/internal/NotesLive.ts":
      'export { unnestRows } from "#database/dbUtilities.ts";',
    "packages/backend/src/database/dbUtilities.ts": "export const unnestRows = 1;",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("database-utilities-only-used-by-repositories");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "call the repository's atomic batch operation",
  );
});

it("permits owned repositories to use the table-derived SQL helpers", async () => {
  const result = await checkArchitecture({
    "packages/backend/src/contexts/notes/internal/NoteRepository.ts":
      'export { unnestRows } from "#database/dbUtilities.ts";',
    "packages/backend/src/database/dbUtilities.ts":
      'import { pgTable } from "drizzle-orm/pg-core"; export const unnestRows = pgTable;',
  });

  expect(result.status, result.output).toBe(0);
});

it("rejects shared Test Layers from production code after moving them internal", async () => {
  const result = await checkArchitecture({
    "packages/backend/src/contexts/notes/internal/NotesLive.ts":
      'export { DatabaseTest } from "#database/internal/DatabaseTest.ts";',
    "packages/backend/src/database/internal/DatabaseTest.ts": "export const DatabaseTest = 1;",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("test-resources-only-used-by-tests");
});

it.each(["effect/observability", "effect/observability/OtlpTracer"])(
  "confines raw %s exporters to observability composition",
  async (dependency) => {
    const rejected = await checkArchitecture({
      "packages/backend/src/runtime/Foreign.ts": `import "${dependency}";`,
    });
    const accepted = await checkArchitecture({
      "packages/backend/src/runtime/Observability.ts": `import "${dependency}";`,
    });

    expect(rejected.status).toBeGreaterThan(0);
    expect(rejected.output).toContain("telemetry-exporters-only-in-observability");
    expect(rejected.output.replaceAll(/\s+/gu, " ")).toContain("compose exporters through");
    expect(accepted.status, accepted.output).toBe(0);
  },
);

it("confines the development renderer to the same safety composition", async () => {
  const renderer = "packages/backend/src/runtime/PrettyConsoleTracer.ts";
  const rejected = await checkArchitecture({
    [renderer]: "export const renderer = 1;",
    "packages/backend/src/runtime/Foreign.ts": 'import "./PrettyConsoleTracer.ts";',
  });
  const accepted = await checkArchitecture({
    [renderer]: "export const renderer = 1;",
    "packages/backend/src/runtime/Observability.ts": 'import "./PrettyConsoleTracer.ts";',
  });

  expect(rejected.status).toBeGreaterThan(0);
  expect(rejected.output).toContain("telemetry-exporters-only-in-observability");
  expect(rejected.output.replaceAll(/\s+/gu, " ")).toContain("compose exporters through");
  expect(accepted.status, accepted.output).toBe(0);
});

it("permits exporter flusher ownership without access to a raw tracer", async () => {
  const result = await checkArchitecture({
    "packages/backend/src/runtime/BackendRuntime.ts": 'import "effect/observability/OtlpExporter";',
  });

  expect(result.status, result.output).toBe(0);
});

it("rejects importing fixture implementations into a scenario helper", async () => {
  const result = await checkArchitecture({
    "e2e/scenarios/helper.ts": 'import { value } from "#e2e/helper"; export { value };',
    "e2e/helper.ts": "export const value = 1;",
  });

  expect(result.output).toContain("verification-programs-do-not-import-fixtures");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "use public backend contracts and e2e/serviceContract.ts",
  );
});

it("rejects dynamic server imports through a TSX helper", async () => {
  const files = {
    "apps/web/src/shared/read.tsx":
      'export const View = () => <div />; export const read = import("#server/read.ts");',
    "apps/web/src/server/read.ts": "export const read = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("server-implementations-only-used-by-server-adapters");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("call a browser Remote backed by");
});

it("permits backend domain types and server-function and API-handler adapters", async () => {
  const files = {
    "packages/backend/src/contexts/auth/User.ts": "export type UserId = string;",
    "apps/web/src/browser/auth/sessionRemote.ts":
      'export type { UserId } from "@lineupkeep/backend/auth/User"; export { read } from "#server-functions/read.ts";',
    "apps/web/src/server-functions/read.ts":
      'import { createServerFn } from "@tanstack/solid-start"; import { read as serverRead } from "#server/read.ts"; export const read = createServerFn().handler(() => serverRead);',
    "apps/web/src/routes/api/read.ts": 'export { read } from "#server/read.ts";',
    "apps/web/src/server/read.ts": "export const read = 1;",
  };

  const lint = await checkLint(files);
  const architecture = await checkArchitecture(files);

  expect(lint.status, lint.output).toBe(0);
  expect(architecture.status, architecture.output).toBe(0);
});

it("rejects server-function invocation outside browser remotes", async () => {
  const files = {
    "apps/web/src/browser/notes/NoteCard.tsx":
      'import { read } from "#server-functions/read.ts"; export const NoteCard = () => read;',
    "apps/web/src/server-functions/read.ts": "export const read = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("server-functions-only-invoked-by-remotes");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("invoke them only in *Remote.ts and");
});

it("rejects imports between browser features", async () => {
  const files = {
    "apps/web/src/browser/notes/NotesPage.tsx":
      'import { AuthForm } from "#browser/auth/AuthForm.tsx"; export const NotesPage = AuthForm;',
    "apps/web/src/browser/auth/AuthForm.tsx": "export const AuthForm = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("browser-features-are-isolated");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "compose shared browser platform modules and",
  );
});

it("rejects browser platform modules depending on features", async () => {
  const files = {
    "apps/web/src/browser/app-shell/AppShell.tsx":
      'import { NotesPage } from "#browser/notes/NotesPage.tsx"; export const AppShell = NotesPage;',
    "apps/web/src/browser/notes/NotesPage.tsx": "export const NotesPage = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("browser-features-are-isolated");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "compose shared browser platform modules and",
  );
});

it("rejects neutral primitives depending on application composition", async () => {
  const files = {
    "apps/web/src/browser/shared-ui/Button.tsx":
      'import { useSignInRecovery } from "#browser/session/signInRecovery.ts"; export const Button = useSignInRecovery;',
    "apps/web/src/browser/session/signInRecovery.ts": "export const useSignInRecovery = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("shared-ui-is-neutral");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("pass models and callbacks to shared-ui");
});

it("permits features to compose browser platform modules", async () => {
  const files = {
    "apps/web/src/browser/notes/NotesPage.tsx":
      'import { AppShell } from "#browser/app-shell/AppShell.tsx"; import { Button } from "#browser/shared-ui/Button.tsx"; export const NotesPage = [AppShell, Button];',
    "apps/web/src/browser/app-shell/AppShell.tsx":
      'import { Button } from "#browser/shared-ui/Button.tsx"; export const AppShell = Button;',
    "apps/web/src/browser/shared-ui/Button.tsx": "export const Button = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status, result.output).toBe(0);
});

it("permits browser and backend modules to share literal product identity", async () => {
  const result = await checkArchitecture({
    "packages/brand/src/product.ts": 'export const productName = "Example";',
    "apps/web/src/browser/app-shell/AppShell.tsx":
      'import { productName } from "@lineupkeep/brand/product"; export const AppShell = productName;',
    "packages/backend/src/contexts/auth/internal/Adapter.ts":
      'import { productName } from "@lineupkeep/brand/product"; export const name = productName;',
  });

  expect(result.status, result.output).toBe(0);
});

it.each(["effect", "node:fs"])(
  "rejects runtime dependency %s in shared product identity",
  async (dependency) => {
    const result = await checkArchitecture({
      "packages/brand/src/product.ts": `export * from "${dependency}";`,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("brand-has-no-runtime-dependencies");
    expect(result.output.replaceAll(/\s+/g, " ")).toContain(
      "export literal brand values without runtime imports",
    );
  },
);

it("rejects neutral primitives depending on brand compositions", async () => {
  const files = {
    "apps/web/src/browser/shared-ui/Page.tsx":
      'import { Badge } from "#browser/brand-ui/Badge.tsx"; export const Page = Badge;',
    "apps/web/src/browser/brand-ui/Badge.tsx": "export const Badge = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("shared-ui-is-neutral");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("pass models and callbacks to shared-ui");
});

it("rejects brand compositions depending on anything but neutral primitives", async () => {
  const files = {
    "apps/web/src/browser/brand-ui/Panel.tsx":
      'import { useSignInRecovery } from "#browser/session/signInRecovery.ts"; export const Panel = useSignInRecovery;',
    "apps/web/src/browser/session/signInRecovery.ts": "export const useSignInRecovery = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("brand-ui-composes-shared-ui");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("build brand-ui from shared-ui and pass");
});

it("permits features and app-shell to compose brand compositions built on neutral primitives", async () => {
  const files = {
    "apps/web/src/browser/notes/NoteCard.tsx":
      'import { Entry } from "#browser/brand-ui/Entry.tsx"; export const NoteCard = Entry;',
    "apps/web/src/browser/app-shell/AppShell.tsx":
      'import { BrandLink } from "#browser/brand-ui/BrandLink.tsx"; export const AppShell = BrandLink;',
    "apps/web/src/browser/brand-ui/Entry.tsx":
      'import { Text } from "#browser/shared-ui/Text.tsx"; export const Entry = Text;',
    "apps/web/src/browser/brand-ui/BrandLink.tsx": "export const BrandLink = 1;",
    "apps/web/src/browser/shared-ui/Text.tsx": "export const Text = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status, result.output).toBe(0);
});

it.each(["scratch/task/helper.ts"])(
  "rejects backend internal imports from e2e/%s",
  async (file) => {
    const path = `e2e/${file}`;
    const depth = file.startsWith("scratch") ? "../../../" : "../";
    const result = await checkArchitecture({
      [path]: `export { repository } from "${depth}packages/backend/src/contexts/notes/internal/NoteRepository.ts";`,
      "packages/backend/src/contexts/notes/internal/NoteRepository.ts":
        "export const repository = {};",
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("verification-uses-public-services");
    expect(result.output.replaceAll(/\s+/g, " ")).toContain(
      "call public backend services from scenarios",
    );
  },
);

it("rejects persistence drivers in verification scenarios", async () => {
  const result = await checkArchitecture({
    "e2e/scenario.e2e.ts": 'import postgres from "postgres"; export const connection = postgres;',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("verification-uses-public-services");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "call public backend services from scenarios",
  );
});

it("allows public backend services and the owned database observer", async () => {
  const result = await checkArchitecture({
    "e2e/scenario.e2e.ts": 'export { Notes } from "@lineupkeep/backend/notes/Notes";',
    "packages/backend/src/contexts/notes/Notes.ts": "export const Notes = {};",
    "e2e/verify/databaseActivity.ts":
      'import postgres from "postgres"; export const probe = postgres;',
  });

  expect(result.status, result.output).toBe(0);
});

it("permits the generated route tree's Router type cycle", async () => {
  const files = {
    "apps/web/src/router.tsx":
      'import type { RouteTree } from "./routeTree.gen.ts"; export type Router = { tree: RouteTree };',
    "apps/web/src/routeTree.gen.ts":
      'import type { Router } from "./router.tsx"; export type RouteTree = { router: Router };',
  };

  const result = await checkArchitecture(files);

  expect(result.status, result.output).toBe(0);
});

it("rejects cycles through a helper even when they include the generated route tree", async () => {
  const files = {
    "apps/web/src/router.tsx": 'import "./routeTree.gen.ts"; export const router = 1;',
    "apps/web/src/routeTree.gen.ts": 'import "./helper.ts"; export const routeTree = 1;',
    "apps/web/src/helper.ts": 'import "./router.tsx"; export const helper = 1;',
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-circular-dependencies");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("extract a shared contract or inject");
});

it("rejects a context's undeclared dependency on another public contract", async () => {
  const files = {
    "packages/backend/src/contexts/connections/internal/ConnectionRepository.ts":
      'export { Auth } from "#contexts/auth/Auth.ts";',
    "packages/backend/src/contexts/auth/Auth.ts": "export const Auth = {};",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("context-dependencies-connections");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "declare only the needed public contract in permittedContextImports",
  );
});

it("allows Connections to consume the published identity module", async () => {
  const files = {
    "packages/backend/src/contexts/connections/Connection.ts":
      'export { UserId } from "#contexts/auth/User.ts";',
    "packages/backend/src/contexts/auth/User.ts": 'export const UserId = "user";',
  };

  const result = await checkArchitecture(files);

  expect(result.status, result.output).toBe(0);
});

it("allows Connections to sweep through the published account retention contract", async () => {
  const files = {
    "packages/backend/src/contexts/connections/internal/RetentionSweepRepository.ts":
      'export { AccountRetention } from "#contexts/auth/AccountRetention.ts";',
    "packages/backend/src/contexts/auth/AccountRetention.ts": "export const AccountRetention = {};",
  };

  const result = await checkArchitecture(files);

  expect(result.status, result.output).toBe(0);
});

it("rejects another Auth public contract from Connections", async () => {
  const files = {
    "packages/backend/src/contexts/connections/internal/RetentionSweepRepository.ts":
      'export { SignInSessions } from "#contexts/auth/SignInSessions.ts";',
    "packages/backend/src/contexts/auth/SignInSessions.ts": "export const SignInSessions = {};",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("context-dependencies-connections");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "declare only the needed public contract in permittedContextImports",
  );
});

it("denies cross-context dependencies from an unlisted context", async () => {
  const files = {
    "packages/backend/src/contexts/workspaces/Workspace.ts":
      'export { UserId } from "#contexts/auth/User.ts";',
    "packages/backend/src/contexts/auth/User.ts": 'export const UserId = "user";',
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("undeclared-context-dependencies");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "define the smallest public contract permission in permittedContextImports",
  );
});

it("allows private implementation imports within an unlisted context", async () => {
  const files = {
    "packages/backend/src/contexts/workspaces/internal/WorkspaceRepository.ts":
      'export { Workspace } from "#contexts/workspaces/Workspace.ts";',
    "packages/backend/src/contexts/workspaces/Workspace.ts": "export const Workspace = {};",
  };

  const result = await checkArchitecture(files);

  expect(result.status, result.output).toBe(0);
});

it("rejects foreign tables even when a public identity relationship exists", async () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteRepository.ts":
      'export { user } from "#contexts/auth/internal/AuthTables.ts";',
    "packages/backend/src/contexts/auth/internal/AuthTables.ts": "export const user = {};",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-cross-context-internals");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "call the owning context's permitted public",
  );
});

it("rejects undeclared shared-kernel participation", async () => {
  const files = {
    "packages/backend/src/contexts/connections/Connection.ts":
      'export { Money } from "#backend/shared-kernels/money/Money.ts";',
    "packages/backend/src/shared-kernels/money/Money.ts": "export const Money = {};",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("context-dependencies-connections");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "declare only the needed public contract in permittedContextImports",
  );
});

it("rejects a generic context module importing a provider adapter", async () => {
  const files = {
    "packages/backend/src/contexts/connections/internal/FantasyQueriesLive.ts":
      'import { yahooProvider } from "#contexts/connections/internal/yahoo/YahooProvider.ts"; export const provider = yahooProvider;',
    "packages/backend/src/contexts/connections/internal/yahoo/YahooProvider.ts":
      "export const yahooProvider = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("provider-adapters-are-injected");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "use ProviderRegistry and construct each adapter",
  );
});

it("accepts constructing a provider adapter in the composition root", async () => {
  const files = {
    "packages/backend/src/runtime/ApplicationLayer.ts":
      'import { yahooProvider } from "#contexts/connections/internal/yahoo/YahooProvider.ts"; export const ProviderLayer = yahooProvider;',
    "packages/backend/src/contexts/connections/internal/yahoo/YahooProvider.ts":
      "export const yahooProvider = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status, result.output).toBe(0);
});

it("rejects a generic context module importing a game source adapter", async () => {
  const files = {
    "packages/backend/src/contexts/connections/internal/ProfessionalCalendarLive.ts":
      'import { nhlGameSource } from "#contexts/connections/internal/game-sources/nhl/NhlGameSource.ts"; export const source = nhlGameSource;',
    "packages/backend/src/contexts/connections/internal/game-sources/nhl/NhlGameSource.ts":
      "export const nhlGameSource = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("game-source-adapters-are-injected");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "use GameSourceRegistry and construct each adapter",
  );
});

it("accepts constructing a game source adapter in the composition root", async () => {
  const files = {
    "packages/backend/src/runtime/ApplicationLayer.ts":
      'import { nhlGameSource } from "#contexts/connections/internal/game-sources/nhl/NhlGameSource.ts"; export const GameSourceLayer = nhlGameSource;',
    "packages/backend/src/contexts/connections/internal/game-sources/nhl/NhlGameSource.ts":
      "export const nhlGameSource = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status, result.output).toBe(0);
});

it("rejects persistence re-exports from a public context module", async () => {
  const files = {
    "packages/backend/src/contexts/notes/Notes.ts":
      'export { table } from "./internal/NoteTable.ts";',
    "packages/backend/src/contexts/notes/internal/NoteTable.ts": "export const table = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("public-context-contracts-have-no-storage");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "expose domain schemas and service interfaces,",
  );
});

it("rejects table access granted only by a public repository filename", async () => {
  const files = {
    "packages/backend/src/contexts/notes/NoteRepository.ts":
      'export { table } from "./internal/NoteTable.ts";',
    "packages/backend/src/contexts/notes/internal/NoteTable.ts": "export const table = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("tables-only-used-by-persistence-and-composition");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "use domain values and repositories, keeping",
  );
});

it("rejects Drizzle imports in feature workflow implementations", async () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteWorkflow.ts":
      'export { count } from "drizzle-orm";',
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("drizzle-only-used-by-persistence-and-tables");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "call an owned repository returning domain",
  );
});

it.each(["UploadRepository.ts", "UploadAdapter.ts", "UploadsTables.ts", "UploadsDatabase.ts"])(
  "rejects workflow imports of persistence module %s",
  async (module) => {
    const result = await checkArchitecture({
      "packages/backend/src/contexts/uploads/internal/UploadWorkflow.ts": `export { value } from "./${module}";`,
      [`packages/backend/src/contexts/uploads/internal/${module}`]: "export const value = 1;",
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("backend-workflows-have-no-persistence");
    expect(result.output.replaceAll(/\s+/g, " ")).toContain(
      "keep row schemas and codecs in Table/Tables modules",
    );
  },
);

it("permits table-owned codecs to import pure workflow state", async () => {
  const result = await checkArchitecture({
    "packages/backend/src/contexts/uploads/internal/UploadsTables.ts":
      'export { state } from "./UploadWorkflow.ts";',
    "packages/backend/src/contexts/uploads/internal/UploadWorkflow.ts":
      'export { state } from "../Upload.ts";',
    "packages/backend/src/contexts/uploads/Upload.ts": "export const state = 1;",
  });

  expect(result.status, result.output).toBe(0);
});

it("rejects storage definitions outside context persistence modules", async () => {
  const files = {
    "packages/backend/src/shared/NoteTable.ts":
      'import { pgTable, text } from "drizzle-orm/pg-core"; export const note = pgTable("note", { id: text().primaryKey() });',
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("storage-definitions-only-in-context-persistence");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "declare storage in the owning context's",
  );
});

it("allows storage definitions in a context's persistence modules", async () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteTable.ts":
      'import { pgTable, text } from "drizzle-orm/pg-core"; export const note = pgTable("note", { id: text().primaryKey() });',
  };

  const result = await checkArchitecture(files);

  expect(result.status, result.output).toBe(0);
});

it("rejects backend dependencies on web frameworks", async () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteWorkflow.ts":
      'export { createServerFn } from "@tanstack/solid-start";',
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("backend-independent-of-web");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("pass domain inputs to backend services");
});

it("rejects backend dependencies on web application modules", async () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteWorkflow.ts":
      'export { noteView } from "../../../../../../apps/web/src/contracts/notes/noteContract.ts";',
    "apps/web/src/contracts/notes/noteContract.ts": "export const noteView = 1;",
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("backend-independent-of-web");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("pass domain inputs to backend services");
});

it("rejects dynamic persistence-library imports", async () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteRepository.ts":
      'export const orm = import("drizzle-orm");',
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-dynamic-persistence-imports");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "use static imports in owned persistence",
  );
});

it("rejects independent client construction in a repository", async () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteRepository.ts":
      'export { default as connect } from "postgres";',
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("database-drivers-only-used-by-construction");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "use the context's database contract and",
  );
});

it("rejects runtime driver imports in application behavior", async () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NotesLive.ts":
      'export { makeWithDefaults } from "drizzle-orm/effect-postgres";',
  };

  const result = await checkArchitecture(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("database-drivers-only-used-by-construction");
});

it("permits structured queries, local storage definitions, and type-only SQL contracts", async () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteRepository.ts":
      'export { eq, and, count, asc } from "drizzle-orm"; export { alias } from "drizzle-orm/pg-core"; export type { SQL } from "drizzle-orm";',
    "packages/backend/src/contexts/notes/internal/NotesTables.ts":
      'export { pgTable, text } from "drizzle-orm/pg-core";',
    "packages/backend/src/contexts/notes/internal/NotesDatabase.ts":
      'export type { EffectPgDatabase } from "drizzle-orm/effect-postgres"; export { makeWithDefaults } from "drizzle-orm/effect-postgres";',
    "packages/backend/src/database/internal/DatabaseTest.ts":
      'export { migrate } from "drizzle-orm/effect-pglite/migrator";',
  };

  const lint = await checkLint(files);
  const architecture = await checkArchitecture(files);

  expect(lint.status, lint.output).toBe(0);
  expect(architecture.status, architecture.output).toBe(0);
});

const referenceFeature = {
  "apps/web/src/browser/notes/NoteEditor.tsx": `
    import { Show, onSettled } from "solid-js";
    import type { NoteRemote } from "./noteRemote.ts";
    import { useNoteEditor } from "./useNoteEditor.ts";
    export function NoteEditor(props: { readonly remote: NoteRemote }): import("@solidjs/web").JSX.Element {
      const editor = useNoteEditor(props);
      return <Show when={editor.isSaving()}>{onSettled.name}</Show>;
    }`,
  "apps/web/src/browser/notes/useNoteEditor.ts": `
    import { useMutation } from "@tanstack/solid-query";
    import { useWorkflow } from "#browser/workflow/useWorkflow.ts";
    import { noteMutations } from "./noteMutations.ts";
    import type { NoteRemote } from "./noteRemote.ts";
    import { noteEditorWorkflow } from "./noteEditorWorkflow.ts";
    export function useNoteEditor(props: { readonly remote: NoteRemote }): { readonly isSaving: () => boolean } {
      const save = useMutation(() => noteMutations.save(props.remote));
      const editor = useWorkflow(noteEditorWorkflow);
      return { isSaving: () => save.isPending && editor.state().value === "saving" };
    }`,
  "apps/web/src/browser/notes/noteEditorWorkflow.ts": `
    import { createFSM } from "xstate/fsm";
    import type { NoteView } from "#contracts/notes/noteContract.ts";
    import { describeNoteFailure } from "./noteFailure.ts";
    export const noteEditorWorkflow = createFSM({ initial: "editing", states: { editing: {}, saving: {} } });
    export type Saved = NoteView | ReturnType<typeof describeNoteFailure>;`,
  "apps/web/src/browser/notes/noteEditorWorkflow.test.ts": `
    import { noteEditorWorkflow } from "./noteEditorWorkflow.ts";
    export declare const exploreWorkflow: (workflow: unknown) => void;
    export declare const fc: { assert: (property: unknown) => void; property: (predicate: () => boolean) => unknown };
    exploreWorkflow(noteEditorWorkflow);
    fc.assert(fc.property(() => true));`,
  "apps/web/src/browser/notes/noteFailure.ts":
    "export const describeNoteFailure = (): number => 1;",
  "apps/web/src/browser/notes/noteMutations.ts": `
    import type { NoteRemote } from "./noteRemote.ts";
    export const noteMutations = { save: (remote: NoteRemote) => ({ mutationFn: remote.save }) };`,
  "apps/web/src/browser/notes/noteRemote.ts":
    "export type NoteRemote = { readonly save: () => Promise<void> };",
  "apps/web/src/browser/workflow/useWorkflow.ts":
    "export const useWorkflow = (workflow: unknown): { readonly state: () => { readonly value: string } } => ({ state: () => ({ value: String(workflow) }) });",
  "apps/web/src/contracts/notes/noteContract.ts": "export type NoteView = { readonly id: string };",
};

const featureModule = "infra/features/uploads/cloudflare.ts";

const featureFixture = {
  "packages/backend/src/contexts/uploads/Uploads.ts":
    'import { Context, Effect } from "effect"; export class Uploads extends Context.Service<Uploads, { readonly read: (key: string) => Effect.Effect<string> }>()("Uploads") {}',
  [featureModule]:
    'export { Uploads } from "@lineupkeep/backend/uploads/Uploads"; export { Layer } from "effect"; export { Bucket } from "alchemy/Cloudflare/R2"; export * as storage from "@distilled.cloud/gcp/storage_v1"; export const uploads = {};',
};

it("accepts a pure lineup-solver module that imports only its assignment dependency", async () => {
  const result = await checkArchitecture({
    "packages/lineup-solver/src/solver.ts":
      'import { munkres } from "munkres"; export const solve = (matrix: bigint[][]) => munkres(matrix);',
  });

  expect(result.status, result.output).toBe(0);
});

it.each([
  [
    "an application contract",
    'export { value } from "@lineupkeep/backend/auth/User";',
    "packages/backend/src/contexts/auth/User.ts",
  ],
  [
    "an Effect service import",
    'import { Schema } from "effect"; export const value = Schema.String;',
    undefined,
  ],
])("rejects %s in the pure lineup solver", async (_name, source, dependency) => {
  const result = await checkArchitecture({
    ...(dependency === undefined ? {} : { [dependency]: "export const value = 1;" }),
    "packages/lineup-solver/src/solver.ts": source,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("lineup-solver-is-pure");
});

it.each([
  ["the clock", "export const now = Date.now();"],
  ["randomness", "export const pick = Math.random();"],
  ["network access", 'export const load = () => fetch("https://example.com");'],
])("rejects %s in the pure lineup solver", async (_name, source) => {
  const result = await checkLint({ "packages/lineup-solver/src/solver.ts": source });

  expect(result.status).toBeGreaterThan(0);
});

it("accepts a provider adapter that composes its own scoring modules", async () => {
  const result = await checkArchitecture({
    "packages/backend/src/contexts/connections/internal/provider-scoring/LineupScore.ts":
      "export const score = (value: number): number => value * 2;",
    "packages/backend/src/contexts/connections/internal/yahoo/YahooLineup.ts":
      'import { score } from "../provider-scoring/LineupScore.ts"; export const plan = (): number => score(1);',
  });

  expect(result.status, result.output).toBe(0);
});

it.each([
  "packages/backend/src/contexts/connections/internal/LineupPlanning.ts",
  "packages/backend/src/contexts/connections/internal/LineupWorkerLive.ts",
  "packages/backend/src/contexts/connections/QueryResults.ts",
])("rejects provider score construction imported by %s", async (importer) => {
  const result = await checkArchitecture({
    [importer]:
      'import { scoreLineup } from "#contexts/connections/internal/provider-scoring/LineupScore.ts"; export const plan = scoreLineup;',
    "packages/backend/src/contexts/connections/internal/provider-scoring/LineupScore.ts":
      "export const scoreLineup = 1;",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("provider-scoring-stays-in-the-adapter");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("implementation detail");
});

it.each([
  ["an Effect service", 'import { Schema } from "effect"; export const value = Schema.String;', {}],
  [
    "an application contract",
    'export { value } from "../../Provider.ts";',
    { "packages/backend/src/contexts/connections/Provider.ts": "export const value = 1;" },
  ],
])("rejects %s in a provider scoring module", async (_name, source, extra) => {
  const result = await checkArchitecture({
    ...extra,
    "packages/backend/src/contexts/connections/internal/provider-scoring/LineupScore.ts": source,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("provider-scoring-is-self-contained");
});

it.each([
  ["the clock", "export const now = Date.now();"],
  ["network access", 'export const load = () => fetch("https://example.com");'],
  ["randomness", "export const pick = Math.random();"],
])("rejects %s in a provider scoring module", async (_name, source) => {
  const result = await checkLint({
    "packages/backend/src/contexts/connections/internal/provider-scoring/LineupScore.ts": source,
  });

  expect(result.status).toBeGreaterThan(0);
});

it("rejects provider scoring vocabulary in generic code", async () => {
  const result = await checkLint({
    "packages/backend/src/contexts/connections/QueryResults.ts":
      "export const value = { communityStartRate: 1 };",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(provider-scoring-vocabulary)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "keep scoring vocabulary inside the provider adapter",
  );
});

it.each([
  "packages/backend/src/contexts/connections/internal/yahoo/YahooLineup.ts",
  "packages/backend/src/contexts/connections/internal/provider-scoring/LineupScore.ts",
])("accepts provider scoring vocabulary in %s", async (path) => {
  const result = await checkLint({ [path]: "export const value = { communityStartRate: 1 };" });

  expect(result.status, result.output).toBe(0);
});

it("rejects a provider action name in generic code", async () => {
  const result = await checkLint({
    "packages/backend/src/contexts/connections/LineupScopes.ts":
      'export const action = "start-active";',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(provider-action-vocabulary)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "keep provider action names inside the adapter",
  );
});

it.each([
  "packages/backend/src/contexts/connections/internal/yahoo/YahooLineup.ts",
  "packages/backend/src/contexts/connections/internal/yahoo/YahooProvider.ts",
])("accepts a provider action name in %s", async (path) => {
  const result = await checkLint({ [path]: 'export const action = "start_active_players";' });

  expect(result.status, result.output).toBe(0);
});

it("rejects a provider identity in generic code", async () => {
  const result = await checkLint({
    "packages/backend/src/contexts/connections/internal/LineupPlanning.ts":
      'export const providerKey = "yahoo";',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(provider-identity)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("keep provider identity in its adapter");
});

it.each([
  "packages/backend/src/contexts/connections/internal/yahoo/YahooLineup.ts",
  "packages/backend/src/runtime/ApplicationLayer.ts",
  "apps/web/src/contracts/connections/providerLabels.ts",
  "packages/hosted-browser/src/provider.ts",
])("accepts a provider identity declaration in %s", async (path) => {
  const result = await checkLint({ [path]: 'export const providerKey = "yahoo";' });

  expect(result.status, result.output).toBe(0);
});

it.each([
  [
    "a sport literal",
    'export const label = (sport: string): string => (sport === "football" ? "F" : "H");',
  ],
  [
    "a league literal",
    'export const label = (league: string): string => (league === "nfl" ? "N" : "H");',
  ],
])("rejects a generic module deciding by %s", async (_name, source) => {
  const result = await checkLint({
    "packages/backend/src/contexts/connections/TeamLabels.ts": source,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(provider-sport-rule)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("decide by sport or league");
});

it.each([
  [
    "a declared-capability read",
    "export const decide = (sports: ReadonlyArray<string>, sport: string): boolean => sports.includes(sport);",
  ],
  [
    "an exhaustive declared-value map",
    'const names: Readonly<Record<"football" | "hockey", string>> = { football: "Football", hockey: "Hockey" }; export const label = (sport: "football" | "hockey"): string => names[sport];',
  ],
])("accepts %s in a generic module", async (_name, source) => {
  const result = await checkLint({
    "packages/backend/src/contexts/connections/TeamLabels.ts": source,
  });

  expect(result.status, result.output).toBe(0);
});

it("rejects a provider wire fragment in generic code", async () => {
  const result = await checkLint({
    "packages/backend/src/contexts/connections/QueryResults.ts":
      'export const detail = "its `teams;out=games_played` read returns an empty node";',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(provider-wire-vocabulary)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("one provider's wire vocabulary");
});

it.each([
  "packages/backend/src/contexts/connections/internal/yahoo/YahooProvider.ts",
  "packages/backend/src/contexts/connections/internal/provider-scoring/LineupScore.ts",
])("accepts a provider wire fragment in %s", async (path) => {
  const result = await checkLint({ [path]: 'export const path = "/fantasy/v2/league;out=stats";' });

  expect(result.status, result.output).toBe(0);
});

it("rejects one provider's transaction request shape in generic code", async () => {
  const result = await checkLint({
    "packages/backend/src/contexts/connections/QueryResults.ts":
      'export const detail = "The provider\'s transaction request carries one add and one drop.";',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(provider-transaction-vocabulary)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "read the declared limits from ProviderCapabilities.transactionRequest",
  );
});

it("accepts one provider's transaction request shape in the adapter", async () => {
  const result = await checkLint({
    "packages/backend/src/contexts/connections/internal/yahoo/YahooLineup.ts":
      'export const detail = "The provider\'s transaction request carries one add and one drop.";',
  });

  expect(result.status, result.output).toBe(0);
});
