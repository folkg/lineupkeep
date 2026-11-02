import type { IConfiguration, IRegularForbiddenRuleType } from "dependency-cruiser";

const permittedContextImports = {
  auth: [],
  connections: [
    "contexts/auth/AccountRetention.ts",
    "contexts/auth/User.ts",
    "contexts/auth/UserDirectory.ts",
  ],
  feedback: ["contexts/auth/User.ts"],
  privacy: ["contexts/auth/SignInCodeQuotaKey.ts", "contexts/auth/User.ts"],
  toolCalls: ["contexts/auth/User.ts"],
};

const backendRoot = "^packages/backend/src/";
const browserRoot = "^apps/web/src/browser/";
const featureInfrastructure = "^infra/features/([^/]+)/";
const provisioningPackages =
  "(?:^|/node_modules/)(?:alchemy|@alchemy.run|@distilled.cloud|@google-cloud|@aws-sdk|@azure|@pulumi|@neondatabase/api-client|cloudflare)(?:/|$)";

const providerScoring = "^packages/backend/src/contexts/connections/internal/provider-scoring/";
const providerAdapters = "^packages/backend/src/contexts/connections/internal/yahoo/";
const gameSourceAdapters = "^packages/backend/src/contexts/connections/internal/game-sources/";

const browserPlatform = [
  "app-shell",
  "brand-ui",
  "navigation",
  "query",
  "session",
  "shared-ui",
  "telemetry",
  "timing",
  "workflow",
];

const browserViews = `${browserRoot}(?!shared-ui/|brand-ui/).+\\.tsx$`;
const browserControllers = `${browserRoot}.+/use[A-Z][^/]*\\.ts$`;
const browserWorkflows = `${browserRoot}[^/]+/(?!use[A-Z])[^/]+Workflow\\.ts$`;
const browserRequests = `${browserRoot}.+(?:Remote|Queries|Mutations)\\.ts$`;
const databaseConstruction = [
  `${backendRoot}database/DatabaseConnection\\.ts$`,
  `${backendRoot}database/internal/PostgresLive\\.ts$`,
  `${backendRoot}database/internal/DatabaseTest\\.ts$`,
  `${backendRoot}contexts/[^/]+/.*internal/[^/]*Database(?:Test)?\\.ts$`,
  `${backendRoot}contexts/auth/internal/BetterAuthAdapter\\.ts$`,
];
const persistenceModules = `${backendRoot}contexts/[^/]+/.*internal/[^/]*(?:Repository|Adapter|Schema|Table|Tables|Database|DatabaseLive|DatabaseTest)\\.ts$`;
const declaredContexts = Object.keys(permittedContextImports).map(
  (context) => `${backendRoot}contexts/${context}/`,
);

