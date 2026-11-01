import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";

import { parseSync } from "oxc-parser";

const plugin = {
  meta: { name: "repository" },
  rules: {
    "workflow-tests": {
      create: (context: CommentsRuleContext) => ({
        Program: () => {
          if (!/(?:^|\/)(?!use[A-Z])[^/]+Workflow\.test\.ts$/u.test(context.filename)) {
            return;
          }
          const facts = testingFacts(context.filename, context.sourceCode.text);
          if (!facts.calls.has("exploreWorkflow") && !facts.calls.has("MachineTest.explore")) {
            sourceReport(
              context,
              0,
              "add exploration with invariants and complete transition coverage; use exploreWorkflow for clients or MachineTest.explore for backend machines.",
            );
          }
          if (
            !(facts.calls.has("fc.assert") && facts.calls.has("fc.property")) &&
            !facts.calls.has("MachineTest.scenarios")
          ) {
            sourceReport(
              context,
              0,
              "add property test coverage for generated event data; use fc.assert(fc.property(...)) for clients or MachineTest.scenarios with effect/Arbitrary for backend machines.",
            );
          }
        },
      }),
    },
    "codec-tests": {
      create: (context: CommentsRuleContext) => ({
        Program: () => {
          if (!context.filename.endsWith(".test.ts")) {
            return;
          }
          const facts = testingFacts(context.filename, context.sourceCode.text);
          if (facts.rowCodecImport && !facts.roundTrip) {
            sourceReport(
              context,
              0,
              `${context.filename}: add a round-trip test for the imported row codec; use Schema.encodeEffect and Schema.decodeEffect to cover every reachable state and generated value in this test file.`,
            );
          }
        },
      }),
    },
    "package-imports": {
      meta: { fixable: "code" },
      create: (context: PackageImportRuleContext) => {
        const check = (node: PackageImportNode): void => {
          if (typeof node.value !== "string" || !node.value.startsWith("../")) {
            return;
          }
          const replacement = packageImport(context.filename, node.value);
          context.report({
            node,
            message:
              replacement === undefined
                ? "Parent-relative imports obscure package ownership; add a matching package.json imports alias, or expose a cross-package module through its @lineupkeep package exports."
                : `Parent-relative imports obscure package ownership; use ${replacement} through package.json imports or package exports instead.`,
            ...(replacement === undefined
              ? {}
              : {
                  fix: (fixer: PackageImportFixer) =>
                    fixer.replaceText(node, JSON.stringify(replacement)),
                }),
          });
        };
        return {
          ImportDeclaration: (node: PackageImportNode) => {
            if (node.source) {
              check(node.source);
            }
          },
          ExportNamedDeclaration: (node: PackageImportNode) => {
            if (node.source) {
              check(node.source);
            }
          },
          ExportAllDeclaration: (node: PackageImportNode) => {
            if (node.source) {
              check(node.source);
            }
          },
          ImportExpression: (node: PackageImportNode) => {
            if (node.source) {
              check(node.source);
            }
          },
          TSImportType: (node: PackageImportNode) => {
            if (node.source) {
              check(node.source);
            }
          },
        };
      },
    },
    "no-test-internals": {
      create: (context: ServerFunctionRuleContext) => {
        const check = (
          node: ServerFunctionAstNode,
          property: unknown,
          object: ServerFunctionAstNode | undefined,
        ): void => {
          const owner = object?.property?.name ?? object?.property?.value;
          if (
            (typeof property === "string" && property.startsWith("toHaveBeenCalled")) ||
            (owner === "mock" && (property === "calls" || property === "results"))
          ) {
            context.report({
              node,
              message:
                "Mock history tests implementation details; assert observable outcomes instead, such as returned values, persisted state, or visible UI.",
            });
          }
          if (
            (property === "mock" || property === "doMock" || property === "hoisted") &&
            testImportRole(object, context, new Set()) === "api"
          ) {
            context.report({
              node,
              message:
                "Module mocks replace implementation imports; inject the dependency or use MSW at the external HTTP boundary instead.",
            });
          }
        };
        return {
          MemberExpression: (node: ServerFunctionAstNode) => {
            check(node, node.property?.name ?? node.property?.value, node.object);
          },
          Property: (node: ServerFunctionAstNode) => {
            if (node.parent?.type === "ObjectPattern") {
              check(node, node.key?.name ?? node.key?.value, node.parent.parent?.init ?? undefined);
            }
          },
        };
      },
    },
    "no-comments": {
      create: (context: CommentsRuleContext) => ({
        Program: () => {
          for (const offset of forbiddenComments(context.filename, context.sourceCode.text)) {
            context.report({
              loc: {
                start: context.sourceCode.getLocFromIndex(offset),
                end: context.sourceCode.getLocFromIndex(offset + 1),
              },
              message: commentPolicyMessage,
            });
          }
        },
      }),
    },
    "provider-scoring-vocabulary": {
      create: (context: CommentsRuleContext) => ({
        Program: () => {
          if (!isGenericSourceModule(context.filename)) {
            return;
          }
          for (const [term, offset] of occurrencesOf(
            context.sourceCode.text,
            providerScoringVocabulary,
          )) {
            sourceReport(
              context,
              offset,
              `\`${term}\` names how one provider constructs a score; keep scoring vocabulary inside the provider adapter and expose only a final score and opaque provenance.`,
            );
          }
        },
      }),
    },
    "provider-action-vocabulary": {
      create: (context: CommentsRuleContext) => ({
        Program: () => {
          if (!isGenericSourceModule(context.filename)) {
            return;
          }
          for (const [term, offset] of occurrencesOf(
            context.sourceCode.text,
            providerActionVocabulary,
          )) {
            sourceReport(
              context,
              offset,
              `\`${term}\` names one provider's native action; keep provider action names inside the adapter and describe the capability as a native lineup action.`,
            );
          }
        },
      }),
    },
    "provider-identity": {
      create: (context: CommentsRuleContext) => ({
        Program: () => {
          if (!isGenericSourceModule(context.filename)) {
            return;
          }
          if (
            providerIdentityOwners.some((owner) => normalizedPath(context.filename).includes(owner))
          ) {
            return;
          }
          for (const [term, offset] of occurrencesOf(context.sourceCode.text, ["Yahoo", "yahoo"])) {
            sourceReport(
              context,
              offset,
              `\`${term}\` names one provider; keep provider identity in its adapter, the composition root, or a keyed presentation declaration, and branch on ProviderKey instead.`,
            );
          }
        },
      }),
    },
    "provider-sport-rule": {
      create: (context: CommentsRuleContext) => ({
        Program: () => {
          if (!isGenericSourceModule(context.filename)) {
            return;
          }
          for (const match of context.sourceCode.text.matchAll(sportOrLeagueComparison)) {
            sourceReport(
              context,
              match.index,
              `\`${match[0]}\` makes a generic module decide by sport or league; read the fact the provider declares on ProviderShape.capabilities, or map every declared value exhaustively instead of comparing one.`,
            );
          }
        },
      }),
    },
    "provider-wire-vocabulary": {
      create: (context: CommentsRuleContext) => ({
        Program: () => {
          if (!isGenericSourceModule(context.filename)) {
            return;
          }
          for (const [term, offset] of occurrencesOf(
            context.sourceCode.text,
            providerWireVocabulary,
          )) {
            sourceReport(
              context,
              offset,
              `\`${term}\` is one provider's wire vocabulary; keep request paths, query fragments, and response keys inside the adapter and expose the fact as a declared capability or a named limitation.`,
            );
          }
        },
      }),
    },
    "no-intrinsic-elements": {
      create: (context: DesignSystemRuleContext) => ({
        JSXOpeningElement: (node: DesignSystemJSXOpeningElement) => {
          const name = designSystemIntrinsicName(node.name);
          if (name !== undefined) {
            context.report({
              node,
              message: `Rendering <${name}> outside the design system bypasses shared markup and accessibility; compose browser/shared-ui or browser/brand-ui components instead.`,
            });
          }
        },
      }),
    },
    "no-style-props": {
      create: (context: DesignSystemRuleContext) => ({
        JSXAttribute: (node: DesignSystemJSXAttribute) => {
          if (node.name.type === "JSXIdentifier" && designSystemStyleProps.has(node.name.name)) {
            context.report({
              node,
              message: `Passing \`${node.name.name}\` bypasses design-system tokens; use a named prop such as variant, tone, size, or gap on a shared-ui or brand-ui component.`,
            });
          }
        },
      }),
    },
    "token-values": {
      create: (context: DesignSystemRuleContext) => {
        const check = (node: DesignSystemAstNode, text: string): void => {
          for (const utility of designSystemUntokenizedUtilities(text)) {
            context.report({
              node,
              message: `\`${utility}\` bypasses the theme; add a token to brand-theme.css and design-system.css and use its utility.`,
            });
          }
        };
        return {
          Literal: (node: DesignSystemLiteral) => {
            if (typeof node.value === "string") {
              check(node, node.value);
            }
          },
          TemplateElement: (node: DesignSystemTemplateElement) => {
            check(node, node.value.cooked ?? node.value.raw);
          },
        };
      },
    },
    "no-state": {
      create: (context: ViewRuleContext) => ({
        ImportDeclaration: (node: ViewImportDeclaration) => {
          if (node.source.value !== "solid-js" || node.importKind === "type") {
            return;
          }
          for (const specifier of node.specifiers) {
            if (
              specifier.type === "ImportSpecifier" &&
              specifier.importKind !== "type" &&
              !viewRenderingImports.has(viewImportedName(specifier))
            ) {
              context.report({
                node: specifier,
                message: `\`${viewImportedName(specifier)}\` gives a view state or orchestration, which belongs to its controller; move it into a \`use*.ts\` controller and expose a model or intent.`,
              });
            }
          }
        },
      }),
    },
    "production-services": {
      create: (context: VerificationScenarioRuleContext) => {
        const brandNames = new Set<string>();
        const report = (node: VerificationScenarioAstNode): void =>
          context.report({
            node,
            message:
              "Supplying services, constructing runtimes, or manufacturing UserId values bypasses production proof; call public backend services with the authenticated User supplied to the scenario program.",
          });
        return {
          ImportDeclaration: (node: VerificationScenarioImportDeclaration) => {
            if (node.importKind === "type") {
              return;
            }
            const source = node.source.value;
            if (
              /effect\/(?:Layer|Context|ManagedRuntime|Runtime|testing)(?:\/|$)/u.test(source) ||
              /(?:runtime\/BackendRuntime|auth\/User)(?:\.ts)?$/u.test(source)
            ) {
              if (node.specifiers.some((specifier) => specifier.importKind !== "type")) {
                report(node);
              }
            }
            for (const specifier of node.specifiers) {
              if (specifier.importKind === "type") {
                continue;
              }
              const name =
                specifier.imported === undefined
                  ? ""
                  : verificationScenarioIdentifier(specifier.imported);
              if (
                verificationScenarioRestricted(name) ||
                name === "UserId" ||
                name === "decodeUserId"
              ) {
                report(specifier);
              }
              if (name === "brand" && source.startsWith("effect")) {
                brandNames.add(specifier.local.name);
              }
            }
          },
          MemberExpression: (node: VerificationScenarioAstNode) => {
            const name =
              node.property === undefined ? "" : verificationScenarioIdentifier(node.property);
            if (
              verificationScenarioRestricted(name) ||
              name === "UserId" ||
              name === "decodeUserId"
            ) {
              report(node);
            }
          },
          Property: (node: VerificationScenarioAstNode) => {
            if (
              node.parent?.type === "ObjectPattern" &&
              node.key !== undefined &&
              verificationScenarioRestricted(verificationScenarioIdentifier(node.key))
            ) {
              report(node);
            }
          },
          CallExpression: (node: VerificationScenarioAstNode) => {
            const callee = node.callee;
            const name =
              callee?.property === undefined
                ? callee === undefined
                  ? ""
                  : verificationScenarioIdentifier(callee)
                : verificationScenarioIdentifier(callee.property);
            if (
              (name === "brand" || brandNames.has(name)) &&
              node.arguments?.some((argument) => argument.value === "UserId") === true
            ) {
              report(node);
            }
          },
        };
      },
    },
    "no-spread-push": {
      create: (context: BatchFirstRuleContext) => ({
        CallExpression: (node: BatchFirstAstNode) => {
          const callee = node.callee;
          if (
            callee?.type === "MemberExpression" &&
            batchFirstIdentifier(callee.property) === "push" &&
            node.arguments?.some((argument) => argument.type === "SpreadElement") === true
          ) {
            context.report({
              node,
              message:
                "Spreading into push can exceed the JavaScript argument limit; append each value with a for-of loop instead.",
            });
          }
        },
      }),
    },
    "no-per-item-service-calls": {
      create(context: BatchFirstRuleContext) {
        const calls: Array<BatchFirstAstNode> = [];
        return {
          CallExpression(node: BatchFirstAstNode) {
            calls.push(node);
          },
          "Program:exit"() {
            const callbacks = new Set<BatchFirstAstNode>();
            for (const call of calls) {
              if (!batchFirstIsCollectionCall(call, context)) {
                continue;
              }
              for (const argument of call.arguments ?? []) {
                const callback = batchFirstFunctionValue(argument, context);
                if (callback !== undefined) {
                  callbacks.add(callback);
                }
              }
            }
            for (const call of calls) {
              if (!batchFirstServiceCall(call, context)) {
                continue;
              }
              let parent = call.parent;
              while (parent !== undefined && parent !== null) {
                if (batchFirstLoops.has(parent.type) || callbacks.has(parent)) {
                  context.report({
                    node: call,
                    message:
                      "Per-item repository or application-service calls cause N+1 IO; gather arguments, then invoke the batch method once. Keep bounded database chunking inside persistence.",
                  });
                  break;
                }
                parent = parent.parent;
              }
            }
          },
        };
      },
    },
    "literal-limits": {
      create(context: ServerFunctionRuleContext) {
        return {
          Program(node: ServerFunctionAstNode) {
            for (const statement of node.body ?? []) {
              const declaration = statement.declaration;
              if (
                statement.type !== "ExportNamedDeclaration" ||
                declaration?.kind !== "const" ||
                declaration.declarations?.every(
                  (item) =>
                    item.init?.type === "Literal" &&
                    ["number", "string", "boolean"].includes(typeof item.init.value),
                ) !== true
              ) {
                context.report({
                  node: statement,
                  message:
                    "Shared domain limits reach the browser; export only literal primitive constants here. Keep schemas, environment reads, and executable initialization in domain or server modules.",
                });
              }
            }
          },
        };
      },
    },
    "erased-server-code": {
      create(context: ServerFunctionRuleContext) {
        const imports: ServerFunctionAstNode[] = [];
        return {
          ImportDeclaration(node: ServerFunctionAstNode) {
            imports.push(node);
            if (node.specifiers?.length === 0 && node.importKind !== "type") {
              serverFunctionReject(node, context);
            }
          },
          ImportExpression(node: ServerFunctionAstNode) {
            if (!serverFunctionErased(node, context)) {
              serverFunctionReject(node, context);
            }
          },
          ExportAllDeclaration(node: ServerFunctionAstNode) {
            serverFunctionReject(node, context);
          },
          ExportNamedDeclaration(node: ServerFunctionAstNode) {
            if (node.source !== undefined && node.source !== null && node.exportKind !== "type") {
              serverFunctionReject(node, context);
            }
          },
          CallExpression(node: ServerFunctionAstNode) {
            if (
              !serverFunctionErased(node, context) &&
              !serverFunctionFrameworkChain(node, context)
            ) {
              serverFunctionReject(node, context);
            }
          },
          "Program:exit"() {
            for (const declaration of imports) {
              if (
                declaration.importKind === "type" ||
                !/(?:^effect(?:\/|$)|^@effect\/|^@lineupkeep\/backend|(?:^|\/)server(?:\/|$))/u.test(
                  declaration.source?.value ?? "",
                )
              ) {
                continue;
              }
              for (const specifier of declaration.specifiers ?? []) {
                if (specifier.importKind === "type" || specifier.local === undefined) {
                  continue;
                }
                const variable = serverFunctionResolve(specifier.local, context);
                for (const reference of variable?.references ?? []) {
                  if (
                    !serverFunctionTypePosition(reference.identifier) &&
                    !serverFunctionErased(reference.identifier, context)
                  ) {
                    serverFunctionReject(reference.identifier, context);
                  }
                }
              }
            }
          },
        };
      },
    },
    "literal-operation": {
      create(context: ServerFunctionRuleContext) {
        return {
          CallExpression(node: ServerFunctionAstNode) {
            const index = serverFunctionOperationIndex(node.callee, context, new Set());
            if (index === undefined) {
              return;
            }
            const argument = node.arguments?.[index];
            if (
              argument !== undefined &&
              (typeof argument.value !== "string" ||
                !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u.test(argument.value))
            ) {
              context.report({
                node: argument,
                message:
                  "Dynamic operation names leak input and create unbounded telemetry; pass a literal domain.action name in lower snake case, never request data.",
              });
            }
          },
        };
      },
    },
  },
};

