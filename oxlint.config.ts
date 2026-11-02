import { defineConfig } from "oxlint";
import type { OxlintOverride } from "oxlint";

const implicitGlobals: GlobalRestriction[] = [
  "event",
  "length",
  "stop",
  "toString",
  "alert",
  "origin",
  "status",
].map((name) => ({
  name,
  message: `Implicit global ${name} can hide a missing local binding; declare an explicit local value or qualify intentional platform access with globalThis.`,
}));

const sqlImports: ImportPolicy = {
  paths: [
    {
      name: "drizzle-orm",
      importNames: ["inArray"],
      message:
        "ID-list predicates must use one bind parameter; import anyOf from database/dbUtilities.ts instead of inArray.",
    },
    {
      name: "drizzle-orm",
      importNames: [
        "sql",
        "SQL",
        "StringChunk",
        "Name",
        "name",
        "Table",
        "View",
        "Subquery",
        "WithSubquery",
      ],
      allowTypeImports: true,
      message:
        "SQL and storage constructors bypass structured, context-owned persistence; use structured Drizzle queries and keep storage declarations in internal Table/Tables modules.",
    },
  ],
  patterns: [
    {
      group: [
        "drizzle-orm/sql",
        "drizzle-orm/sql/**",
        "drizzle-orm/table",
        "drizzle-orm/view",
        "drizzle-orm/subquery",
      ],
      allowTypeImports: true,
      message:
        "SQL construction and storage internals bypass owned persistence; use structured Drizzle operations in the context's repository (AGENTS.md: Backend patterns).",
    },
  ],
};

const storageImports: ImportPolicy = {
  paths: [
    {
      name: "drizzle-orm/pg-core",
      importNames: [
        "pgTable",
        "pgTableCreator",
        "pgSchema",
        "PgTable",
        "PgSchema",
        "pgView",
        "pgMaterializedView",
        "PgView",
        "PgMaterializedView",
        "pgEnum",
      ],
      allowTypeImports: true,
      message:
        "Storage declarations outside owned table modules obscure ownership; declare them in the context's internal Table/Tables module.",
    },
  ],
  patterns: [
    {
      group: [
        "drizzle-orm/pg-core/table",
        "drizzle-orm/pg-core/schema",
        "drizzle-orm/pg-core/view",
        "drizzle-orm/pg-core/columns/enum",
      ],
      allowTypeImports: true,
      message:
        "SQL construction and storage internals bypass owned persistence; use structured Drizzle operations in the context's repository (AGENTS.md: Backend patterns).",
    },
  ],
};

const universalImports: ImportPolicy = {
  paths: [
    {
      name: "@tanstack/solid-query",
      importNames: ["useQueryClient"],
      message:
        "Direct cache access bypasses single-flight data flow; read with useQuery, write with mutationOptions, and leave other cache operations to routes (.agents/skills/web-interactions/references/data-flow.md).",
    },
    {
      name: "effect",
      message:
        "Effect in browser or universal modules crosses the execution boundary; delegate through a Remote and server function to an apps/web/src/server implementation.",
    },
    {
      name: "drizzle-orm",
      message:
        "Drizzle in browser or universal modules exposes persistence; call a Remote and server function backed by an owned backend repository instead.",
    },
    {
      name: "drizzle-kit",
      message:
        "Drizzle in browser or universal modules exposes persistence; call a Remote and server function backed by an owned backend repository instead.",
    },
    {
      name: "better-auth",
      message:
        "Better Auth server imports expose server authentication to universal code; use browser/session/authClient.ts or a server-only auth adapter instead.",
    },
    {
      name: "@solidjs/web",
      importNames: ["dynamic", "Dynamic"],
      message:
        "Dynamic elements outside the design system bypass shared markup and accessibility; compose browser/shared-ui or browser/brand-ui components instead.",
    },
    {
      name: "@better-auth/drizzle-adapter",
      message:
        "Better Auth server imports expose server authentication to universal code; use browser/session/authClient.ts or a server-only auth adapter instead.",
    },
  ],
  patterns: [
    {
      group: ["effect/*", "@effect/*"],
      message:
        "Effect in browser or universal modules crosses the execution boundary; delegate through a Remote and server function to an apps/web/src/server implementation.",
    },
    {
      group: ["drizzle-orm/*", "drizzle-kit/*"],
      message:
        "Drizzle in browser or universal modules exposes persistence; call a Remote and server function backed by an owned backend repository instead.",
    },
    {
      group: ["better-auth/*", "!better-auth/solid"],
      message:
        "Better Auth server imports expose server authentication to universal code; use browser/session/authClient.ts or a server-only auth adapter instead.",
    },
    {
      group: [
        "@lineupkeep/backend",
        "@lineupkeep/backend/**",
        "**/packages/backend/src/**",
        "!@lineupkeep/backend/**/*Limits",
      ],
      allowTypeImports: true,
      message:
        "Backend runtime imports cross the universal execution boundary; import domain types with import type and call runtime behavior through a Remote and server function.",
    },
    {
      group: [
        "#server/**",
        "#web/server.ts",
        "#routes/api/**",
        "**/server/**",
        "**/server",
        "**/server.ts",
        "**/routes/api/**",
      ],
      message:
        "Server imports in universal modules leak server-only code; call a browser Remote backed by a server function, or delegate protocol handling from an API route.",
    },
    {
      group: ["@kobalte/core", "@kobalte/core/*"],
      message:
        "Direct Kobalte imports bypass shared accessibility and tokens; compose browser/shared-ui primitives and keep Kobalte inside that design system.",
    },
  ],
};

