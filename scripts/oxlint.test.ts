import { expect, it } from "vitest";

import { checkLint } from "./architectureFixture.ts";

const workflowTestDeclarations = `
  export declare const exploreWorkflow: (workflow: number, options: unknown) => void;
  export declare const fc: { assert: (property: unknown) => void; property: (events: unknown, check: unknown) => unknown };
  export declare const MachineTest: { explore: (workflow: number, options: unknown) => void; scenarios: (workflow: number) => void };
  export const options = {};
  export const events: unknown[] = [];
  export const check = (): boolean => true;
`;

it.each([
  ["exploration", "fc.assert(fc.property(events, check));"],
  ["property test", "exploreWorkflow(workflow, options);"],
])("names the missing workflow %s and its owner", (missing, test) => {
  const result = checkLint({
    "scripts/calendarWorkflow.ts": "export const workflow = 1;",
    "scripts/calendarWorkflow.test.ts": `import { workflow } from "./calendarWorkflow.ts"; export { workflow }; ${workflowTestDeclarations} ${test}`,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(`add ${missing}`);
  expect(result.output).toContain("repository(workflow-tests)");
  expect(result.output).toContain("calendarWorkflow.test.ts");
});

it("rejects workflow markers hidden in strings and comments", () => {
  const result = checkLint({
    "scripts/calendarWorkflow.ts": "export const workflow = 1;",
    "scripts/calendarWorkflow.test.ts":
      'import { workflow } from "./calendarWorkflow.ts"; export const label = "exploreWorkflow fc.assert fc.property"; export { workflow }; /* MachineTest.explore(); MachineTest.scenarios(); */',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(workflow-tests)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("add exploration");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("add property test");
});

it.each([
  "exploreWorkflow(workflow, options); fc.assert(fc.property(events, check));",
  "MachineTest.explore(workflow, options); MachineTest.scenarios(workflow);",
])("accepts the workflow toolchain: %s", (test) => {
  const result = checkLint({
    "scripts/calendarWorkflow.ts": "export const workflow = 1;",
    "scripts/calendarWorkflow.test.ts": `import { workflow } from "./calendarWorkflow.ts"; export { workflow }; ${workflowTestDeclarations} ${test}`,
  });

  expect(result.status, result.output).toBe(0);
});

const codecFixture = {
  "scripts/CalendarTables.ts": "export const CalendarRow = 1;",
};
const codecTestDeclarations = `
  import { it } from "vitest";
  import { CalendarRow } from "./CalendarTables.ts";
  export declare const Schema: {
    encodeEffect: (codec: unknown) => (value: unknown) => unknown;
    decodeEffect: (codec: unknown) => (value: unknown) => unknown;
  };
`;

it.each([
  'it("round-trips a row", () => { Schema.decodeEffect(CalendarRow)(1); });',
  'it("round-trips a row", () => { Schema.encodeEffect(CalendarRow)(1); });',
  'it("round-trips a row", () => { Schema.decodeEffect(CalendarRow)("Schema.encodeEffect(CalendarRow)(1)"); });',
  'it("round-trips a row", () => { Schema.decodeEffect(CalendarRow)(1); /* Schema.encodeEffect(CalendarRow)(1); */ });',
])("requires owned machine row-codec round trips: %s", (test) => {
  const result = checkLint({
    ...codecFixture,
    "scripts/CalendarTables.test.ts": `${codecTestDeclarations} ${test}`,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(codec-tests)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "CalendarTables.test.ts: add a round-trip test",
  );
});

it("requires round trips for an aliased row-codec import", () => {
  const result = checkLint({
    ...codecFixture,
    "scripts/CalendarTables.test.ts":
      'import { CalendarRow as StoredRow } from "./CalendarTables.ts"; export { StoredRow };',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(codec-tests)");
});

it("accepts owned machine row-codec round trips", () => {
  const result = checkLint({
    ...codecFixture,
    "scripts/CalendarTables.test.ts": `${codecTestDeclarations}
      it("round-trips a row", () => { Schema.encodeEffect(CalendarRow)(1); Schema.decodeEffect(CalendarRow)(1); });`,
  });

  expect(result.status, result.output).toBe(0);
});

it.each([
  "export const label = 'import { CalendarRow } from \"./CalendarTables.ts\";';",
  '/* import { CalendarRow } from "./CalendarTables.ts"; */ export const value = 1;',
  'import type { CalendarRow } from "./CalendarTables.ts"; export type Value = CalendarRow;',
  'import { type CalendarRow } from "./CalendarTables.ts"; export type Value = CalendarRow;',
  'import { calendar } from "./CalendarTables.ts"; export { calendar };',
  'import { CalendarRow } from "./Calendar.ts"; export { CalendarRow };',
])("ignores non-codec imports and import markers in test text: %s", (test) => {
  const result = checkLint({
    "scripts/CalendarTables.ts": "export type CalendarRow = number; export const calendar = 1;",
    "scripts/Calendar.ts": "export const CalendarRow = 1;",
    "scripts/CalendarTables.test.ts": test,
  });

  expect(result.output).not.toContain("repository(codec-tests)");
  if (test.startsWith("/*")) {
    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("repository(no-comments)");
  } else {
    expect(result.status, result.output).toBe(0);
  }
});

it("checks workflow test contents without an implementation file", () => {
  const result = checkLint({
    "scripts/calendarWorkflow.test.ts": `${workflowTestDeclarations} exploreWorkflow(1, options); fc.assert(fc.property(events, check));`,
  });

  expect(result.status, result.output).toBe(0);
});

it("accepts ordinary tests and workflow controller modules without workflow coverage", () => {
  const result = checkLint({
    "scripts/ordinary.test.ts": "export const value = 1;",
    "scripts/useCalendarWorkflow.ts": "export const value = 1;",
  });

  expect(result.status, result.output).toBe(0);
});

it.each(["/* oxlint-disable */", "// oxlint-disable-next-line repository/no-comments"])(
  "rejects a standalone disable directive: %s",
  (source) => {
    const result = checkLint({ "scripts/example.ts": `${source}\nexport const value = 1;` });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("repository(no-comments)");
    expect(result.output).toContain("scripts/example.ts:1:1");
  },
);

it.each(["ts", "tsx", "js"])("rejects comments in %s sources", (extension) => {
  const result = checkLint({ [`scripts/example.${extension}`]: "// explanation\n" });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-comments)");
});

it.each([
  "export const value = /* explanation */ 1;",

  '/// <reference types="node" />',
])("rejects authored comments: %s", (source) => {
  const result = checkLint({ "scripts/example.ts": source });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-comments)");
});

it("rejects JSX comments", () => {
  const result = checkLint({
    "scripts/example.tsx": "export const View = () => <>{/* explanation */}</>;",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-comments)");
});

it.each([
  'export const values = ["https://example.com", `/* text */`, /\\/\\//];',
  "#!/usr/bin/env node\nexport const value = 1;",
])("accepts comment-like literals and interpreter directives: %s", (source) => {
  const result = checkLint({ "scripts/example.ts": source });

  expect(result.status, result.output).toBe(0);
});

it("ignores the generated route tree without exempting authored gen modules", () => {
  const generated = checkLint({
    "apps/web/src/routeTree.gen.ts": "// generated\nexport const value = 1;",
    "scripts/example.ts": "export const value = 1;",
  });
  const authored = checkLint({
    "apps/web/src/example.gen.ts": "// authored\nexport const value = 1;",
  });

  expect(generated.status, generated.output).toBe(0);
  expect(authored.status).toBeGreaterThan(0);
  expect(authored.output).toContain("repository(no-comments)");
});

it("reports policy diagnostics through Oxlint with a source location", () => {
  const result = checkLint({ "scripts/example.ts": "export const value = 1;\n// explanation" });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-comments)");
  expect(result.output).toContain("names, types, schemas, tests, or rules");
  expect(result.output).toContain("external specification links in the owning skill or runbook");
  expect(result.output).toContain("scripts/example.ts:2:1");
});

it("accepts the required Vite reference through Oxlint", () => {
  const result = checkLint({
    "apps/web/src/assets.d.ts": '/// <reference types="vite/client" />\n',
  });

  expect(result.status, result.output).toBe(0);
});

const packageImportCases = [
  'import { value } from "../shared/value.ts"; export { value };',
  'export { value } from "../shared/value.ts";',
  'export * from "../shared/value.ts";',
  'export type Value = import("../shared/value.ts").Value;',
  'export const load: () => Promise<typeof import("../shared/value.ts")> = () => import("../shared/value.ts");',
];

it("rejects parent imports", () => {
  const source = 'import { value } from "../shared/value.ts"; export { value };';
  const result = checkLint({
    "packages/backend/src/config/example.ts": source,
    "packages/backend/src/shared/value.ts": "export const value = 1; export type Value = number;",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(package-imports)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("package.json imports");
});

it.each(packageImportCases)("autofixes parent imports through the owning package: %s", (source) => {
  const result = checkLint(
    {
      "packages/backend/src/config/example.ts": source,
      "packages/backend/src/shared/value.ts": "export const value = 1; export type Value = number;",
    },
    true,
  );

  expect(result.status, result.output).toBe(0);
  expect(result.sources["packages/backend/src/config/example.ts"]).toContain(
    '"#backend/shared/value.ts"',
  );
  expect(result.sources["packages/backend/src/config/example.ts"]).not.toContain("../");
});

it("autofixes extensionless imports and uses package exports across packages", () => {
  const result = checkLint(
    {
      "infra/local/example.ts":
        'export { value } from "../../tools/local-stack/value.ts"; export { stage } from "../stage";',
      "tools/local-stack/value.ts": "export const value = 1;",
      "infra/stage.ts": "export const stage = 1;",
    },
    true,
  );

  expect(result.status, result.output).toBe(0);
  expect(result.sources["infra/local/example.ts"]).toContain(
    '"@lineupkeep/tools/local-stack/value.ts"',
  );
  expect(result.sources["infra/local/example.ts"]).toContain('"#infra/stage.ts"');
});

it("explains missing aliases without rewriting an unexported cross-package target", () => {
  const source = 'export { value } from "../packages/backend/src/config/value.ts";';
  const result = checkLint(
    {
      "scripts/example.ts": source,
      "packages/backend/src/config/value.ts": "export const value = 1;",
    },
    true,
  );

  expect(result.status).toBeGreaterThan(0);
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "add a matching package.json imports alias",
  );
  expect(result.sources["scripts/example.ts"]).toBe(source);
});

it("keeps same-directory imports and package imports unchanged", () => {
  const files = {
    "packages/backend/src/config/example.ts":
      'import { value } from "./value.ts"; export { value }; export type { UserId } from "@lineupkeep/backend/auth/User";',
    "packages/backend/src/config/value.ts": "export const value = 1;",
    "packages/backend/src/contexts/auth/User.ts": "export type UserId = string;",
  };

  const result = checkLint(files, true);

  expect(result.status, result.output).toBe(0);
  expect(result.sources).toEqual(files);
});

it.each([
  "expect(send).toHaveBeenCalled();",
  'expect(send).not.toHaveBeenCalledWith("payload");',
  'expect(send)["toHaveBeenCalledTimes"](2);',
  'expect(send)?.toHaveBeenCalledExactlyOnceWith("payload");',
  "void send.mock.calls;",
  'void send["mock"]["results"];',
  "void send.mock?.calls;",
  "const { calls } = send.mock; void calls;",
  'const { results: outcomes } = send["mock"]; void outcomes;',
  "const { toHaveBeenCalledWith: matched } = expect(send); void matched;",
])("rejects assertions on test implementation details: %s", (source) => {
  const result = checkLint({
    "scripts/example.test.ts": `import { expect, vi } from "vitest"; const send = vi.fn(); ${source}`,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-test-internals)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("assert observable outcomes instead");
});

it.each([
  'vi.doMock("./dependency.ts");',
  "vi.hoisted(() => ({}));",
  'vi["mock"]("./dependency.ts");',
  "const mock = vi.mock; void mock;",
  'testing.mock("./dependency.ts");',
  'vitest.vi.doMock("./dependency.ts");',
  'const api = testing; api.doMock("./dependency.ts");',
  "const { mock: replace } = vi; void replace;",
])("rejects module mocking: %s", (source) => {
  const result = checkLint({
    "scripts/example.test.ts": `import { vi, vi as testing } from "vitest"; import * as vitest from "vitest"; ${source}`,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-test-internals)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("inject the dependency or use MSW");
});

it.each(["e2e/scenarios/example.e2e.ts"])("rejects mock history in %s", (path) => {
  const result = checkLint({
    [path]:
      'import { expect } from "@playwright/test"; declare const send: unknown; expect(send).toHaveBeenCalled();',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-test-internals)");
});

it("permits external transport handlers and unrelated shadowed methods", () => {
  const result = checkLint({
    "scripts/example.test.ts":
      'import { http, HttpResponse } from "msw/http"; export const handler = http.get("https://provider.example/status", () => HttpResponse.json({ ready: true })); const vi = { mock: (): string => "ready" }; export const status = vi.mock();',
  });

  expect(result.status, result.output).toBe(0);
});

it("permits injected test dependencies and assertions on returned outcomes", () => {
  const result = checkLint({
    "scripts/example.test.ts":
      'import { expect, vi } from "vitest"; const read = vi.fn(() => "ready"); expect(read()).toBe("ready"); const clock = { mock: (): string => "time" }; expect(clock.mock()).toBe("time");',
  });

  expect(result.status, result.output).toBe(0);
});

it.each([
  "export function count() { return 1; }",
  "export const count = () => 1;",
  "export class Counter { count() { return 1; } }",
])("requires a return contract on named functions: %s", (source) => {
  const result = checkLint({ "scripts/example.ts": source });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("typescript(explicit-function-return-type)");
  expect(result.output).toContain("Require explicit return types");
});

it("permits explicit named contracts and inferred inline callbacks", () => {
  const result = checkLint({
    "scripts/example.ts":
      "export function count(): number { return [1, 2].map((value) => value + 1).reduce((total, value) => total + value, 0); } export const read: () => number = () => count();",
  });

  expect(result.status, result.output).toBe(0);
});

it.each(['import { inArray as matches } from "drizzle-orm"; export const predicate = matches;'])(
  "steers ID-list predicates to one-bind anyOf: %s",
  (source) => {
    const result = checkLint({
      "packages/backend/src/contexts/example/internal/ExampleRepository.ts": source,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("anyOf");
    expect(result.output).toContain("one bind parameter");
  },
);

it("permits one-bind predicates in owned repositories", () => {
  const result = checkLint({
    "packages/backend/src/contexts/example/internal/ExampleRepository.ts":
      'import { anyOf } from "#database/dbUtilities.ts"; export const predicate = anyOf;',
    "packages/backend/src/database/dbUtilities.ts": "export const anyOf = (): boolean => true;",
  });

  expect(result.status, result.output).toBe(0);
});

it.each(["items.push(...values);", 'items["push"](...values);', "items.push(first, ...values);"])(
  "rejects unbounded push arguments: %s",
  (source) => {
    const result = checkLint({
      "scripts/example.ts": `export const append = (items: string[], values: string[], first: string): void => { ${source} };`,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("repository(no-spread-push)");
    expect(result.output).toContain("for-of loop");
  },
);

it("permits bounded append arguments and for-of appends", () => {
  const result = checkLint({
    "scripts/example.ts":
      "export const append = (items: string[], values: string[]): void => { items.push('first', 'second'); for (const value of values) { items.push(value); } };",
  });

  expect(result.status, result.output).toBe(0);
});
it.each([
  "for (const input of inputs) yield* notes.update(owner, [input]);",
  "for (let i = 0; i < inputs.length; i++) yield* notes.update(owner, [inputs[i]]);",
  "while (inputs.length) yield* notes.update(owner, inputs);",
  "yield* Effect.forEach(inputs, (input) => notes.update(owner, [input]));",
  "yield* Effect.all(inputs.map((input) => notes.update(owner, [input])));",

  "const alias = notes; inputs.forEach((input) => alias.update(owner, [input]));",
  "const update = notes.update; inputs.map((input) => update(owner, [input]));",
  "const { update } = notes; inputs.map((input) => update(owner, [input]));",
  "const save = (input: string) => notes.update(owner, [input]); yield* Effect.forEach(inputs, save);",
  "for (const input of inputs) yield* Renamed.use((service) => service.update(owner, [input]));",
])("rejects per-item calls: %s", (body) => {
  const result = checkLint(fixture(body));

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-per-item-service-calls)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "gather arguments, then invoke the batch method once",
  );
});

it.each([
  "yield* notes.update(owner, inputs);",
  "yield* Effect.flatMap(Effect.succeed(inputs), (commands) => notes.update(owner, commands));",
  "const commands = inputs.map((input) => input.toUpperCase()); yield* notes.update(owner, commands);",
  "yield* Effect.forEach(inputs, (input) => Effect.succeed(input));",
  "inputs.map((notes) => notes.toString());",
  "for (const input of inputs) { const notes = { update: () => input }; notes.update(); }",
])("permits batching and unrelated pure bindings: %s", (body) => {
  const result = checkLint(fixture(body));

  expect(result.status, result.output).toBe(0);
});

it("rejects aliased repository calls without matching variable names", () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NotesLive.ts":
      'import { NoteRepository as Store } from "./NoteRepository.ts"; import { Effect } from "effect"; export const run = Effect.gen(function* () { const storage = yield* Store; for (const id of []) yield* storage.getNotes("owner", [id]); });',
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-per-item-service-calls)");
});

it("rejects state kept by a view", () => {
  const files = {
    "apps/web/src/browser/notes/NoteEditor.tsx": `
      import { createSignal } from "solid-js";
      export function NoteEditor() {
        const [title] = createSignal("");
        return <>{title()}</>;
      }`,
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-state)");
  expect(result.output).toContain("controller and expose a model or intent");
});

it("rejects browser APIs inside a workflow", () => {
  const files = {
    "apps/web/src/browser/notes/noteEditorWorkflow.ts":
      "export const requestId = () => crypto.randomUUID();",
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-globals");
  expect(result.output).toContain("pass them as event data");
});

it.each([
  ["a feature", "apps/web/src/browser/notes/NoteCard.tsx"],

  ["a route", "apps/web/src/routes/notes.tsx"],
])("rejects intrinsic elements in %s", (_, path) => {
  const files = { [path]: "export const View = () => <section>Notes</section>;" };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-intrinsic-elements)");
  expect(result.output).toContain("browser/shared-ui or browser/brand-ui");
});

it("rejects namespaced intrinsic elements outside the design system", () => {
  const files = {
    "apps/web/src/browser/notes/Mark.tsx": "export const Mark = () => <svg:rect />;",
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("repository(no-intrinsic-elements)");
  expect(result.output).toContain("browser/shared-ui or browser/brand-ui");
});

it("rejects rendering intrinsic elements through dynamic components outside the design system", () => {
  const files = {
    "apps/web/src/browser/notes/NoteCard.tsx":
      'import { dynamic } from "@solidjs/web"; export const Tag = dynamic(() => "div");',
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-imports");
});

it.each(["class", "className", "classList", "style"])(
  "rejects the %s prop on components outside the design system",
  (prop) => {
    const files = {
      "apps/web/src/browser/notes/NoteCard.tsx": `import { Button } from "#browser/shared-ui/Button.tsx"; export const View = () => <Button ${prop}={undefined}>Save</Button>;`,
      "apps/web/src/browser/shared-ui/Button.tsx":
        "export const Button = (props: { readonly children: string }) => <button>{props.children}</button>;",
    };

    const result = checkLint(files);

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("repository(no-style-props)");
    expect(result.output).toContain("variant, tone, size, or gap");
  },
);

it.each([
  ["shared-ui", "apps/web/src/browser/shared-ui/Panel.tsx"],
  ["brand-ui", "apps/web/src/browser/brand-ui/Panel.tsx"],
])("permits markup and layout classes in %s", (_, path) => {
  const files = {
    [path]:
      'export const Panel = (): import("@solidjs/web").JSX.Element => <section class="grid min-h-[150px] gap-[clamp(24px,4vw,50px)] [writing-mode:vertical-rl] text-control bg-panel duration-quick md:grid-cols-[minmax(0,1fr)_auto]">Panel</section>;',
  };

  const result = checkLint(files);

  expect(result.status, result.output).toBe(0);
});

it("permits document elements in the root route and stub markup in tests", () => {
  const files = {
    "apps/web/src/routes/__root.tsx":
      'export const Document = (): import("@solidjs/web").JSX.Element => <html lang="en"><head /><body /></html>;',
    "apps/web/src/browser/notes/NotesPage.browser.test.tsx":
      'export const Stub = (): import("@solidjs/web").JSX.Element => <p class="stub">Home page</p>;',
  };

  const result = checkLint(files);

  expect(result.status, result.output).toBe(0);
});

it.each([
  ["an arbitrary font size behind a variant", "max-sm:text-[3.3rem]"],
  ["an arbitrary colour", "bg-[#215cff]"],
  ["an arbitrary letter spacing", "tracking-[-0.02em]"],
  ["an arbitrary line height", "leading-[1.55]"],
  ["an arbitrary radius", "rounded-t-[6px]"],
  ["an arbitrary shadow", "shadow-[0_1px_2px_black]"],
  ["an arbitrary easing", "ease-[cubic-bezier(0.2,0,0,1)]"],
  ["a variable shorthand colour", "text-(--brand)"],
  ["an arbitrary typography property", "[font-size:2rem]"],
  ["a numeric duration", "duration-150"],
  ["an arbitrary delay", "hover:delay-[40ms]"],
])("rejects %s in design-system classes", (_, utility) => {
  const files = {
    "apps/web/src/browser/shared-ui/Panel.tsx": `const panelClass = "grid gap-2 ${utility}"; export const Panel = (): import("@solidjs/web").JSX.Element => <section class={panelClass}>Panel</section>;`,
    "apps/web/src/browser/brand-ui/Badge.tsx": `export const Badge = () => <span class={\`grid \${"x"} ${utility}\`}>Badge</span>;`,
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output.match(/repository\(token-values\)/g)).toHaveLength(2);
  expect(result.output).toContain("add a token to brand-theme.css and design-system.css");
});

it.each([
  "window.setTimeout",
  "globalThis.setInterval",
  'window["setTimeout"]',
  'globalThis["setTimeout"]',
  "self.setInterval",
])("rejects qualified browser timing through %s in an unlisted domain", (timer) => {
  const result = checkLint({
    "apps/web/src/browser/calendar/useCalendar.ts": `export const later = (): void => { ${timer}(() => {}, 10); };`,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("Timers obscure request completion");
});

it("permits timing helpers without dropping implicit-global protection", () => {
  const accepted = checkLint({
    "apps/web/src/browser/timing/delay.ts":
      "export const later = (): void => { window.setTimeout(() => {}, 10); };",
  });
  const rejected = checkLint({
    "apps/web/src/browser/timing/delay.ts": "export const value = event;",
  });

  expect(accepted.status, accepted.output).toBe(0);
  expect(rejected.status).toBeGreaterThan(0);
  expect(rejected.output).toContain("Implicit global event");
});

it.each(["Calendar.test.ts"])("rejects unbound instance methods in %s", (file) => {
  const result = checkLint({
    [`apps/web/src/browser/calendar/${file}`]:
      "class Calendar { value = 1; read(): number { return this.value; } } const calendar = new Calendar(); export const read = calendar.read;",
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("unbound-method");
});

it.each([
  "class Calendar { value = 1; read(): number { return this.value; } } const calendar = new Calendar(); export const read = (): number => calendar.read();",
  "class Calendar { read(this: void): number { return 1; } } const calendar = new Calendar(); export const read = calendar.read;",
])("permits receiver-safe test callbacks: %s", (source) => {
  const result = checkLint({ "apps/web/src/browser/calendar/Calendar.test.ts": source });

  expect(result.status, result.output).toBe(0);
});

it("permits schema and type pairing in an unlisted domain", () => {
  const result = checkLint({
    "packages/backend/src/contexts/calendar/Appointment.ts":
      'import { Schema } from "effect"; export const Appointment = Schema.String; export type Appointment = typeof Appointment.Type;',
  });

  expect(result.status, result.output).toBe(0);
});

it("retains SQL restrictions in shared UI", () => {
  const result = checkLint({
    "apps/web/src/browser/shared-ui/helper.ts":
      'import { sql } from "drizzle-orm"; export const value = sql;',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-imports");
});

it.each(["window.Date.now()", "globalThis.Math.random()", "globalThis.crypto.randomUUID()"])(
  "rejects qualified ambient workflow access through %s",
  (expression) => {
    const result = checkLint({
      "apps/web/src/browser/calendar/CalendarWorkflow.ts": `export const transition = () => ${expression};`,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("nondeterministic");
  },
);

it.each(["fetch", "globalThis.fetch"])(
  "rejects backend %s outside designated transports",
  (expression) => {
    const source = `export const response = ${expression}("https://client.example/metadata.json");`;

    const rejected = checkLint({
      "packages/backend/src/contexts/notes/internal/Foreign.ts": source,
    });
    const accepted = checkLint({
      "packages/backend/src/runtime/public-internet/transport/isolate/PublicInternetIsolate.ts":
        source,
    });

    expect(rejected.status).toBeGreaterThan(0);
    expect(rejected.output).toMatch(/no-restricted-(globals|properties)/u);
    expect(accepted.status, accepted.output).toBe(0);
  },
);

it("applies Effect lifecycle diagnostics to the actual server entry", () => {
  const result = checkLint({
    "apps/web/src/server.ts": `
      import { Effect } from "effect";
      export const example = Effect.gen(function* () {
        return new AbortController();
      });
    `,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("abort-controller-in-effect");
});

it("applies Effect lifecycle diagnostics inside compiler-erased RPC handlers", () => {
  const result = checkLint({
    "apps/web/src/server-functions/example.ts": `
      import { createServerFn } from "@tanstack/solid-start";
      import { Effect } from "effect";
      export const example = createServerFn().handler(() => Effect.runPromise(Effect.gen(function* () {
        const controller = new AbortController();
        yield* Effect.succeed(controller.signal);
        return "ready";
      })));
    `,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("abort-controller-in-effect");
});

it("accepts Effect-owned RPC programs inside erased handlers", () => {
  const result = checkLint({
    "apps/web/src/server-functions/example.ts": `
      import { createServerFn } from "@tanstack/solid-start";
      import { Effect } from "effect";
      export const example = createServerFn().handler(() => Effect.runPromise(Effect.succeed("ready")));
    `,
  });

  expect(result.status, result.output).toBe(0);
});

it("accepts Effect-owned cancellation in the server entry", () => {
  const result = checkLint({
    "apps/web/src/server.ts":
      'import { Effect } from "effect"; export const example = Effect.succeed("ready");',
  });

  expect(result.status, result.output).toBe(0);
});

it.each([
  "export const leaked = Schema.String;",
  'export const leaked = Effect.succeed("visible");',
  "const alias = Schema; export const leaked = alias.String;",
  "export function leaked() { return Schema.String; }",
  'export { Schema } from "effect";',
  'export * from "effect";',
  'import "effect";',
  'export const leaked = import("effect");',
  "const fake = { handler: (run: () => unknown) => run() }; export const leaked = fake.handler(() => Schema.String);",
  "export const leaked = createIsomorphicFn().client(() => Schema.String);",
])("rejects surviving server code: %s", (source) => {
  const result = checkLint({
    "apps/web/src/server-functions/inventory.ts": `
      import { createIsomorphicFn } from "@tanstack/solid-start";
      import { Schema, Effect } from "effect";
      ${source}
    `,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("erased-server-code");
  expect(result.output).toContain("compiler-erased validator/handler");
});

it.each(["drizzle-orm", "alchemy", "@lineupkeep/backend/inventory/internal/InventoryRepository"])(
  "rejects persistence and construction in server functions through %s",
  (source) => {
    const result = checkLint({
      "apps/web/src/server-functions/inventory.ts": `
        import { createServerFn } from "@tanstack/solid-start";
        import * as implementation from "${source}";
        export const reserve = createServerFn().handler(() => implementation);
      `,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("invoke public backend services");
  },
);

it.each(["`notes.${request.url}`", '"Notes.Create"', '"notes.create.private"'])(
  "rejects unbounded operation names: %s",
  (name) => {
    const result = checkLint({
      "apps/web/src/server/inventory.ts": `
        import { runBackend } from "./backendEntry";
        import { Effect } from "effect";
        export const reserve = (request: Request): Effect.Effect<void> => runBackend(request, ${name}, Effect.void);
      `,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("literal domain.action");
  },
);

it("rejects a dynamic operation through an aliased runner import", () => {
  const result = checkLint({
    "apps/web/src/server/inventory.ts": `
      import { runBackend as execute } from "./backendEntry";
      import { Effect } from "effect";
      export const reserve = (request: Request): Effect.Effect<void> => execute(request, request.url, Effect.void);
    `,
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("literal domain.action");
});

it("accepts a qualified literal operation without registering its domain", () => {
  const result = checkLint({
    "apps/web/src/server/backendEntry.ts": `
      import type { Effect } from "effect";
      export function runBackend<A>(request: Request, operation: string, program: Effect.Effect<A>): Effect.Effect<A> {
        void request; void operation; return program;
      }
    `,
    "apps/web/src/server/inventory.ts": `
      import { runBackend } from "./backendEntry";
      import { Effect } from "effect";
      export const reserve = (request: Request): Effect.Effect<void> => runBackend(request, "inventory.reserve_batch", Effect.void);
    `,
  });

  expect(result.status, result.output).toBe(0);
});

it.each(['export const maxItems = process.env["MAX_ITEMS"];'])(
  "rejects executable shared limits: %s",
  (source) => {
    const result = checkLint({
      "packages/backend/src/contexts/inventory/InventoryLimits.ts": source,
    });

    expect(result.status).toBeGreaterThan(0);
    expect(result.output).toContain("export only literal primitive constants");
  },
);

it.each([
  "packages/backend/src/contexts/notes/internal/NoteRepository.ts",
  "packages/backend/src/contexts/notes/internal/NotesDatabase.ts",

  "packages/backend/src/database/anotherBatch.ts",
])("rejects SQL expressions outside the single database utility module: %s", (path) => {
  const result = checkLint({ [path]: 'export { sql } from "drizzle-orm";' });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-imports");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain("structured, context-owned persistence");
});

it("permits parameterized SQL expressions only in the shared helper", () => {
  const result = checkLint({
    "packages/backend/src/database/dbUtilities.ts": 'export { sql } from "drizzle-orm";',
  });

  expect(result.status, result.output).toBe(0);
});

it("rejects raw execution even inside the SQL-expression exception", () => {
  const result = checkLint({
    "packages/backend/src/database/dbUtilities.ts":
      'declare const database: { execute(query: string): void }; database.execute("select 1");',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-properties");
});

it.each([
  'import { Layer as L } from "effect"; export const value = L.empty;',
  'import * as L from "effect/Layer"; export const value = L.empty;',
  'import { Effect as E } from "effect"; export const value = E.provide;',
  'import { provideService as supply } from "effect/Effect"; export const value = supply;',
  'import * as Fx from "effect"; export const value = Fx.Effect["provideService"];',
  'import { Effect } from "effect"; export const { provideContext: supply } = Effect;',
  'import { Effect } from "effect"; export const value = Effect.updateService;',
  'import { Effect } from "effect"; export const value = Effect.setContext;',
  'import { Effect } from "effect"; export const value = Effect.updateContext;',

  'import { UserId as Identity } from "@lineupkeep/backend/auth/User"; export const value = Identity;',
  'import { decodeUserId as identity } from "@lineupkeep/backend/auth/User"; export const value = identity;',
  'import { Schema } from "effect"; export const value = Schema.String.pipe(Schema.brand("UserId"));',
  'import { brand as identity } from "effect/Schema"; export const value = identity("UserId");',
])("rejects scenario service substitution or identity construction: %s", (source) => {
  const result = checkLint({
    "e2e/scenarios/services.ts": source,
    "e2e/scratch/task/helper.ts": source,
  });

  expect(result.status).not.toBe(0);
  expect(result.output).toContain("repository(production-services)");
  expect(result.output.replaceAll(/\s+/g, " ")).toContain(
    "call public backend services with the authenticated User",
  );
  expect(result.output).toContain("e2e/scenarios/services.ts");
  expect(result.output).toContain("e2e/scratch/task/helper.ts");
});

it("allows scenario programs to decode arguments and call services with their authenticated User", () => {
  const result = checkLint({
    "packages/backend/src/contexts/auth/AuthSession.ts":
      "export type AuthSessionUser = { readonly id: string };",
    "packages/backend/src/contexts/notes/Notes.ts": `import { Context } from "effect";
      import type { Effect } from "effect";
      export class Notes extends Context.Service<Notes, { readonly list: (userId: string) => Effect.Effect<ReadonlyArray<string>> }>()("@lineupkeep/backend/contexts/notes/Notes") {}`,
    "e2e/scenarios/services.ts": `import { Effect, Schema } from "effect";
      import { Notes } from "@lineupkeep/backend/notes/Notes";
      import type { AuthSessionUser } from "@lineupkeep/backend/auth/AuthSession";
      export const read = (user: AuthSessionUser, input: unknown): Effect.Effect<{ readonly owner: string; readonly title: string; readonly count: number }, Schema.SchemaError, Notes> => Effect.gen(function* () {
        const args = yield* Schema.decodeUnknownEffect(Schema.Struct({ title: Schema.String }))(input);
        const notes = yield* Notes;
        const saved = yield* notes.list(user.id);
        return { owner: user.id, title: args.title, count: saved.length };
      });`,
  });

  expect(result.status, result.output).toBe(0);
});

it.each([
  ["apps/web/src/shared/read.ts", "../server/notes/read"],

  ["apps/web/src/browser/shared-ui/read.tsx", "../../server/notes/read"],
])("rejects server re-exports through %s", (path, remote) => {
  const files = {
    [path]: `export { read } from "${remote}";`,
    "apps/web/src/server/notes/read.ts": "export const read = 1;",
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-imports");
});

it("rejects Effect re-exports through an otherwise unclassified web helper", () => {
  const files = { "apps/web/src/shared/effect.ts": 'export { Effect } from "effect";' };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-imports");
});

it("rejects direct query-client access in web modules", () => {
  const files = {
    "apps/web/src/browser/notes/NoteCard.tsx":
      'import { useQueryClient } from "@tanstack/solid-query"; export const NoteCard = useQueryClient;',
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-imports");
});

it("rejects timers in browser modules", () => {
  const files = {
    "apps/web/src/browser/notes/NoteCard.tsx":
      "export function later(run: () => void): void { setTimeout(run, 0); }",
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-globals");
  expect(result.output).toContain("wait on Query, router state, or onSettled");
});

it("rejects raw execution through a repository database handle", () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteRepository.ts":
      'declare const database: { execute(query: string): void }; database.execute("select 1");',
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-properties");
});

it("rejects table constructors imported by a repository", () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteRepository.ts":
      'export { pgTable } from "drizzle-orm/pg-core";',
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-imports");
});

it.each([
  ["an aliased SQL tag", 'export { sql as query } from "drizzle-orm";'],
  ["a SQL constructor", 'export { SQL } from "drizzle-orm";'],
  [
    "a namespace import",
    'import * as orm from "drizzle-orm"; export const query = orm.sql`select 1`;',
  ],
  ["a SQL implementation subpath", 'export { sql } from "drizzle-orm/sql/sql";'],
])("rejects %s in a repository", (_name, source) => {
  const files = { "packages/backend/src/contexts/notes/internal/NoteRepository.ts": source };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-imports");
});

it.each([
  [
    "literal-bracket execution",
    'declare const database: { execute(query: string): void }; database["execute"]("select 1");',
  ],
  [
    "destructured execution",
    'declare const database: { execute(query: string): void }; const { execute } = database; execute("select 1");',
  ],
  [
    "client access",
    "declare const database: { $client: object }; export const client = database.$client;",
  ],
  ["session access", "declare const database: { _: object }; export const session = database._;"],
  [
    "SQL representation access",
    "declare const query: { getSQL(): object }; export const sql = query.getSQL();",
  ],
])("rejects %s in a repository", (_name, source) => {
  const files = { "packages/backend/src/contexts/notes/internal/NoteRepository.ts": source };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-properties");
});

it("rejects handwritten SQL construction in a repository", () => {
  const files = {
    "packages/backend/src/contexts/notes/internal/NoteRepository.ts":
      'import { sql } from "drizzle-orm"; export const query = sql`select 1`;',
  };

  const result = checkLint(files);

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-imports");
});

function fixture(body: string): {
  "packages/backend/src/contexts/notes/Notes.ts": string;
  "apps/web/src/server/notes/fixture.ts": string;
} {
  return {
    "packages/backend/src/contexts/notes/Notes.ts":
      'import { Context } from "effect"; import type { Effect } from "effect"; export class Notes extends Context.Service<Notes, { readonly update: (owner: string, inputs: readonly string[]) => Effect.Effect<void> }>()("@lineupkeep/backend/contexts/notes/Notes") {}',
    "apps/web/src/server/notes/fixture.ts": `import { Notes as Renamed } from "@lineupkeep/backend/notes/Notes"; import { Effect } from "effect"; declare const inputs: string[]; declare const owner: string; export const run = Effect.gen(function* () { const notes = yield* Renamed; void owner; void notes; void inputs; ${body} });`,
  };
}