export default plugin;

function packageImport(filename: string, specifier: string): string | undefined {
  const importer = importPackage(dirname(filename));
  let target = resolve(dirname(filename), specifier);
  if (!extname(target)) {
    const extension = [".ts", ".tsx", ".js"].find((extension) => existsSync(target + extension));
    if (extension !== undefined) {
      target += extension;
    }
  }
  const owner = importPackage(dirname(target));
  if (importer === undefined || owner === undefined) {
    return undefined;
  }
  const local = importer.directory === owner.directory;
  const mappings = owner.manifest[local ? "imports" : "exports"];
  if (!importRecord(mappings)) {
    return undefined;
  }
  const path = `./${relative(owner.directory, target)}`;
  const entries = Object.entries(mappings).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  for (const [alias, destination] of entries.sort(([, a], [, b]) => b.length - a.length)) {
    if (!destination.startsWith("./")) {
      continue;
    }
    const wildcard = destination.indexOf("*");
    const prefix = wildcard < 0 ? destination : destination.slice(0, wildcard);
    const suffix = wildcard < 0 ? "" : destination.slice(wildcard + 1);
    if (wildcard < 0 ? path === destination : path.startsWith(prefix) && path.endsWith(suffix)) {
      const matched =
        wildcard < 0
          ? alias
          : alias.replace("*", path.slice(prefix.length, path.length - suffix.length));
      return local ? matched : `${String(owner.manifest["name"])}${matched.slice(1)}`;
    }
  }
  return undefined;
}

function importRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function importPackage(directory: string): ImportPackage | undefined {
  for (let current = directory; ; current = dirname(current)) {
    const manifest = resolve(current, "package.json");
    if (existsSync(manifest)) {
      const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
      if (!importRecord(parsed)) {
        throw new Error(`Expected a package manifest object: ${manifest}`);
      }
      return { directory: current, manifest: parsed };
    }
    if (current === dirname(current)) {
      return undefined;
    }
  }
}

const designSystemStyleProps = new Set(["class", "className", "classList", "style"]);

const designSystemTokenUtility =
  /^(?:text|font|leading|tracking|bg|border(?:-[xytrblse])?|outline|ring(?:-offset)?|shadow|inset-shadow|drop-shadow|text-shadow|rounded(?:-[a-z]{1,2})?|ease|duration|delay|animate|decoration|fill|stroke|caret|accent|from|via|to|divide(?:-[xy])?)-[[(]/;

const designSystemNumericTiming = /^(?:duration|delay)-\d/;

const designSystemTokenProperty =
  /^(?:color|background(?:-color)?|font(?:-[a-z]+)?|line-height|letter-spacing|text-[a-z-]+|border(?:-[a-z]+)?-(?:radius|color)|border-radius|box-shadow|transition(?:-[a-z]+)?|animation(?:-[a-z]+)?|fill|stroke|outline-color|caret-color|accent-color)$/;

function designSystemUntokenizedUtilities(text: string): ReadonlyArray<string> {
  return text.split(/\s+/).filter((token) => {
    const utility = designSystemWithoutVariants(token).replace(/^[!-]+|!$/g, "");
    const property = /^\[([a-z-]+):/.exec(utility)?.[1];
    return property === undefined
      ? designSystemTokenUtility.test(utility) || designSystemNumericTiming.test(utility)
      : designSystemTokenProperty.test(property);
  });
}

function designSystemWithoutVariants(token: string): string {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index++) {
    const character = token[index];
    if (character === "[" || character === "(") {
      depth++;
    } else if (character === "]" || character === ")") {
      depth--;
    } else if (character === ":" && depth === 0) {
      start = index + 1;
    }
  }
  return token.slice(start);
}

function designSystemIntrinsicName(name: DesignSystemJSXElementName): string | undefined {
  if (name.type === "JSXNamespacedName") {
    return `${name.namespace.name}:${name.name.name}`;
  }
  return name.type === "JSXIdentifier" && /^[a-z]/.test(name.name) ? name.name : undefined;
}

const viewRenderingImports = new Set([
  "Errored",
  "For",
  "Loading",
  "Match",
  "Repeat",
  "Reveal",
  "Show",
  "Switch",
  "onSettled",
]);

function viewImportedName(specifier: ViewImportSpecifier): string {
  return specifier.imported.type === "Identifier"
    ? specifier.imported.name
    : specifier.imported.value;
}

function verificationScenarioRestricted(name: string): boolean {
  return /^(?:Layer|Context|ManagedRuntime|Runtime|provide.*|updateService.*|setContext|updateContext|withTracer|withLogger|run(?:Fork|Promise|Sync|Callback).*)$/u.test(
    name,
  );
}

function verificationScenarioIdentifier(node: VerificationScenarioAstNode): string {
  return node.name ?? (typeof node.value === "string" ? node.value : "");
}

function batchFirstServiceCall(call: BatchFirstAstNode, context: BatchFirstRuleContext): boolean {
  const callee = call.callee;
  if (callee?.type === "Identifier") {
    return batchFirstServiceBinding(callee, context, new Set());
  }
  if (callee?.type !== "MemberExpression" || callee.object === undefined) {
    return false;
  }
  if (
    batchFirstIdentifier(callee.property) === "use" &&
    batchFirstServiceTag(callee.object, context)
  ) {
    return true;
  }
  return batchFirstServiceBinding(callee.object, context, new Set());
}

function batchFirstServiceBinding(
  node: BatchFirstAstNode,
  context: BatchFirstRuleContext,
  visited: Set<BatchFirstAstNode>,
): boolean {
  if (visited.has(node)) {
    return false;
  }
  visited.add(node);
  const definition = batchFirstResolve(node, context)?.defs[0];
  if (definition === undefined) {
    return false;
  }
  if (definition.type === "Parameter") {
    let parent = node.parent;
    while (parent !== undefined && parent !== null) {
      if (parent.params?.includes(definition.name) === true) {
        const call = parent.parent;
        return (
          call?.type === "CallExpression" &&
          batchFirstIdentifier(call.callee?.property) === "use" &&
          call.callee?.object !== undefined &&
          batchFirstServiceTag(call.callee.object, context)
        );
      }
      parent = parent.parent;
    }
    return false;
  }
  const init = definition.node.init;
  if (init === undefined || init === null) {
    return false;
  }
  if (init.type === "YieldExpression" && init.argument !== undefined) {
    return batchFirstServiceTag(init.argument, context);
  }
  if (init.type === "Identifier") {
    return batchFirstServiceBinding(init, context, visited);
  }
  if (init.type === "MemberExpression" && init.object !== undefined) {
    return batchFirstServiceBinding(init.object, context, visited);
  }
  return false;
}

function batchFirstServiceTag(node: BatchFirstAstNode, context: BatchFirstRuleContext): boolean {
  const definition = batchFirstResolve(node, context)?.defs[0];
  if (definition?.type !== "ImportBinding") {
    return false;
  }
  const source = definition.parent?.source?.value;
  return (
    typeof source === "string" &&
    /(?:^|\/)[A-Z][^/]*$/u.test(source) &&
    !source.startsWith("effect/") &&
    !source.includes("/runtime/")
  );
}

function batchFirstResolve(
  node: BatchFirstAstNode,
  context: BatchFirstRuleContext,
): BatchFirstVariable | undefined {
  if (node.type !== "Identifier" || node.name === undefined) {
    return undefined;
  }
  let scope: BatchFirstScope | null = context.sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name);
    if (variable !== undefined) {
      return variable;
    }
    scope = scope.upper;
  }
  return undefined;
}