const adapterImports: ImportPolicy = {
  patterns: [
    {
      group: [
        "effect",
        "effect/**",
        "@effect/**",
        "drizzle-orm",
        "drizzle-orm/**",
        "drizzle-kit",
        "drizzle-kit/**",
        "@better-auth/drizzle-adapter",
        "@kobalte/core",
        "@kobalte/core/**",
      ],
      message:
        "Effect or persistence imports thicken cross-runtime adapters; delegate to apps/web/src/server implementations and keep server functions and protocol routes thin.",
    },
    {
      group: ["better-auth", "better-auth/**", "!better-auth/solid"],
      message:
        "Authentication implementation imports thicken cross-runtime adapters; delegate authentication to apps/web/src/server implementations.",
    },
    {
      group: ["@lineupkeep/backend", "@lineupkeep/backend/**", "**/packages/backend/src/**"],
      allowTypeImports: true,
      message:
        "Backend runtime imports bypass the web adapter boundary; delegate through apps/web/src/server implementations and use import type for domain contracts.",
    },
  ],
};

const backendGlobals: GlobalRestriction[] = [
  {
    name: "fetch",
    message:
      "Global fetch bypasses the backend's network policy and Effect lifecycle; use PublicInternet for public HTTPS or the composed Effect HTTP client.",
  },
];

const backendProperties: PropertyRestriction[] = [
  {
    object: "globalThis",
    property: "fetch",
    message:
      "Global fetch bypasses the backend's network policy and Effect lifecycle; use PublicInternet for public HTTPS or the composed Effect HTTP client.",
  },
];

const persistenceProperties: PropertyRestriction[] = [
  {
    property: "execute",
    message:
      "Raw execution bypasses structured persistence; yield structured Drizzle queries in the context's repository instead.",
  },
  {
    property: "$client",
    message:
      "Accessing $client bypasses composed resource lifetimes; use the context's repository and construct clients only in database Layers.",
  },
  {
    property: "_",
    message:
      "Drizzle's internal session and relation metadata bypass context-owned persistence; use structured queries through the context's database contract.",
  },
  {
    property: "getSQL",
    message:
      "Reading a query's SQL representation bypasses structured persistence; yield the structured Drizzle query in the owned repository instead.",
  },
  {
    property: "queryChunks",
    message:
      "Mutating SQL chunks bypasses structured persistence; compose structured Drizzle operations in the owned repository instead.",
  },
];

const workflowMessage =
  "Ambient APIs make workflow transitions nondeterministic; read platform values in a use*.ts controller and pass them as event data.";
const workflowGlobals: GlobalRestriction[] = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "fetch",
  "crypto",
  "Date",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
  "requestAnimationFrame",
].map((name) => ({ name, message: workflowMessage }));