export default {
  forbidden: [
    forbid(
      "brand-has-no-runtime-dependencies",
      "Shared product identity must stay safe in every execution environment; export literal brand values without runtime imports and keep behavior in its owning application module.",
      { path: "^packages/brand/src/" },
      { dependencyTypesNot: ["type-only"] },
    ),
    forbid(
      "lineup-solver-is-pure",
      "Lineup selection is a pure calculation; keep provider, persistence, transport, application, and clock code out of packages/lineup-solver.",
      { path: "^packages/lineup-solver/src/" },
      {
        path: [
          "^packages/backend/",
          "^packages/hosted-browser/",
          "^apps/",
          "^infra/",
          "^e2e/",
          "^tools/",
          "(?:^|/node_modules/)(?:effect|@effect|drizzle-orm|drizzle-kit|pg|postgres|better-auth|alchemy|@alchemy\\.run)(?:/|$)",
        ],
      },
    ),
    forbid(
      "provider-scoring-stays-in-the-adapter",
      "How a provider constructs a score is that provider's implementation detail; use ProviderShape for final scores and opaque provenance, and keep scoring modules inside the provider adapters.",
      { pathNot: [providerAdapters, providerScoring] },
      { path: providerScoring },
    ),
    forbid(
      "provider-scoring-is-self-contained",
      "Score construction is arithmetic over the provider's own facts; importing application, persistence, transport, or composition code hides a dependency and breaks provider isolation.",
      { path: providerScoring },
      {
        path: [
          "^packages/backend/src/",
          "^packages/brand/",
          "^packages/hosted-browser/",
          "^packages/lineup-solver/",
          "^apps/",
          "^infra/",
          "^e2e/",
          "^tools/",
          "(?:^|/node_modules/)(?:effect|@effect|drizzle-orm|drizzle-kit|pg|postgres|better-auth|alchemy|@alchemy\\.run|munkres)(?:/|$)",
        ],
        pathNot: [providerScoring],
      },
    ),
    forbid(
      "database-utilities-only-used-by-repositories",
      "SQL utilities outside persistence bypass owned queries; gather domain commands in services and call the repository's atomic batch operation.",
      {
        path: "^(?:packages/backend|apps/web)/src/",
        pathNot: [
          `${backendRoot}contexts/[^/]+/.*internal/[^/]*Repository\\.ts$`,
          `${backendRoot}contexts/[^/]+/.*internal/[^/]*Tables?\\.ts$`,
        ],
      },
      { path: "^packages/backend/src/database/dbUtilities\\.ts$" },
    ),
    forbid(
      "telemetry-exporters-only-in-observability",
      "Raw tracers bypass telemetry privacy; compose exporters through runtime/Observability.ts and its safeTracerLayer for both OTLP and development output.",
      {
        path: "^(?:packages/backend|apps/web)/src/",
        pathNot: ["^packages/backend/src/runtime/Observability\\.ts$", "Test\\.ts$"],
      },
      {
        path: [
          "(?:^|/)effect/(?:src/|dist/)?observability/(?:index|OtlpTracer)(?:\\.|/|$)",
          "^packages/backend/src/runtime/PrettyConsoleTracer\\.ts$",
        ],
      },
    ),
    forbid(
      "application-independent-of-provisioning",
      "Provisioning imports couple runtime code to deployment; receive plain configuration or services from infra/ through BackendRuntime instead.",
      { path: "^(?:apps/web/src/|packages/backend/|e2e/|tools/local-stack/)" },
      {
        path: ["^infra/", provisioningPackages],
      },
    ),
    forbid(
      "feature-infrastructure-only-used-by-stage-composition",
      "Feature infrastructure imports outside stage composition split host selection; register the Layer in infra/stage.ts or infra/alchemy.run.ts instead.",
      { pathNot: ["^infra/stage\\.ts$", "^infra/alchemy\\.run\\.ts$"] },
      { path: featureInfrastructure },
    ),
    forbid(
      "feature-infrastructure-uses-owned-public-contracts",
      "Feature infrastructure must preserve context ownership; import only its own root public contracts, Effect, and host SDKs, then compose its Layer in infra/stage.ts; keep runtime adapters in the owning context internal/.",
      { path: featureInfrastructure },
      {
        pathNot: [
          `${backendRoot}contexts/$1/[^/]+\\.ts$`,
          "(?:^|/)node_modules/effect/",
          provisioningPackages,
        ],
      },
    ),
    forbid(
      "infrastructure-uses-public-contracts-and-build-inputs",
      "Infrastructure imports of application internals couple provisioning to runtime; use public backend contracts or apps/web/deploy build inputs instead.",
      { path: "^infra/" },
      {
        path: ["^apps/web/", "^packages/backend/", "^e2e/"],
        pathNot: ["^apps/web/deploy/", "^packages/backend/src/(?!.*internal/).+"],
      },
    ),
    forbid(
      "local-stack-tools-only-used-by-local-infrastructure-and-supervisor",
      "Local lifecycle imports outside their owners couple application code to recovery machinery; keep them in infra/local/, e2e/verify/, or tools/local-stack/.",
      { pathNot: ["^infra/local/", "^e2e/verify/", "^tools/local-stack/"] },
      { path: "^tools/local-stack/" },
    ),
    forbid(
      "local-stack-tools-are-independent",
      "Local-stack tools must stay independent of applications and provisioning; put integrations in infra/local/ or e2e/verify/ and pass plain lifecycle contracts.",
      { path: "^tools/local-stack/" },
      { path: "^(?:apps|packages|e2e|infra|scripts)/" },
    ),
    forbid(
      "verification-programs-do-not-import-fixtures",
      "Fixture or web adapter imports bypass public-service proof; use public backend contracts and e2e/serviceContract.ts from scenario programs and helpers.",
      { path: "^e2e/(?:scenarios/|scratch/).+\\.ts$", pathNot: "\\.e2e\\.ts$" },
      {
        path: ["^e2e/", "^apps/web/"],
        pathNot: ["^e2e/(?:scenarios/|scratch/)(?!.*\\.e2e\\.ts$)", "^e2e/serviceContract\\.ts$"],
      },
    ),
    forbid(
      "verification-uses-public-services",
      "Direct persistence access bypasses public-service proof; call public backend services from scenarios and leave database observation to e2e/verify/databaseActivity.ts or doctor.ts.",
      {
        path: "^e2e/",
        pathNot: "^e2e/verify/(?:databaseActivity|doctor)\\.ts$",
      },
      {
        path: [
          `${backendRoot}(?:.*/internal/|database/)`,
          "(?:^|/)(?:drizzle-orm|postgres|pg|@effect/sql-pg|@effect/sql-pglite|@electric-sql/pglite)(?:/|\\.|$)",
          "effect/(?:dist/)?sql/",
        ],
      },
    ),
    forbid(
      "mcp-adapter-dependencies",
      "MCP imports of web or persistence implementations bypass protocol isolation; use public backend use cases through server/mcp handlers and backendEntry.ts.",
      { path: "^apps/web/src/server/mcp/" },
      {
        path: [
          "^apps/web/src/",
          backendRoot,
          "(?:^|/)(?:@tanstack|@solidjs|solid-js|better-auth|@better-auth|drizzle-orm)(?:/|$)",
        ],
        pathNot: [
          "^apps/web/src/server/mcp/",
          "^apps/web/src/server/backendEntry\\.ts$",
          `${backendRoot}contexts/[^/]+/(?!.*internal/)[^/]+\\.ts$`,
          `${backendRoot}runtime/(?:BackendRuntime|RequestContext)\\.ts$`,
        ],
      },
    ),
    forbid(
      "mcp-only-used-by-protocol-route",
      "MCP adapter imports outside its protocol route couple page behavior to MCP; use public backend use cases and reserve server/mcp imports for routes/mcp.ts.",
      {
        pathNot: ["^apps/web/src/server/mcp/", "^apps/web/src/routes/mcp(?:\\.test)?\\.ts$"],
      },
      { path: "^apps/web/src/server/mcp/" },
    ),
    forbid(
      "mcp-route-delegates-to-adapter",
      "MCP route logic belongs behind the protocol seam; delegate to apps/web/src/server/mcp/ and keep only TanStack routing in routes/mcp.ts.",
      { path: "^apps/web/src/routes/mcp\\.ts$" },
      { pathNot: ["^apps/web/src/server/mcp/", "(?:^|/)@tanstack/solid-router/"] },
    ),
    forbid(
      "oauth-packages-only-in-auth-adapter",
      "OAuth server packages outside Auth bypass its hooks and token ownership; use AuthService and keep plugin composition in auth/internal/BetterAuthAdapter.ts.",
      {
        path: "^(?:apps/web|packages/backend)/src/",
        pathNot: "^packages/backend/src/contexts/auth/internal/BetterAuthAdapter\\.ts$",
      },
      {
        path: "(?:^|/)@better-auth/(?:mcp|cimd|oauth-provider)(?:/|$)",
        pathNot: "(?:^|/)@better-auth/oauth-provider/(?:dist/)?client(?:\\.|/|$)",
      },
    ),
    forbid(
      "oauth-client-only-in-session-adapter",
      "OAuth client plugins outside the session adapter split sign-in composition; use browser/session/authClient.ts and register the plugin there.",
      {
        path: "^(?:apps/web|packages/backend)/src/",
        pathNot: "^apps/web/src/browser/session/authClient\\.ts$",
      },
      { path: "(?:^|/)@better-auth/oauth-provider/(?:dist/)?client(?:\\.|/|$)" },
    ),
    forbid(
      "public-internet-process-owns-network-primitives",
      "Direct network primitives bypass public-destination validation and address pinning; use PublicInternet and keep sockets and DNS in runtime/public-internet/transport/node/.",
      {
        path: "^(?:apps/web|packages/backend)/src/",
        pathNot: "^packages/backend/src/runtime/public-internet/transport/node/",
      },
      {
        path: "^(?:node:)?(?:dns|https?|net|tls)(?:/|$)",
      },
    ),
    forbid(
      "effect-mcp-and-schema-contracts",
      "Alternate MCP or schema libraries split the protocol contract; use Effect Schema and the stateless Effect MCP server in server/mcp/ (AGENTS.md: Architecture).",
      { path: "^(?:apps/web|packages/backend)/src/" },
      { path: "(?:^|/)(?:@modelcontextprotocol|zod)(?:/|$)" },
    ),
    forbid(
      "undeclared-context-dependencies",
      "An undeclared context dependency bypasses ownership; define the smallest public contract permission in permittedContextImports and add acceptance/rejection fixtures before importing it.",
      {
        path: `${backendRoot}contexts/([^/]+)/`,
        pathNot: declaredContexts,
      },
      {
        path: `${backendRoot}(?:contexts|shared-kernels)/`,
        pathNot: `${backendRoot}contexts/$1/`,
      },
    ),
    ...Object.entries(permittedContextImports).map(([context, imports]) =>
      forbid(
        `context-dependencies-${context}`,
        "This context import has no declared permission; declare only the needed public contract in permittedContextImports and add acceptance/rejection fixtures.",
        { path: `${backendRoot}contexts/${context}/` },
        {
          path: `${backendRoot}(?:contexts|shared-kernels)/`,
          pathNot: [
            `${backendRoot}contexts/${context}/`,
            ...imports.map((path) => `${backendRoot}${path.replaceAll(".", "\\.")}$`),
          ],
        },
      ),
    ),
    forbid(
      "backend-independent-of-web",
      "Web framework imports couple backend use cases to HTTP and UI; pass domain inputs to backend services and keep framework adapters in apps/web.",
      { path: backendRoot },
      {
        path: ["^apps/web/", "(?:^|/)(?:@tanstack|@solidjs|solid-js|@kobalte|vite)(?:/|$)"],
      },
    ),
    forbid(
      "storage-definitions-only-in-context-persistence",
      "Storage constructors outside persistence obscure table ownership; declare storage in the owning context's internal Table/Tables module and call its repository.",
      {
        path: "^(?:packages/backend|apps/web)/src/",
        pathNot: [persistenceModules, `${backendRoot}database/dbUtilities\\.ts$`],
      },
      { path: "(?:^|/)drizzle-orm/pg-core(?:/|\\.|$)" },
    ),
    forbid(
      "database-drivers-only-used-by-construction",
      "Driver imports outside construction bypass composed resource lifetimes; use the context's database contract and build clients in its Live or Test Layer.",
      {
        path: "^(?:packages/backend|apps/web)/src/",
        pathNot: [
          ...databaseConstruction,
          `${backendRoot}contexts/[^/]+/.*internal/[^/]*Database\\.ts$`,
        ],
      },
      {
        path: [
          "(?:^|/)(?:@effect/sql-(?:pg|pglite)|postgres|pg)(?:/|\\.|$)",
          "drizzle-orm/(?:effect-postgres|effect-pglite|postgres-js)(?:/|\\.|$)",
          "effect/(?:dist/)?sql/(?:SqlClient|Statement)(?:/|\\.|$)",
        ],
      },
    ),
    forbid(
      "database-config-only-used-by-construction",
      "Database URL access outside construction bypasses composed resource ownership; receive the context's database service and read DatabaseUrl only in construction Layers.",
      {
        path: "^(?:packages/backend|apps/web)/src/",
        pathNot: [...databaseConstruction, "\\.test\\.[cm]?[jt]sx?$"],
      },
      { path: `${backendRoot}config/DatabaseUrl\\.ts$` },
    ),
    forbid(
      "no-dynamic-persistence-imports",
      "Dynamic persistence imports bypass static ownership checks; use static imports in owned persistence or construction modules and call their services elsewhere.",
      { path: "^(?:packages/backend|apps/web)/src/" },
      {
        path: "(?:^|/)(?:drizzle-orm|@effect/sql-(?:pg|pglite)|postgres|pg)(?:/|\\.|$)",
        dependencyTypes: ["dynamic-import"],
      },
    ),
    forbid(
      "public-context-contracts-have-no-storage",
      "Storage imports in a public contract leak persistence across contexts; expose domain schemas and service interfaces, and keep tables and Drizzle in owned internal modules.",
      {
        path: `${backendRoot}contexts/[^/]+/`,
        pathNot: ["/internal/", "\\.test\\.[cm]?[jt]sx?$"],
      },
      {
        path: [
          `${backendRoot}contexts/[^/]+/.*internal/`,
          `${backendRoot}database/`,
          "drizzle-orm",
        ],
      },
    ),
    forbid(
      "server-implementations-only-used-by-server-adapters",
      "A server implementation import crosses the universal execution boundary; call a browser Remote backed by a server function or delegate protocol work from its route.",
      {
        path: "^apps/web/src/",
        pathNot: [
          "^apps/web/src/server/",
          "^apps/web/src/server\\.ts$",
          "^apps/web/src/server-functions/",
          "^apps/web/src/routes/api/",
          "^apps/web/src/routes/-server/",
          "^apps/web/src/routes/.+/-server/",
          "^apps/web/src/routes/(?:mcp|\\[\\.\\]well-known\\.\\$)\\.ts$",
          "^apps/web/src/routeTree\\.gen\\.ts$",
        ],
      },
      {
        path: [
          "^apps/web/src/(?:server/|server\\.ts$|routes/api/)",
          `${backendRoot}(?:runtime|database|config|email|observability)/`,
          `${backendRoot}contexts/[^/]+/.*internal/`,
        ],
      },
    ),
    forbid(
      "platform-sdks-only-in-deployment-targets",
      "Platform SDK imports leak target-specific runtime code; import them only in server/targets/ and pass primitives to BackendRuntime.",
      { pathNot: "^apps/web/src/server/targets/" },
      { path: "^cloudflare:" },
    ),
    forbid(
      "server-functions-only-invoked-by-remotes",
      "Direct server-function imports bypass the injected browser seam; invoke them only in *Remote.ts and inject remotes into queries and mutations (.agents/skills/web-interactions/references/data-flow.md).",
      { path: "^apps/web/src/", pathNot: "^apps/web/src/browser/.+Remote\\.ts$" },
      { path: "^apps/web/src/server-functions/" },
    ),
    forbid(
      "browser-features-are-isolated",
      "Cross-feature or platform-to-feature imports couple independent browser slices; compose shared browser platform modules and join features at a route.",
      { path: `${browserRoot}([^/]+)/` },
      {
        path: browserRoot,
        pathNot: [`${browserRoot}$1/`, `${browserRoot}(?:${browserPlatform.join("|")})/`],
      },
    ),
    forbid(
      "views-render-controller-models",
      "Queries, writes, workflows, and navigation in views split orchestration; move them into a use*.ts controller and render its model and intents (.agents/skills/web-interactions/references/data-flow.md).",
      { path: browserViews },
      {
        dependencyTypesNot: ["type-only"],
        path: [
          browserRequests,
          browserWorkflows,
          `${browserRoot}workflow/`,
          "(?:^|/)node_modules/(?:@tanstack/solid-query|@tanstack/solid-router|xstate)/",
        ],
      },
    ),
    forbid(
      "workflows-are-pure-transitions",
      "Runtime dependencies make workflows impure; keep xstate/fsm transitions driven by events and let a use*.ts controller run work (.agents/skills/web-interactions/references/data-flow.md).",
      { path: browserWorkflows },
      {
        dependencyTypesNot: ["type-only"],
        path: ["(?:^|/)node_modules/", "^apps/web/src/"],
        pathNot: [
          "(?:^|/)node_modules/xstate/",
          "^apps/web/src/contracts/",
          `${browserRoot}[^/]+/[a-z][^/]*\\.ts$`,
        ],
      },
    ),
    forbid(
      "workflows-import-no-requests-or-controllers",
      "Request or controller imports make workflow transitions depend on orchestration; send event data into the workflow and run work in a use*.ts controller.",
      { path: browserWorkflows },
      { path: [browserRequests, browserControllers, `${browserRoot}timing/`] },
    ),
    forbid(
      "controllers-alone-run-workflows-and-writes",
      "Running workflows or writes outside controllers splits orchestration; start them in a use*.ts controller and expose intents to views.",
      { pathNot: browserControllers },
      {
        path: [browserWorkflows, `${browserRoot}workflow/`, `${browserRoot}.+Mutations\\.ts$`],
      },
    ),
    forbid(
      "shared-ui-is-neutral",
      "Application or brand dependencies make neutral primitives feature-specific; pass models and callbacks to shared-ui and compose identity in brand-ui or callers.",
      { path: `${browserRoot}shared-ui/` },
      { path: browserRoot, pathNot: `${browserRoot}(?:shared-ui|timing)/` },
    ),
    forbid(
      "brand-ui-composes-shared-ui",
      "Application dependencies couple brand compositions to features; build brand-ui from shared-ui and pass feature data and callbacks from callers.",
      { path: `${browserRoot}brand-ui/` },
      { path: browserRoot, pathNot: `${browserRoot}(?:brand-ui|shared-ui)/` },
    ),
    forbid(
      "domain-limits-have-no-runtime-dependencies",
      "Shared limits must stay browser-safe primitives; export literal limits without imports and keep schemas in the domain contract.",
      { path: `${backendRoot}contexts/[^/]+/[^/]*Limits\\.ts$` },
      { dependencyTypesNot: ["type-only"] },
    ),
    forbid(
      "server-functions-use-public-backend-contracts",
      "Persistence and provisioning in RPC declarations bypass use cases; call public backend services inside compiler-erased handlers and keep storage in owned repositories.",
      { path: "^apps/web/src/server-functions/" },
      {
        path: [
          `${backendRoot}contexts/[^/]+/.*internal/`,
          `${backendRoot}database/`,
          "^infra/",
          "^alchemy",
        ],
      },
    ),
    forbid(
      "contracts-do-not-depend-on-execution-environments",
      "Execution-environment imports make web contracts unsafe to serialize or share; define plain interfaces in contracts/ and implement behavior in browser/ or server/.",
      { path: "^apps/web/src/contracts/" },
      { path: "^apps/web/src/", pathNot: "^apps/web/src/contracts/" },
    ),
    forbid(
      "test-resources-only-used-by-tests",
      "Test resource imports can ship fake services to production; use production contracts and compose Test.ts resources only in tests or other Test.ts modules.",
      { pathNot: ["\\.test\\.[cm]?[jt]sx?$", "Test\\.ts$"] },
      { path: "Test\\.ts$" },
    ),
    forbid(
      "no-unresolved-imports",
      "An unresolved import leaves the architecture unchecked; fix its path or package export and declare genuine build-provided modules in .dependency-cruiser.ts.",
      {},
      {
        couldNotResolve: true,

        pathNot: ["^~icons/lucide/", "^virtual:solid-diagnostics/client$", "^cloudflare:workers$"],
      },
    ),
    forbid(
      "no-circular-dependencies",
      "A dependency cycle couples module initialization and ownership; extract a shared contract or inject a dependency to restore one-way imports.",
      { pathNot: "^apps/web/src/(?:router\\.tsx|routeTree\\.gen\\.ts)$" },
      { circular: true },
    ),
    forbid(
      "no-cross-context-internals",
      "Foreign internal imports bypass context ownership; call the owning context's permitted public contract instead, with acceptance/rejection fixtures for any added permission.",
      { path: "(^packages/backend/src/contexts/)([^/]+)/" },
      {
        path: "^$1[^/]+/.*internal/",
        pathNot: "^$1$2/",
      },
    ),
    forbid(
      "no-context-internals-outside-composition-roots",
      "Internal imports outside composition expose context implementation details; use public service contracts and wire internals in runtime/ApplicationLayer.ts.",
      {
        pathNot: [
          "^packages/backend/src/contexts/",
          "^packages/backend/src/runtime/ApplicationLayer\\.ts$",
          "\\.test\\.[cm]?[jt]sx?$",
        ],
      },
      { path: "^packages/backend/src/contexts/[^/]+/.*internal/" },
    ),
    forbid(
      "backend-workflows-have-no-persistence",
      "Persistence imports couple lifecycle policy to storage; keep row schemas and codecs in Table/Tables modules and pass domain state into workflows.",
      { path: `${backendRoot}contexts/[^/]+/.*Workflow\\.ts$` },
      { path: [persistenceModules, `${backendRoot}database/`] },
    ),
    forbid(
      "tables-only-used-by-persistence-and-composition",
      "Table imports couple services or workflows to storage; use domain values and repositories, keeping Table/Tables imports inside owned persistence modules.",
      {
        pathNot: [persistenceModules],
      },
      { path: "(?:Table|Tables)\\.ts$" },
    ),
    forbid(
      "drizzle-only-used-by-persistence-and-tables",
      "Drizzle imports couple domain services to persistence; call an owned repository returning domain values and keep Drizzle inside internal persistence modules.",
      {
        path: "^packages/backend/src/contexts/",
        pathNot: persistenceModules,
      },
      { path: "drizzle-orm" },
    ),
    forbid(
      "database-internals-only-used-by-database-composition",
      "Global database internals bypass context-local capabilities; receive clients through the context's database Layer composed by BackendRuntime.",
      { path: "^packages/backend/src/contexts/" },
      { path: "^packages/backend/src/database/internal/", pathNot: "/DatabaseTest\\.ts$" },
    ),
    forbid(
      "database-only-used-by-persistence-adapters",
      "Database handle imports couple domain behavior to storage; call a repository and keep database capabilities inside owned persistence adapters.",
      {
        path: "^packages/backend/src/contexts/",
        pathNot: [
          `${backendRoot}contexts/[^/]+/.*internal/[^/]*(?:Repository|Adapter|Database|DatabaseTest|Database\\.test)\\.ts$`,
        ],
      },
      { path: "/internal/[^/]*Database\\.ts$" },
    ),
    forbid(
      "provider-adapters-are-injected",
      "Generic code must not import a provider adapter; use ProviderRegistry and construct each adapter only in runtime/ApplicationLayer.ts.",
      {
        pathNot: [
          "^packages/backend/src/contexts/connections/internal/yahoo/",
          "^packages/backend/src/runtime/ApplicationLayer\\.ts$",
        ],
      },
      { path: "^packages/backend/src/contexts/connections/internal/yahoo/" },
    ),
    forbid(
      "game-source-adapters-are-injected",
      "Generic code must not import a game source adapter; use GameSourceRegistry and construct each adapter only in runtime/ApplicationLayer.ts.",
      {
        pathNot: [gameSourceAdapters, "^packages/backend/src/runtime/ApplicationLayer\\.ts$"],
      },
      { path: gameSourceAdapters },
    ),
    forbid(
      "live-layers-only-used-by-composition-roots",
      "Concrete Live Layer imports bypass dependency injection; depend on the service contract and compose its Live Layer in runtime/ApplicationLayer.ts or tests.",
      {
        pathNot: [
          "^packages/backend/src/runtime/ApplicationLayer\\.ts$",
          "\\.test\\.[cm]?[jt]sx?$",
        ],
      },
      { path: "/internal/[^/]*Live\\.ts$" },
    ),
  ],
  options: {
    parser: "swc",

    exclude: {
      path: [
        "\\.test\\.[cm]?[jt]sx?$",
        "^e2e/verify/(?:lifecycle|performance)\\.ts$",
        "^e2e/(?:playwright-report|test-results)/",
      ],
    },
    doNotFollow: {
      path: "node_modules",
    },
    enhancedResolveOptions: {
      conditionNames: ["types", "import", "default"],
      exportsFields: ["exports"],
    },
  },
} satisfies IConfiguration;

function forbid(
  name: string,
  comment: string,
  from: IRegularForbiddenRuleType["from"],
  to: IRegularForbiddenRuleType["to"],
): IRegularForbiddenRuleType {
  return { name, comment, severity: "error", from, to };
}