function batchFirstFunctionValue(
  node: BatchFirstAstNode,
  context: BatchFirstRuleContext,
): BatchFirstAstNode | undefined {
  if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
    return node;
  }
  const definition = batchFirstResolve(node, context)?.defs[0];
  if (definition?.node.type === "FunctionDeclaration") {
    return definition.node;
  }
  const init = definition?.node.init;
  return init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression"
    ? init
    : undefined;
}

function batchFirstIsCollectionCall(
  node: BatchFirstAstNode,
  context: BatchFirstRuleContext,
): boolean {
  const callee = node.callee;
  if (
    callee?.type !== "MemberExpression" ||
    !batchFirstCollections.has(batchFirstIdentifier(callee.property))
  ) {
    return false;
  }
  if (batchFirstIdentifier(callee.property) === "forEach") {
    return true;
  }
  const definition =
    callee.object === undefined ? undefined : batchFirstResolve(callee.object, context)?.defs[0];
  const source = definition?.parent?.source?.value;
  return !(
    source === "effect/Effect" ||
    (source === "effect" && batchFirstIdentifier(definition?.node.imported) === "Effect")
  );
}

function batchFirstIdentifier(node: BatchFirstAstNode | undefined): string {
  return node?.name ?? (typeof node?.value === "string" ? node.value : "");
}