const correctnessRules = {
  "repository/package-imports": "error",
  "repository/no-comments": "error",
  "typescript/explicit-function-return-type": [
    "error",
    {
      allowExpressions: true,
      allowTypedFunctionExpressions: true,
      allowHigherOrderFunctions: false,
      allowConciseArrowFunctionExpressionsStartingWithVoid: true,
    },
  ],
  "repository/no-spread-push": "error",
  "effect-machine/no-async-planning-callback": "error",
  "effect-machine/no-browser-api-in-planning": "error",
  "effect-machine/no-conflicting-invocation-identity": "error",
  "effect-machine/no-nondeterministic-planning": "error",
  "effect-machine/no-redundant-resolve": "error",
  "effect-machine/prefer-inline-handle": "error",
  "for-direction": "error",
  "getter-return": "error",
  "no-async-promise-executor": "error",
  "no-case-declarations": "error",
  "no-class-assign": "error",
  "no-compare-neg-zero": "error",
  "no-cond-assign": "error",
  "no-const-assign": "error",
  "no-constant-binary-expression": "error",
  "no-constant-condition": "error",
  "no-control-regex": "error",
  "no-debugger": "error",
  "no-delete-var": "error",
  "no-dupe-class-members": "error",
  "no-dupe-else-if": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-empty": "error",
  "no-empty-character-class": "error",
  "no-empty-pattern": "error",
  "no-empty-static-block": "error",
  "no-ex-assign": "error",
  "no-extra-boolean-cast": "error",
  "no-fallthrough": "error",
  "no-func-assign": "error",
  "no-global-assign": "error",
  "no-import-assign": "error",
  "no-invalid-regexp": "error",
  "no-irregular-whitespace": "error",
  "no-loss-of-precision": "error",
  "no-new-native-nonconstructor": "error",
  "no-nonoctal-decimal-escape": "error",
  "no-obj-calls": "error",
  "no-prototype-builtins": "error",
  "no-regex-spaces": "error",
  "no-self-assign": "error",
  "no-setter-return": "error",
  "no-shadow-restricted-names": "error",
  "no-sparse-arrays": "error",
  "no-this-before-super": "error",
  "no-undef": "error",
  "no-unreachable": "error",
  "no-unsafe-finally": "error",
  "no-unsafe-negation": "error",
  "no-unsafe-optional-chaining": "error",
  "no-unused-labels": "error",
  "no-unused-private-class-members": "error",
  "no-unused-vars": "error",
  "no-useless-backreference": "error",
  "no-useless-catch": "error",
  "no-useless-escape": "error",
  "no-with": "error",
  "require-yield": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  "prefer-rest-params": "error",
  "prefer-spread": "error",
  "no-array-constructor": "error",
  "no-unused-expressions": "error",
  curly: "error",
  "block-scoped-var": "error",
  eqeqeq: "error",
  "no-var": "error",
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/ban-ts-comment": "error",
  "@typescript-eslint/no-array-delete": "error",
  "@typescript-eslint/no-base-to-string": "error",
  "@typescript-eslint/no-duplicate-enum-values": "error",
  "@typescript-eslint/no-duplicate-type-constituents": "warn",
  "@typescript-eslint/no-empty-object-type": "error",
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-extra-non-null-assertion": "error",
  "@typescript-eslint/no-floating-promises": "error",
  "@typescript-eslint/no-for-in-array": "error",
  "@typescript-eslint/no-implied-eval": "error",
  "@typescript-eslint/no-misused-new": "error",
  "@typescript-eslint/no-misused-promises": "error",
  "@typescript-eslint/no-namespace": "error",
  "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
  "@typescript-eslint/no-redundant-type-constituents": "error",
  "@typescript-eslint/no-require-imports": "error",
  "@typescript-eslint/no-this-alias": "error",
  "@typescript-eslint/no-unnecessary-type-assertion": "error",
  "@typescript-eslint/no-unnecessary-type-constraint": "error",
  "no-unnecessary-condition": "error",
  "@typescript-eslint/no-unsafe-argument": "error",
  "@typescript-eslint/no-unsafe-assignment": "error",
  "@typescript-eslint/no-unsafe-call": "error",
  "@typescript-eslint/no-unsafe-declaration-merging": "error",
  "@typescript-eslint/no-unsafe-enum-comparison": "error",
  "@typescript-eslint/no-unsafe-function-type": "error",
  "@typescript-eslint/no-unsafe-member-access": "error",
  "@typescript-eslint/no-unsafe-return": "error",
  "@typescript-eslint/no-unsafe-unary-minus": "error",
  "@typescript-eslint/no-wrapper-object-types": "error",
  "@typescript-eslint/only-throw-error": "off",
  "@typescript-eslint/prefer-as-const": "error",
  "@typescript-eslint/prefer-nullish-coalescing": "error",
  "@typescript-eslint/strict-boolean-expressions": "error",
  "@typescript-eslint/prefer-namespace-keyword": "error",
  "@typescript-eslint/prefer-promise-reject-errors": "error",
  "@typescript-eslint/require-await": "error",
  "@typescript-eslint/restrict-plus-operands": "error",
  "@typescript-eslint/restrict-template-expressions": "error",
  "@typescript-eslint/triple-slash-reference": "error",
  "@typescript-eslint/unbound-method": "error",
  "@typescript-eslint/switch-exhaustiveness-check": [
    "error",
    {
      allowDefaultCaseForExhaustiveSwitch: false,
    },
  ],
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/no-misused-spread": "error",
  "@typescript-eslint/no-unsafe-type-assertion": "error",
  "jsx-a11y/alt-text": "error",
  "jsx-a11y/anchor-ambiguous-text": "error",
  "jsx-a11y/anchor-has-content": "error",
  "jsx-a11y/anchor-is-valid": "error",
  "jsx-a11y/aria-activedescendant-has-tabindex": "error",
  "jsx-a11y/aria-props": "error",
  "jsx-a11y/aria-proptypes": "error",
  "jsx-a11y/aria-role": "error",
  "jsx-a11y/aria-unsupported-elements": "error",
  "jsx-a11y/autocomplete-valid": "error",
  "jsx-a11y/click-events-have-key-events": "error",
  "jsx-a11y/control-has-associated-label": "error",
  "jsx-a11y/heading-has-content": "error",
  "jsx-a11y/html-has-lang": "error",
  "jsx-a11y/iframe-has-title": "error",
  "jsx-a11y/img-redundant-alt": "error",
  "jsx-a11y/interactive-supports-focus": "error",
  "jsx-a11y/label-has-associated-control": "error",
  "jsx-a11y/lang": "error",
  "jsx-a11y/media-has-caption": "error",
  "jsx-a11y/mouse-events-have-key-events": "error",
  "jsx-a11y/no-access-key": "error",
  "jsx-a11y/no-aria-hidden-on-focusable": "error",
  "jsx-a11y/no-autofocus": "error",
  "jsx-a11y/no-distracting-elements": "error",
  "jsx-a11y/no-interactive-element-to-noninteractive-role": "error",
  "jsx-a11y/no-noninteractive-element-interactions": "error",
  "jsx-a11y/no-noninteractive-element-to-interactive-role": "error",
  "jsx-a11y/no-noninteractive-tabindex": "error",
  "jsx-a11y/no-redundant-roles": "error",
  "jsx-a11y/no-static-element-interactions": "error",
  "jsx-a11y/prefer-tag-over-role": "off",
  "jsx-a11y/role-has-required-aria-props": "error",
  "jsx-a11y/role-supports-aria-props": "error",
  "jsx-a11y/scope": "error",
  "jsx-a11y/tabindex-no-positive": "error",
  "solid/components-return-once": "error",
  "solid/event-handlers": "error",
  "solid/imports": "error",
  "solid/jsx-no-duplicate-props": "error",
  "solid/jsx-no-script-url": "error",
  "solid/jsx-no-undef": [
    "error",
    {
      typescriptEnabled: true,
    },
  ],
  "solid/jsx-uses-vars": "error",
  "solid/no-array-handlers": "error",
  "solid/no-destructure": "error",
  "solid/no-innerhtml": "error",
  "solid/no-proxy-apis": "error",
  "solid/no-react-deps": "error",
  "solid/no-react-specific-props": "error",
  "solid/no-unknown-namespaces": "error",
  "solid/prefer-classlist": "error",
  "solid/prefer-for": "error",
  "solid/prefer-show": "error",
  "solid/reactivity": [
    "error",
    {
      customReactiveFunctions: ["dynamic"],
    },
  ],
  "solid/self-closing-comp": "error",
  "solid/style-prop": "error",
} satisfies Rules;

const effectRules = {
  "effecttsgo/abort-controller-in-effect": "error",
  "effecttsgo/any-unknown-in-error-context": "error",
  "effecttsgo/async-function": "error",
  "effecttsgo/catch-all-to-map-error": "error",
  "effecttsgo/catch-chain-to-first-success-of": "error",
  "effecttsgo/catch-tag-to-catch-reason": "error",
  "effecttsgo/catch-to-ignore": "error",
  "effecttsgo/catch-to-or-else-succeed": "error",
  "effecttsgo/catch-unfailable-effect": "error",
  "effecttsgo/class-self-mismatch": "error",
  "effecttsgo/crypto-random-uuid": "error",
  "effecttsgo/crypto-random-uuid-in-effect": "error",
  "effecttsgo/deterministic-keys": "error",
  "effecttsgo/duplicate-package": "error",
  "effecttsgo/effect-do-notation": "error",
  "effecttsgo/effect-fn-iife": "error",
  "effecttsgo/effect-fn-implicit-any": "error",
  "effecttsgo/effect-fn-opportunity": "error",
  "effecttsgo/effect-gen-uses-adapter": "error",
  "effecttsgo/effect-in-failure": "error",
  "effecttsgo/effect-in-void-success": "error",
  "effecttsgo/effect-map-flatten": "error",
  "effecttsgo/effect-map-void": "error",
  "effecttsgo/effect-succeed-with-void": "error",
  "effecttsgo/extends-native-error": "error",
  "effecttsgo/flat-map-to-map": "error",
  "effecttsgo/floating-effect": "error",
  "effecttsgo/floating-effect-in-vitest": "error",
  "effecttsgo/generic-effect-services": "error",
  "effecttsgo/global-console": "error",
  "effecttsgo/global-console-in-effect": "error",
  "effecttsgo/global-date": "error",
  "effecttsgo/global-date-in-effect": "error",
  "effecttsgo/global-error-in-effect-catch": "error",
  "effecttsgo/global-error-in-effect-failure": "error",
  "effecttsgo/global-fetch": "error",
  "effecttsgo/global-fetch-in-effect": "error",
  "effecttsgo/global-random": "error",
  "effecttsgo/global-random-in-effect": "error",
  "effecttsgo/global-timers": "error",
  "effecttsgo/global-timers-in-effect": "error",
  "effecttsgo/instance-of-schema": "error",
  "effecttsgo/layer-merge-all-with-dependencies": "error",
  "effecttsgo/lazy-effect": "error",
  "effecttsgo/lazy-promise-in-effect-sync": "error",
  "effecttsgo/leaking-requirements": "error",
  "effecttsgo/missing-effect-context": "error",
  "effecttsgo/missing-effect-error": "error",
  "effecttsgo/missing-effect-service-dependency": "error",
  "effecttsgo/missing-layer-context": "error",
  "effecttsgo/missing-return-yield-star": "error",
  "effecttsgo/missing-star-in-yield-effect-gen": "error",
  "effecttsgo/multiple-catch-tag": "error",
  "effecttsgo/multiple-effect-provide": "error",
  "effecttsgo/nested-effect-gen-yield": "error",
  "effecttsgo/new-promise": "error",
  "effecttsgo/new-schema-class": "error",
  "effecttsgo/node-builtin-import": "error",
  "effecttsgo/non-object-effect-service-type": "error",
  "effecttsgo/outdated-api": "error",
  "effecttsgo/overridden-schema-constructor": "error",
  "effecttsgo/prefer-schema-over-json": "error",
  "effecttsgo/prefer-schema-type-property": "error",
  "effecttsgo/prefer-typed-schema-decoder": "error",
  "effecttsgo/prefer-unsafe-constructor": "error",
  "effecttsgo/process-env": "error",
  "effecttsgo/process-env-in-effect": "error",
  "effecttsgo/promise-in-effect-success": "error",
  "effecttsgo/redundant-map-error": "error",
  "effecttsgo/redundant-or-die": "error",
  "effecttsgo/redundant-schema-tag-identifier": "error",
  "effecttsgo/return-effect-in-gen": "error",
  "effecttsgo/run-effect-inside-effect": "error",
  "effecttsgo/schema-literal-non-finite": "error",
  "effecttsgo/schema-number": "error",
  "effecttsgo/schema-opaque-instance-member": "error",
  "effecttsgo/schema-struct-with-tag": "error",
  "effecttsgo/schema-sync-in-effect": "error",
  "effecttsgo/schema-union-of-literals": "error",
  "effecttsgo/scope-in-layer-effect": "error",
  "effecttsgo/service-not-as-class": "error",
  "effecttsgo/strict-boolean-expressions": "error",
  "effecttsgo/strict-effect-provide": "error",
  "effecttsgo/sync-to-succeed": "error",
  "effecttsgo/try-catch-in-effect-gen": "error",
  "effecttsgo/unknown-in-effect-catch": "error",
  "effecttsgo/unnecessary-arrow-block": "error",
  "effecttsgo/unnecessary-effect-gen": "error",
  "effecttsgo/unnecessary-fail-yieldable-error": "error",
  "effecttsgo/unnecessary-pipe": "error",
  "effecttsgo/unnecessary-pipe-chain": "error",
  "effecttsgo/unnecessary-typeof-type": "error",
  "effecttsgo/unsafe-effect-type-assertion": "error",
} satisfies Rules;