const batchFirstLoops = new Set([
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

const batchFirstCollections = new Set(["forEach", "map", "flatMap"]);

function serverFunctionOperationIndex(
  node: ServerFunctionAstNode | undefined,
  context: ServerFunctionRuleContext,
  visited: Set<ServerFunctionAstNode>,
): number | undefined {
  if (node === undefined || visited.has(node)) {
    return undefined;
  }
  visited.add(node);
  if (
    node.type === "MemberExpression" &&
    node.object?.property?.name === "backend" &&
    (node.property?.name === "run" || node.property?.name === "runBackground")
  ) {
    return 2;
  }
  if (node.type === "Identifier") {
    const definition = serverFunctionResolve(node, context)?.defs[0];
    const source = definition?.parent?.source?.value ?? definition?.node.parent?.source?.value;
    if (
      source !== undefined &&
      /(?:^|\/)backendEntry(?:\.ts)?$/u.test(source) &&
      (definition?.node.imported?.name === "runBackend" ||
        definition?.node.imported?.name === "runUseCase")
    ) {
      return 1;
    }
    return serverFunctionOperationIndex(definition?.node.init ?? undefined, context, visited);
  }
  return undefined;
}

function serverFunctionReject(
  node: ServerFunctionAstNode,
  context: ServerFunctionRuleContext,
): void {
  context.report({
    node,
    message:
      "Server-function runtime code can reach the browser; use backend, Effect, and server values only inside compiler-erased validator/handler callbacks (or createIsomorphicFn.server), and keep initialization in server modules.",
  });
}

function serverFunctionErased(
  node: ServerFunctionAstNode,
  context: ServerFunctionRuleContext,
): boolean {
  let child = node;
  let parent = node.parent;
  while (parent !== undefined && parent !== null) {
    if (
      parent.type === "CallExpression" &&
      parent.arguments?.includes(child) === true &&
      serverFunctionFrameworkChain(parent, context)
    ) {
      const method = parent.callee?.property?.name;
      if (method === "validator" || method === "handler" || method === "server") {
        return true;
      }
    }
    child = parent;
    parent = parent.parent;
  }
  return false;
}

function serverFunctionFrameworkChain(
  node: ServerFunctionAstNode,
  context: ServerFunctionRuleContext,
): boolean {
  const callee = node.callee;
  if (callee?.type === "MemberExpression" && callee.object?.type === "CallExpression") {
    return serverFunctionFrameworkChain(callee.object, context);
  }
  if (callee?.type !== "Identifier") {
    return false;
  }
  const definition = serverFunctionResolve(callee, context)?.defs[0];
  return (
    (definition?.parent?.source?.value ?? definition?.node.parent?.source?.value) ===
      "@tanstack/solid-start" &&
    (definition?.node.imported?.name === "createServerFn" ||
      definition?.node.imported?.name === "createIsomorphicFn")
  );
}

function serverFunctionTypePosition(node: ServerFunctionAstNode): boolean {
  let parent = node.parent;
  while (parent !== undefined && parent !== null) {
    if (
      parent.type.startsWith("TS") &&
      parent.type !== "TSAsExpression" &&
      parent.type !== "TSSatisfiesExpression" &&
      parent.type !== "TSNonNullExpression"
    ) {
      return true;
    }
    if (
      parent.type.endsWith("Statement") ||
      parent.type.endsWith("Declaration") ||
      parent.type.endsWith("Expression")
    ) {
      return false;
    }
    parent = parent.parent;
  }
  return false;
}

function testImportRole(
  node: ServerFunctionAstNode | undefined,
  context: ServerFunctionRuleContext,
  visited: Set<ServerFunctionAstNode>,
): "api" | "namespace" | undefined {
  if (node === undefined || visited.has(node)) {
    return undefined;
  }
  visited.add(node);
  if (node.type === "MemberExpression") {
    const property = node.property?.name ?? node.property?.value;
    return (property === "vi" || property === "vitest") &&
      testImportRole(node.object, context, visited) === "namespace"
      ? "api"
      : undefined;
  }
  if (node.type !== "Identifier") {
    return undefined;
  }
  const definition = serverFunctionResolve(node, context)?.defs[0];
  if (definition === undefined) {
    return node.name === "vi" || node.name === "vitest" ? "api" : undefined;
  }
  const source = definition.parent?.source?.value ?? definition.node.parent?.source?.value;
  if (source === "vitest") {
    if (definition.node.type === "ImportNamespaceSpecifier") {
      return "namespace";
    }
    const imported = definition.node.imported?.name ?? definition.node.imported?.value;
    return imported === "vi" || imported === "vitest" ? "api" : undefined;
  }
  return testImportRole(definition.node.init ?? undefined, context, visited);
}

function serverFunctionResolve(
  node: ServerFunctionAstNode,
  context: ServerFunctionRuleContext,
): ServerFunctionVariable | undefined {
  let scope: ServerFunctionScope | null = context.sourceCode.getScope(node);
  while (scope !== null) {
    const variable = scope.set.get(node.name ?? "");
    if (variable !== undefined) {
      return variable;
    }
    scope = scope.upper;
  }
  return undefined;
}

const providerScoringVocabulary: ReadonlyArray<string> = [
  "communityStartRate",
  "community_start_rate",
  "community-start-rate",
  "publishesCommunityStartRate",
  "valueSourceLadder",
  "valueSource",
  "ValueSource",
  "startCutPreference",
  "cut-diamond",
  "percent-started",
  "scoringProfile",
  "ScoringProfile",
  "scorePeriod",
  "mean-points-per-period",
  "meanPointsPerPeriod",
  "observationWindow",
  "statBases",
  "isFlex",
  "ownershipComposite",
  "ownership-composite",
  "platinum",
];

const providerActionVocabulary: ReadonlyArray<string> = [
  "start-active",
  "start_active",
  "start active",
];

const providerWireVocabulary: ReadonlyArray<string> = [
  ";out=",
  ";sort_type=",
  "fantasysports",
  "fantasy/v2/",
];

const sportOrLeagueComparison =
  /\b(?:sport|league)\s*[!=]==?\s*["'](?:football|hockey|baseball|basketball|nfl|nhl|mlb|nba)["']/gu;

const providerScoringOwners = [
  "/contexts/connections/internal/yahoo/",
  "/contexts/connections/internal/provider-scoring/",
];

const providerIdentityOwners = [
  ...providerScoringOwners,
  "/runtime/ApplicationLayer.ts",
  "/contracts/connections/providerLabels.ts",
  "/hosted-browser/src/provider.ts",
];

function isGenericSourceModule(filename: string): boolean {
  const normalized = normalizedPath(filename);
  if (
    !normalized.includes("/src/") ||
    /\.test\.[cm]?[jt]sx?$/u.test(normalized) ||
    normalized.endsWith("Test.ts")
  ) {
    return false;
  }
  return !providerScoringOwners.some((owner) => normalized.includes(owner));
}

function normalizedPath(filename: string): string {
  return filename.replaceAll("\\", "/");
}

function occurrencesOf(
  source: string,
  terms: ReadonlyArray<string>,
): ReadonlyArray<readonly [string, number]> {
  const occurrences: Array<readonly [string, number]> = [];
  for (const term of terms) {
    let offset = source.indexOf(term);
    while (offset >= 0) {
      occurrences.push([term, offset]);
      offset = source.indexOf(term, offset + term.length);
    }
  }
  return occurrences;
}

function sourceReport(context: CommentsRuleContext, offset: number, message: string): void {
  context.report({
    loc: {
      start: context.sourceCode.getLocFromIndex(offset),
      end: context.sourceCode.getLocFromIndex(offset + 1),
    },
    message,
  });
}

function forbiddenComments(path: string, source: string): ReadonlyArray<number> {
  const normalized = path.replaceAll("\\", "/");
  if (
    normalized === "apps/web/src/routeTree.gen.ts" ||
    normalized.endsWith("/apps/web/src/routeTree.gen.ts")
  ) {
    return [];
  }
  const parsed = parseSync(path, source);
  if (parsed.errors.length > 0) {
    throw new Error(`Cannot check comments in ${path}: ${JSON.stringify(parsed.errors)}`);
  }
  const isViteDeclaration =
    normalized === "apps/web/src/assets.d.ts" || normalized.endsWith("/apps/web/src/assets.d.ts");
  return parsed.comments
    .filter(
      (comment) =>
        !(
          isViteDeclaration &&
          comment.type === "Line" &&
          comment.value.trim() === '/ <reference types="vite/client" />'
        ),
    )
    .map((comment) => comment.start);
}

function testingFacts(path: string, source: string): TestingFacts {
  const parsed = parseSync(path, source);
  if (parsed.errors.length > 0) {
    throw new Error(`Cannot check workflow testing in ${path}: ${JSON.stringify(parsed.errors)}`);
  }
  const calls = new Set<string>();
  let rowCodecImport = false;
  let roundTrip = false;
  visit(parsed.program, (node) => {
    if (
      node["type"] === "ImportDeclaration" &&
      node["importKind"] !== "type" &&
      /Tables(?:\.ts)?$/u.test(literal(node["source"]) ?? "") &&
      Array.isArray(node["specifiers"])
    ) {
      rowCodecImport ||= node["specifiers"].some(
        (specifier: unknown) =>
          isRecord(specifier) &&
          specifier["type"] === "ImportSpecifier" &&
          specifier["importKind"] !== "type" &&
          (name(specifier["imported"]) ?? "").endsWith("Row"),
      );
    }
    if (node["type"] !== "CallExpression") {
      return;
    }
    const called = callName(node["callee"]);
    calls.add(called);
    if (called === "it" || called === "it.effect") {
      const args = node["arguments"];
      if (Array.isArray(args) && /round.trips?/iu.test(literal(args[0]) ?? "")) {
        const roundTripCalls = new Set<string>();
        visit(args[1], (child) => {
          if (child["type"] === "CallExpression") {
            roundTripCalls.add(callName(child["callee"]));
          }
        });
        roundTrip =
          roundTrip ||
          (roundTripCalls.has("Schema.encodeEffect") && roundTripCalls.has("Schema.decodeEffect"));
      }
    }
  });
  return { calls, rowCodecImport, roundTrip };
}

function callName(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  return value["type"] === "MemberExpression"
    ? `${callName(value["object"])}.${name(value["property"]) ?? ""}`
    : (name(value) ?? "");
}

function visit(value: unknown, inspect: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visit(item, inspect);
    }
  } else if (isRecord(value)) {
    inspect(value);
    for (const child of Object.values(value)) {
      visit(child, inspect);
    }
  }
}

function literal(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value["value"] === "string") {
    return value["value"];
  }
  if (
    value["type"] === "TemplateLiteral" &&
    Array.isArray(value["quasis"]) &&
    value["quasis"].length === 1
  ) {
    const quasi: unknown = value["quasis"][0];
    if (
      isRecord(quasi) &&
      isRecord(quasi["value"]) &&
      typeof quasi["value"]["cooked"] === "string"
    ) {
      return quasi["value"]["cooked"];
    }
  }
  return undefined;
}