const source = ["apps/web/src/**/*.{ts,tsx}"];
const backend = ["packages/backend/src/**/*.ts"];
const server = ["apps/web/src/server/**/*.ts", "apps/web/src/server.ts"];
const protocols = [
  "apps/web/src/routes/api/**/*.ts",
  "apps/web/src/routes/**/-server/**/*.ts",
  "apps/web/src/routes/mcp.ts",
  "apps/web/src/routes/*well-known*.ts",
];
const adapters = ["apps/web/src/server-functions/**/*.ts", ...protocols];
const primitives = ["apps/web/src/browser/shared-ui/**/*.{ts,tsx}"];
const compositions = ["apps/web/src/browser/brand-ui/**/*.{ts,tsx}"];
const tests = ["**/*.test.{ts,tsx}"];
const lineupPure = [
  "packages/lineup-solver/src/**/*.ts",
  "packages/backend/src/contexts/connections/internal/provider-scoring/**/*.ts",
];
const nodeTransport = ["packages/backend/src/runtime/public-internet/transport/node/**/*.ts"];
const hostedBrowserShell = [
  "apps/web/src/server/hostedLinking/playwrightHostedBrowser.ts",
  "apps/web/src/server/hostedLinking/remoteHostedBrowser.ts",
  "apps/web/src/server/hostedLinking/cloudRunIdentity.ts",
  "apps/web/src/server/hostedLinking/hostedLinkingStream.ts",
];
const hostedBrowserShellTests = [
  "apps/web/src/server/hostedLinking/playwrightHostedBrowser.test.ts",
  "apps/web/src/server/hostedLinking/remoteHostedBrowser.test.ts",
];
const migrationTests = ["packages/backend/src/database/MigrationOrdering.test.ts"];
const fixtureReadingTests = [
  "packages/backend/src/contexts/connections/internal/ProfessionalCalendar.test.ts",
  "packages/backend/src/contexts/connections/internal/ProfessionalTeamMap.test.ts",
  "packages/backend/src/contexts/connections/internal/game-sources/nhl/NhlGameSource.test.ts",
];
const isolateTransport = ["packages/backend/src/runtime/public-internet/transport/isolate/**/*.ts"];
const transportTests = ["packages/backend/src/runtime/public-internet/transport/**/*.test.ts"];
const timing = ["apps/web/src/browser/timing/**"];
const timerMessage =
  "Timers obscure request completion and recovery; wait on Query, router state, or onSettled instead, or use a named helper in browser/timing/.";
const timerGlobals = ["setTimeout", "setInterval"].map((name) => ({ name, message: timerMessage }));
const timerProperties = ["window", "globalThis", "self"].flatMap((object) =>
  timerGlobals.map(({ name, message }) => ({ object, property: name, message })),
);
export default defineConfig({
  options: { typeAware: true, typeCheck: true, maxWarnings: 0 },
  plugins: ["typescript", "unicorn", "oxc", "effecttsgo", "jsx-a11y"],
  jsPlugins: [
    "./scripts/lintPlugin.ts",
    "@typeonce/oxlint-plugin-effect-machine",
    "eslint-plugin-solid",
  ],
  env: { builtin: true, browser: false, node: true },
  ignorePatterns: [
    "node_modules/**/*",
    "**/node_modules/**/*",
    "**/dist/**/*",
    "**/.tanstack/**/*",
    "apps/web/src/routeTree.gen.ts",
  ],
  rules: {
    ...correctnessRules,
    ...imports(),
    ...globals(),
    "repository/workflow-tests": "error",
    "repository/codec-tests": "error",
    "repository/provider-scoring-vocabulary": "error",
    "repository/provider-action-vocabulary": "error",
    "repository/provider-identity": "error",
    "repository/provider-sport-rule": "error",
    "repository/provider-wire-vocabulary": "error",
  },
  overrides: [
    { files: ["**/*.{js,cjs,mjs}"], rules: { "no-redeclare": "error" } },
    { files: source, env: { node: false, browser: true } },
    { files: ["packages/hosted-browser/src/browser.ts"], env: { browser: true, node: true } },
    { files: server, env: { browser: false, node: true } },
    { files: ["e2e/**/*.ts"], env: { browser: true, node: true } },
    {
      files: ["e2e/scenarios/**/*.ts", "e2e/scratch/**/*.ts"],
      rules: { "repository/production-services": "error" },
    },
    {
      files: backend,
      excludeFiles: [...isolateTransport, ...transportTests],
      rules: { ...globals(backendGlobals), ...properties(backendProperties) },
    },
    {
      files: ["packages/backend/src/contexts/**/*.ts"],
      excludeFiles: ["**/internal/**/*Table.ts", "**/internal/**/*Tables.ts"],
      rules: imports(storageImports),
    },
    {
      files: lineupPure,
      excludeFiles: tests,
      rules: {
        ...globals([
          {
            name: "Date",
            message:
              "Lineup calculation must not read the clock; pass the current period from the caller.",
          },
          {
            name: "fetch",
            message:
              "Lineup calculation must remain pure; call the provider adapter for network access.",
          },
          {
            name: "setTimeout",
            message: "Lineup calculation must remain pure; wait in the workflow shell instead.",
          },
          {
            name: "setInterval",
            message: "Lineup calculation must remain pure; wait in the workflow shell instead.",
          },
          {
            name: "queueMicrotask",
            message:
              "Lineup calculation must remain pure; call the workflow shell to schedule work.",
          },
          {
            name: "process",
            message: "Lineup calculation must not read process state; pass plain problem data.",
          },
          {
            name: "crypto",
            message:
              "Lineup calculation must remain deterministic; pass randomness from outside the calculation.",
          },
          {
            name: "console",
            message: "Lineup calculation must not log; yield a plan or a named refusal.",
          },
        ]),
        ...properties([
          {
            object: "Math",
            property: "random",
            message:
              "Lineup calculation must remain deterministic; pass randomness from outside the calculation.",
          },
          {
            object: "performance",
            property: "now",
            message:
              "Lineup calculation must not read the clock; pass the current period from the caller.",
          },
        ]),
      },
    },
    {
      files: ["packages/backend/src/contexts/**/internal/**/*Database.ts"],
      rules: imports(storageImports),
    },
    {
      files: ["packages/backend/src/contexts/**/*.ts"],
      rules: properties(backendProperties, persistenceProperties),
    },
    {
      files: source,
      excludeFiles: [...server, ...adapters, ...primitives],
      rules: imports(universalImports),
    },
    {
      files: primitives,
      rules: imports({
        paths: universalImports.paths?.filter((restriction) => restriction.name !== "@solidjs/web"),
        patterns: universalImports.patterns?.filter(
          (restriction) => !restriction.group.includes("@kobalte/core"),
        ),
      }),
    },
    { files: protocols, rules: imports(adapterImports) },
    {
      files: ["apps/web/src/server-functions/**/*.ts"],
      rules: {
        ...imports({
          patterns: [
            {
              group: [
                "drizzle-orm",
                "drizzle-orm/**",
                "drizzle-kit",
                "drizzle-kit/**",
                "better-auth",
                "better-auth/**",
                "alchemy",
                "alchemy/**",
                "@alchemy.run/**",
                "**/internal/**",
                "**/database/**",
                "#database/**",
              ],
              message:
                "Persistence and provisioning bypass public use cases; invoke public backend services in erased handlers and keep construction in owned server Layers.",
            },
          ],
        }),
        "repository/erased-server-code": "error",
      },
    },
    {
      files: ["apps/web/src/server-functions/**/*.ts", ...server],
      excludeFiles: ["apps/web/src/server/backendEntry.ts", ...tests],
      rules: { "repository/literal-operation": "error" },
    },
    {
      files: ["apps/web/src/**/*.tsx"],
      excludeFiles: [...primitives, ...compositions, "apps/web/src/routes/__root.tsx", ...tests],
      rules: {
        "repository/no-intrinsic-elements": "error",
        "repository/no-style-props": "error",
      },
    },
    {
      files: ["apps/web/src/browser/**/*.tsx"],
      excludeFiles: [...primitives, ...compositions, ...tests],
      rules: { "repository/no-state": "error" },
    },
    {
      files: [...primitives, ...compositions],
      excludeFiles: tests,
      rules: { "repository/token-values": "error" },
    },
    {
      files: ["packages/backend/src/database/dbUtilities.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: sqlImports.paths?.map((policy) => ({
              ...policy,
              importNames: policy.importNames?.filter((name) => name !== "sql"),
            })),
            patterns: sqlImports.patterns,
          },
        ],
        ...properties(backendProperties, persistenceProperties),
      },
    },
    { files: [...backend, ...server, "apps/web/src/server-functions/**/*.ts"], rules: effectRules },
    {
      files: ["packages/backend/src/contexts/*/*Limits.ts"],
      rules: { "repository/literal-limits": "error" },
    },
    {
      files: [
        ...backend,
        ...server,
        "apps/web/src/server-functions/**/*.ts",
        "e2e/scenarios/**/*.ts",
      ],
      excludeFiles: tests,
      rules: { "repository/no-per-item-service-calls": "error" },
    },
    {
      files: [...migrationTests, ...fixtureReadingTests],
      rules: {
        "effecttsgo/node-builtin-import": "off",
      },
    },
    {
      files: nodeTransport,
      rules: {
        "effecttsgo/node-builtin-import": "off",
        "effecttsgo/async-function": "off",
        "effecttsgo/new-promise": "off",
      },
    },
    {
      files: hostedBrowserShell,
      rules: {
        "effecttsgo/async-function": "off",
        "effecttsgo/global-date": "off",
        "effecttsgo/global-fetch": "off",
        "effecttsgo/global-timers": "off",
        "effecttsgo/new-promise": "off",
        "effecttsgo/node-builtin-import": "off",
      },
    },
    {
      files: ["apps/web/src/server/targets/node.ts"],
      rules: { "effecttsgo/process-env": "off" },
    },
    {
      files: hostedBrowserShellTests,
      rules: {
        "effecttsgo/global-date": "off",
        "effecttsgo/global-error-in-effect-catch": "off",
        "effecttsgo/global-error-in-effect-failure": "off",
        "effecttsgo/global-timers": "off",
        "effecttsgo/new-promise": "off",
        "effecttsgo/node-builtin-import": "off",
      },
    },
    {
      files: [...isolateTransport, ...transportTests],
      rules: {
        ...globals(),
        "effecttsgo/global-fetch": "off",
        "effecttsgo/global-fetch-in-effect": "off",
      },
    },
    {
      files: ["apps/web/src/browser/**/*.{ts,tsx}"],
      excludeFiles: [...timing, ...tests],
      rules: { ...globals(timerGlobals), ...properties(timerProperties) },
    },
    {
      files: ["apps/web/src/browser/**/*Workflow.ts"],
      rules: {
        ...globals(workflowGlobals),
        ...properties(
          timerProperties,
          [{ object: "Math", property: "random", message: workflowMessage }],
          ["globalThis", "window", "self"].flatMap((object) =>
            [...workflowGlobals.map(({ name }) => name), "Math"].map((property) => ({
              object,
              property,
              message: workflowMessage,
            })),
          ),
        ),
      },
    },
    {
      files: [...tests, "e2e/**/*.ts"],
      rules: { "repository/no-test-internals": "error" },
    },
    {
      files: tests,
      rules: {
        "effecttsgo/strict-effect-provide": "off",
        "effecttsgo/async-function": "off",
      },
    },
    {
      files: ["packages/backend/src/config/DatabaseUrl.test.ts"],
      rules: {
        "effecttsgo/prefer-schema-over-json": "off",
        "typescript/no-base-to-string": "off",
      },
    },
    {
      files: [
        "packages/backend/src/runtime/BackendRuntime.ts",
        "packages/backend/src/runtime/ApplicationLayer.ts",
        "packages/backend/src/runtime/RequestContext.ts",
        "packages/backend/src/contexts/**/internal/**/*Database{,Test}.ts",
      ],
      rules: { "effecttsgo/strict-effect-provide": "off" },
    },
  ],
});

function imports(...policies: ImportPolicy[]): Rules {
  return {
    "no-restricted-imports": [
      "error",
      {
        paths: [sqlImports, ...policies].flatMap((policy) => policy.paths ?? []),
        patterns: [sqlImports, ...policies].flatMap((policy) => policy.patterns ?? []),
      },
    ],
  };
}

function globals(...restrictions: GlobalRestriction[][]): Rules {
  return { "no-restricted-globals": ["error", ...implicitGlobals, ...restrictions.flat()] };
}

function properties(...restrictions: PropertyRestriction[][]): Rules {
  return { "no-restricted-properties": ["error", ...restrictions.flat()] };
}

type Rules = NonNullable<OxlintOverride["rules"]>;

type ImportPolicy = {
  readonly paths?: {
    name: string;
    importNames?: string[];
    allowTypeImports?: boolean;
    message: string;
  }[];
  readonly patterns?: { group: string[]; allowTypeImports?: boolean; message: string }[];
};

type GlobalRestriction = { name: string; message: string };
type PropertyRestriction = { object?: string; property: string; message: string };