function name(value: unknown): string | undefined {
  return isRecord(value) && typeof value["name"] === "string" ? value["name"] : literal(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const commentPolicyMessage =
  "Comments drift from code; encode the knowledge in names, types, schemas, tests, or rules instead. Put external specification links in the owning skill or runbook.";

type TestingFacts = {
  readonly calls: ReadonlySet<string>;
  readonly rowCodecImport: boolean;
  readonly roundTrip: boolean;
};

type ImportPackage = {
  readonly directory: string;
  readonly manifest: Readonly<Record<string, unknown>>;
};

type PackageImportNode = {
  readonly value?: unknown;
  readonly source?: PackageImportNode;
  readonly argument?: PackageImportNode;
};

type PackageImportFixer = {
  readonly replaceText: (node: PackageImportNode, text: string) => unknown;
};

type PackageImportRuleContext = {
  readonly filename: string;
  readonly report: (descriptor: {
    readonly node: PackageImportNode;
    readonly message: string;
    readonly fix?: (fixer: PackageImportFixer) => unknown;
  }) => void;
};

type CommentsRuleContext = {
  readonly filename: string;
  readonly sourceCode: {
    readonly text: string;
    readonly getLocFromIndex: (offset: number) => CommentsPosition;
  };
  readonly report: (descriptor: {
    readonly loc: { readonly start: CommentsPosition; readonly end: CommentsPosition };
    readonly message: string;
  }) => void;
};

type CommentsPosition = { readonly line: number; readonly column: number };

type DesignSystemRuleContext = {
  readonly report: (descriptor: {
    readonly node: DesignSystemAstNode;
    readonly message: string;
  }) => void;
};

type DesignSystemAstNode = { readonly type: string };

type DesignSystemJSXIdentifier = { readonly type: "JSXIdentifier"; readonly name: string };

type DesignSystemJSXElementName =
  | DesignSystemJSXIdentifier
  | {
      readonly type: "JSXNamespacedName";
      readonly namespace: DesignSystemJSXIdentifier;
      readonly name: DesignSystemJSXIdentifier;
    }
  | { readonly type: "JSXMemberExpression" };

type DesignSystemJSXOpeningElement = DesignSystemAstNode & {
  readonly name: DesignSystemJSXElementName;
};

type DesignSystemJSXAttribute = DesignSystemAstNode & {
  readonly name: DesignSystemJSXIdentifier | { readonly type: "JSXNamespacedName" };
};

type DesignSystemLiteral = DesignSystemAstNode & { readonly value: unknown };

type DesignSystemTemplateElement = DesignSystemAstNode & {
  readonly value: { readonly raw: string; readonly cooked: string | null };
};

type ViewRuleContext = {
  readonly report: (descriptor: { readonly node: ViewAstNode; readonly message: string }) => void;
};

type ViewAstNode = { readonly type: string };

type ViewImportSpecifier = ViewAstNode & {
  readonly type: "ImportSpecifier";
  readonly importKind?: "type" | "value";
  readonly imported:
    | { readonly type: "Identifier"; readonly name: string }
    | { readonly type: "Literal"; readonly value: string };
};

type ViewImportDeclaration = ViewAstNode & {
  readonly importKind?: "type" | "value";
  readonly source: { readonly value: string };
  readonly specifiers: ReadonlyArray<
    ViewImportSpecifier | { readonly type: "ImportDefaultSpecifier" | "ImportNamespaceSpecifier" }
  >;
};

type VerificationScenarioRuleContext = {
  readonly report: (descriptor: {
    readonly node: VerificationScenarioAstNode;
    readonly message: string;
  }) => void;
};

type VerificationScenarioImportDeclaration = VerificationScenarioAstNode & {
  readonly importKind?: string;
  readonly source: { readonly value: string };
  readonly specifiers: ReadonlyArray<
    VerificationScenarioAstNode & {
      readonly importKind?: string;
      readonly imported?: VerificationScenarioAstNode;
      readonly local: { readonly name: string };
    }
  >;
};

type VerificationScenarioAstNode = {
  readonly type: string;
  readonly name?: string;
  readonly value?: unknown;
  readonly parent?: VerificationScenarioAstNode;
  readonly property?: VerificationScenarioAstNode;
  readonly key?: VerificationScenarioAstNode;
  readonly callee?: VerificationScenarioAstNode;
  readonly arguments?: ReadonlyArray<VerificationScenarioAstNode>;
};

type BatchFirstRuleContext = {
  readonly sourceCode: { readonly getScope: (node: BatchFirstAstNode) => BatchFirstScope };
  readonly report: (descriptor: {
    readonly node: BatchFirstAstNode;
    readonly message: string;
  }) => void;
};

type BatchFirstScope = {
  readonly upper: BatchFirstScope | null;
  readonly set: ReadonlyMap<string, BatchFirstVariable>;
};

type BatchFirstVariable = {
  readonly defs: ReadonlyArray<{
    readonly type: string;
    readonly node: BatchFirstAstNode;
    readonly name: BatchFirstAstNode;
    readonly parent?: BatchFirstAstNode;
  }>;
};

type BatchFirstAstNode = {
  readonly type: string;
  readonly name?: string;
  readonly value?: unknown;
  readonly parent?: BatchFirstAstNode | null;
  readonly callee?: BatchFirstAstNode;
  readonly object?: BatchFirstAstNode;
  readonly property?: BatchFirstAstNode;
  readonly init?: BatchFirstAstNode | null;
  readonly imported?: BatchFirstAstNode;
  readonly argument?: BatchFirstAstNode;
  readonly arguments?: ReadonlyArray<BatchFirstAstNode>;
  readonly params?: ReadonlyArray<BatchFirstAstNode>;
  readonly source?: { readonly value: string };
};

type ServerFunctionRuleContext = {
  readonly sourceCode: { readonly getScope: (node: ServerFunctionAstNode) => ServerFunctionScope };
  readonly report: (descriptor: {
    readonly node: ServerFunctionAstNode;
    readonly message: string;
  }) => void;
};

type ServerFunctionScope = {
  readonly upper: ServerFunctionScope | null;
  readonly set: ReadonlyMap<string, ServerFunctionVariable>;
};

type ServerFunctionVariable = {
  readonly defs: ReadonlyArray<{
    readonly node: ServerFunctionAstNode;
    readonly parent?: ServerFunctionAstNode;
  }>;
  readonly references: ReadonlyArray<{ readonly identifier: ServerFunctionAstNode }>;
};

type ServerFunctionAstNode = {
  readonly type: string;
  readonly name?: string;
  readonly value?: unknown;
  readonly parent?: ServerFunctionAstNode | null;
  readonly callee?: ServerFunctionAstNode;
  readonly object?: ServerFunctionAstNode;
  readonly property?: ServerFunctionAstNode;
  readonly imported?: ServerFunctionAstNode;
  readonly key?: ServerFunctionAstNode;
  readonly body?: ReadonlyArray<ServerFunctionAstNode>;
  readonly declaration?: ServerFunctionAstNode | null;
  readonly declarations?: ReadonlyArray<ServerFunctionAstNode>;
  readonly kind?: string;
  readonly init?: ServerFunctionAstNode | null;
  readonly local?: ServerFunctionAstNode;
  readonly arguments?: ReadonlyArray<ServerFunctionAstNode>;
  readonly source?: { readonly value: string } | null;
  readonly specifiers?: ReadonlyArray<ServerFunctionAstNode>;
  readonly importKind?: string;
  readonly exportKind?: string;
};
