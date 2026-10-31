import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { offlineAccess } from "@lineupkeep/backend/auth/AuthorizationScopes";
import { connectionScopes } from "@lineupkeep/backend/connections/ConnectionScopes";
import { feedbackScopes } from "@lineupkeep/backend/feedback/FeedbackScopes";
import {
  advertisedScopes,
  onboardingScopes,
  resourceScopes,
} from "@lineupkeep/backend/runtime/ApplicationScopes";
import { Option, Schema } from "effect";

import { mcpClient, mcpEndpoint } from "./mcpClient.ts";
import { redactEvidence } from "./verify/redaction.ts";

export type ConsentCheck = "includes-feedback-manage" | "excludes-feedback-manage";

export type AuthorizedClient = {
  readonly client: McpClient;
  readonly granted: ReadonlyArray<string>;
};

type LocalAcceptance = {
  readonly mode: "local";
  readonly origin: string;
  readonly requestedScopes: ReadonlyArray<string>;
  readonly team: string;
  readonly register: () => Promise<Registration>;
  readonly authorize: (
    clientId: string,
    scopes: ReadonlyArray<string>,
    consent: ConsentCheck,
  ) => Promise<AuthorizedClient>;
};

type TokenAcceptance = {
  readonly mode: "token";
  readonly origin: string;
  readonly tokenEnvironment: string;
  readonly token: string;
  readonly granted: ReadonlyArray<string>;
};

export type Acceptance = LocalAcceptance | TokenAcceptance;

export async function runAcceptance(
  acceptance: Acceptance,
  report: AcceptanceReport,
): Promise<void> {
  report.metadata(await inspectMetadata(acceptance.origin));
  report.baseline(await inspectBaseline(acceptance.origin));
  if (acceptance.mode === "local") {
    await acceptLocal(acceptance, report);
  } else {
    await acceptToken(acceptance, report);
  }
}

export function requestedScopeNames(raw: string | undefined): ReadonlyArray<string> {
  if (raw === undefined) {
    return advertisedScopeNames();
  }
  const names = [...new Set(raw.split(/[\s,]+/u).filter(Boolean))];
  if (names.length === 0) {
    throw new Error("--scopes named no scopes.");
  }
  const unknown = names.filter((name) => !advertisedScopes.some((scope) => scope.name === name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown scopes: ${unknown.join(", ")}. Advertised: ${advertisedScopeNames().join(" ")}.`,
    );
  }
  return names;
}

export function tokenGrantedScopes(token: string): ReadonlyArray<string> {
  const payload = token.split(".")[1];
  if (payload === undefined) {
    throw new Error("The provided token is not a JWT; its granted scopes cannot be read.");
  }
  const claims = Schema.decodeUnknownOption(TokenClaims)(
    parseJson(Buffer.from(payload, "base64url").toString("utf8")),
  );
  if (Option.isNone(claims) || claims.value.scope === undefined) {
    throw new Error("The provided token has no scope claim; its granted scopes cannot be read.");
  }
  return claims.value.scope.split(" ").filter(Boolean);
}

export class AcceptanceReport {
  readonly mode: "local" | "token";
  readonly origin: string;
  readonly findings: Array<string> = [];
  readonly notes: Array<string> = [];
  readonly startedAt = new Date().toISOString();
  metadataInspection: MetadataInspection | undefined;
  baselineInspection: BaselineInspection | undefined;
  registrations: ReadonlyArray<RegistrationReport> = [];
  tokenEnvironment: string | undefined;
  providedGrant: ReadonlyArray<string> | undefined;
  requestedGrant: ReadonlyArray<string> | undefined;
  restrictedGrant: ReadonlyArray<string> | undefined;
  requestedRows: ReadonlyArray<ToolRow> = [];
  restrictedRows: ReadonlyArray<ToolRow> = [];
  tokenRows: ReadonlyArray<ToolRow> = [];
  feedbackCase: FeedbackCase | undefined;

  constructor(acceptance: { readonly mode: "local" | "token"; readonly origin: string }) {
    this.mode = acceptance.mode;
    this.origin = acceptance.origin;
  }

  addFinding(message: string): void {
    this.findings.push(message);
  }

  note(message: string): void {
    this.notes.push(message);
  }

  fatal(error: unknown): void {
    this.addFinding(describeError(error));
  }

  metadata(inspection: MetadataInspection): void {
    this.metadataInspection = inspection;
    const authorization = inspection.authorizationScopes;
    const resource = inspection.resourceScopes;
    for (const scope of advertisedScopeNames()) {
      if (!authorization.includes(scope)) {
        this.addFinding(`Authorization-server metadata does not advertise ${scope}.`);
      }
    }
    for (const scope of authorization) {
      if (!advertisedScopeNames().includes(scope)) {
        this.addFinding(
          `Authorization-server metadata advertises ${scope}, which this checkout does not.`,
        );
      }
    }
    for (const scope of resourceScopeNames()) {
      if (!resource.includes(scope)) {
        this.addFinding(`Protected-resource metadata does not advertise ${scope}.`);
      }
    }
    for (const scope of resource) {
      if (!resourceScopeNames().includes(scope)) {
        this.addFinding(
          `Protected-resource metadata advertises ${scope}, which this checkout does not.`,
        );
      }
    }
    if (!authorization.includes(offlineAccess.name)) {
      this.addFinding(`Authorization-server metadata does not advertise ${offlineAccess.name}.`);
    }
    if (resource.includes(offlineAccess.name)) {
      this.addFinding(
        `Protected-resource metadata advertises ${offlineAccess.name}; the documented contract omits it there.`,
      );
    }
    for (const scope of authorization.filter((name) => !resource.includes(name))) {
      if (scope !== offlineAccess.name) {
        this.addFinding(
          `Authorization-server metadata alone advertises ${scope}; only ${offlineAccess.name} may differ.`,
        );
      }
    }
    for (const scope of resource.filter((name) => !authorization.includes(name))) {
      this.addFinding(
        `Protected-resource metadata alone advertises ${scope}; it is missing from authorization-server metadata.`,
      );
    }
  }

  baseline(inspection: BaselineInspection): void {
    this.baselineInspection = inspection;
    if (inspection.status !== 401) {
      this.addFinding(`An unauthenticated tools/list returned ${inspection.status}, not 401.`);
    }
    if (inspection.scope === undefined) {
      this.addFinding("An unauthenticated tools/list challenge named no scope.");
    }
    if (!inspection.matches) {
      this.addFinding(
        `An unauthenticated tools/list asked for ${inspection.scope ?? "no scope"}; the minimal baseline is ${inspection.expected.join(" ")}.`,
      );
    }
    if (inspection.asksForFullSet) {
      this.addFinding("An unauthenticated tools/list asked for the full advertised scope set.");
    }
  }

  register(registrations: ReadonlyArray<RegistrationReport>): void {
    this.registrations = registrations;
    for (const registration of registrations) {
      const granted = registration.scope.split(" ").filter(Boolean);
      if (!sameSet(granted, advertisedScopeNames())) {
        this.addFinding(
          `Dynamic client registration for the ${registration.grant} grant granted ${registration.scope === "" ? "no scopes" : registration.scope}; expected the full advertised set ${advertisedScopeNames().join(" ")}.`,
        );
      }
    }
  }

  providedToken(environment: string, granted: ReadonlyArray<string>): void {
    this.tokenEnvironment = environment;
    this.providedGrant = granted;
    for (const scope of granted.filter((name) => !advertisedScopeNames().includes(name))) {
      this.addFinding(`The provided token holds ${scope}, which this checkout does not advertise.`);
    }
    const missing = advertisedScopeNames().filter((name) => !granted.includes(name));
    if (missing.length === 0) {
      this.note("The provided token holds the full advertised set.");
    } else {
      this.note(`The provided token does not hold ${missing.join(", ")}.`);
    }
  }

  toolTable(
    requestedRows: ReadonlyArray<ToolRow>,
    restrictedRows: ReadonlyArray<ToolRow>,
    requestedGrant: ReadonlyArray<string>,
    restrictedGrant: ReadonlyArray<string>,
  ): void {
    this.requestedRows = requestedRows;
    this.restrictedRows = restrictedRows;
    this.requestedGrant = requestedGrant;
    this.restrictedGrant = restrictedGrant;
  }

  tokenTable(rows: ReadonlyArray<ToolRow>, granted: ReadonlyArray<string>): void {
    this.tokenRows = rows;
    this.providedGrant = granted;
  }

  feedback(caseResult: FeedbackCase): void {
    this.feedbackCase = caseResult;
    if (caseResult.status === "failed") {
      this.addFinding(`The ${feedbackScopes.manage.name} case failed: ${caseResult.detail}`);
    }
  }

  summary(): ReportSummary {
    const findings = this.findings.map(redactText);
    return {
      ok: findings.length === 0,
      mode: this.mode,
      origin: this.origin,
      findings,
      generatedAt: new Date().toISOString(),
    };
  }

  failureMessage(): string {
    const findings = this.findings.map(redactText);
    return findings.length === 0 ? "No findings." : findings.join("\n");
  }

  markdown(): string {
    const lines: Array<string> = [];
    const summary = this.summary();
    lines.push(`# MCP acceptance: ${this.origin}`, "");
    lines.push(
      `Mode: ${this.mode === "local" ? "local flow (discovery, DCR, PKCE, browser sign-in, consent)" : "provided access token"}`,
      `Started: ${this.startedAt}`,
      `Result: ${summary.ok ? "PASS" : `FAIL (${summary.findings.length} findings)`}`,
      "",
      "## Metadata consistency",
      "",
    );
    if (this.metadataInspection === undefined) {
      lines.push("Not inspected.", "");
    } else {
      const authorizationScopes = this.metadataInspection.authorizationScopes;
      const resourceScopes = this.metadataInspection.resourceScopes;
      lines.push(
        `- Protected-resource metadata: ${this.metadataInspection.metadataUrl}`,
        `- Authorization-server metadata: ${this.metadataInspection.authorizationUrl}`,
        `- Authorization-server scopes: ${codeList(authorizationScopes)}`,
        `- Protected-resource scopes: ${codeList(resourceScopes)}`,
        `- Only authorization server: ${codeList(authorizationScopes.filter((scope) => !resourceScopes.includes(scope)))}`,
        `- Only protected resource: ${codeList(resourceScopes.filter((scope) => !authorizationScopes.includes(scope)))}`,
        "",
      );
    }
    lines.push("## 401 challenge baseline", "");
    if (this.baselineInspection === undefined) {
      lines.push("Not inspected.", "");
    } else {
      lines.push(
        `- Unauthenticated \`tools/list\` challenge: ${this.baselineInspection.scope === undefined ? "none" : codeList(this.baselineInspection.scope.split(" ").filter(Boolean))}`,
        `- Minimal baseline: ${codeList(this.baselineInspection.expected)}`,
        `- Matches the minimal baseline: ${this.baselineInspection.matches ? "yes" : "no"}`,
        `- Requests the full advertised set: ${this.baselineInspection.asksForFullSet ? "yes" : "no"}`,
        "",
      );
    }
    if (this.mode === "local") {
      lines.push("## Dynamic client registration", "");
      if (this.registrations.length === 0) {
        lines.push("Not inspected.", "");
      } else {
        for (const registration of this.registrations) {
          lines.push(
            `- ${registration.grant}: public client registered without a secret; granted scopes: ${codeList(registration.scope.split(" ").filter(Boolean))}`,
          );
        }
        lines.push("");
      }
    } else {
      lines.push("## Provided token", "");
      lines.push(
        `- Source: environment variable \`${this.tokenEnvironment ?? "unknown"}\``,
        `- Granted scopes: ${codeList(this.providedGrant ?? [])}`,
        "",
      );
    }
    lines.push("## Tool scope table", "");
    if (this.mode === "local") {
      const header = sameSet(this.requestedGrant ?? [], advertisedScopeNames())
        ? "Full grant"
        : "Requested grant";
      lines.push(
        `Requested grant: ${codeList(this.requestedGrant ?? [])}`,
        `Restricted grant: ${codeList(this.restrictedGrant ?? [])}`,
        "",
        `| Tool | Required scope | ${header} | Restricted grant |`,
        "| --- | --- | --- | --- |",
      );
      const restricted = new Map(this.restrictedRows.map((row) => [row.tool, row.result]));
      const requested = new Map(this.requestedRows.map((row) => [row.tool, row]));
      const names = new Set([
        ...this.requestedRows.map((row) => row.tool),
        ...this.restrictedRows.map((row) => row.tool),
      ]);
      for (const name of names) {
        const row = requested.get(name);
        const scope = row?.scope ?? this.restrictedRows.find((entry) => entry.tool === name)?.scope;
        lines.push(
          `| \`${name}\` | \`${scope ?? "unknown"}\` | ${row?.result ?? "not inspected"} | ${restricted.get(name) ?? "not inspected"} |`,
        );
      }
    } else {
      lines.push(
        `Provided grant: ${codeList(this.providedGrant ?? [])}`,
        "",
        "| Tool | Required scope | Provided grant |",
        "| --- | --- | --- |",
      );
      for (const row of this.tokenRows) {
        lines.push(`| \`${row.tool}\` | \`${row.scope}\` | ${row.result} |`);
      }
    }
    lines.push("", `## The \`${feedbackScopes.manage.name}\` case`, "");
    if (this.feedbackCase === undefined) {
      lines.push("Not inspected.", "");
    } else {
      lines.push(`Result: ${this.feedbackCase.status}`, "");
      for (const step of this.feedbackCase.steps) {
        lines.push(`- ${step}`);
      }
      if (this.feedbackCase.detail !== undefined) {
        lines.push("", this.feedbackCase.detail);
      }
      lines.push("");
    }
    lines.push("## Findings", "");
    if (summary.findings.length === 0) {
      lines.push("None.", "");
    } else {
      for (const finding of summary.findings) {
        lines.push(`- ${finding}`);
      }
      lines.push("");
    }
    lines.push("## Notes and limitations", "");
    for (const note of this.notes) {
      lines.push(`- ${note}`);
    }
    lines.push(
      this.mode === "local"
        ? "- The local fixture has no league, roster, or transaction data. A tool result shown as `authorized (...)` passed the scope check and then returned a domain-level error; it is not a scope finding."
        : "- Provided-token mode does not exercise dynamic client registration, consent, or PKCE; it proves the deployed origin's metadata, 401 baseline, and per-tool enforcement for this token's scopes.",
      this.mode === "local"
        ? "- This does not prove a real provider's data, a hosted client's compatibility, or a deployed origin's configuration."
        : "- Write tools are called only with empty arguments, so a 400 proves the scope check passed without a write. A scope the token does not hold is reported as refused, not tested for success.",
      "- It cannot prove a client's own registration metadata or the `scope` it requested. If a client fails after consent, capture its authorization `error` and `error_description` and its client metadata document.",
      "",
    );
    return `${lines.join("\n")}\n`;
  }
}

export async function writeAcceptanceReport(report: AcceptanceReport, path: string): Promise<void> {
  await writeFile(path, redactText(report.markdown()));
  await writeFile(join(dirname(path), "report.json"), JSON.stringify(report.summary(), null, 2));
}

async function acceptLocal(acceptance: LocalAcceptance, report: AcceptanceReport): Promise<void> {
  const requestedRegistration = await acceptance.register();
  const requested = await acceptance.authorize(
    requestedRegistration.clientId,
    acceptance.requestedScopes,
    acceptance.requestedScopes.includes(feedbackScopes.manage.name)
      ? "includes-feedback-manage"
      : "excludes-feedback-manage",
  );
  const restrictedRegistration = await acceptance.register();
  const restricted = await acceptance.authorize(
    restrictedRegistration.clientId,
    onboardingScopeNames(),
    "excludes-feedback-manage",
  );
  const feedbackRegistration = await acceptance.register();
  const feedback = await acceptance.authorize(
    feedbackRegistration.clientId,
    feedbackGrantNames(),
    "includes-feedback-manage",
  );
  report.register([
    { grant: "requested", scope: requestedRegistration.scope },
    { grant: "restricted", scope: restrictedRegistration.scope },
    { grant: "feedback", scope: feedbackRegistration.scope },
  ]);
  const tools = await inspectTools(acceptance.origin, requested.client, report);
  const requestedRows = await runToolTable(
    requested.client,
    tools,
    requested.granted,
    "requested",
    acceptance.team,
    report,
  );
  const restrictedRows = await runToolTable(
    restricted.client,
    tools,
    restricted.granted,
    "restricted",
    acceptance.team,
    report,
  );
  report.toolTable(requestedRows, restrictedRows, requested.granted, restricted.granted);
  report.feedback(await runLocalFeedbackCase(feedback.client, report));
}

async function acceptToken(acceptance: TokenAcceptance, report: AcceptanceReport): Promise<void> {
  report.providedToken(acceptance.tokenEnvironment, acceptance.granted);
  const client = mcpClient(mcpEndpoint(acceptance.origin), acceptance.token);
  const tools = await inspectTools(acceptance.origin, client, report);
  const rows = await runToolTable(client, tools, acceptance.granted, "token", randomUUID(), report);
  report.tokenTable(rows, acceptance.granted);
  report.feedback(await runTokenFeedbackCase(client, acceptance.granted));
}

async function inspectMetadata(origin: string): Promise<MetadataInspection> {
  const challenge = await mcpClient(mcpEndpoint(origin)).request("tools/list");
  const metadataUrl = resourceMetadataUrl(challenge.headers.get("www-authenticate"));
  if (challenge.status !== 401 || metadataUrl === undefined) {
    throw new Error(
      `MCP discovery requires a 401 resource_metadata challenge; got ${challenge.status}.`,
    );
  }
  const resourceResponse = await fetch(metadataUrl);
  if (!resourceResponse.ok) {
    throw new Error(`Protected-resource metadata returned ${resourceResponse.status}.`);
  }
  const resource = Schema.decodeUnknownSync(ResourceMetadata)(await resourceResponse.json());
  const issuer = resource.authorization_servers[0];
  if (issuer === undefined) {
    throw new Error("Protected-resource metadata names no authorization server.");
  }
  const authorizationUrl = new URL(
    `/.well-known/oauth-authorization-server${new URL(issuer).pathname}`,
    issuer,
  );
  const authorizationResponse = await fetch(authorizationUrl);
  if (!authorizationResponse.ok) {
    throw new Error(`Authorization-server metadata returned ${authorizationResponse.status}.`);
  }
  const authorization = Schema.decodeUnknownSync(AuthorizationMetadata)(
    await authorizationResponse.json(),
  );
  return {
    metadataUrl,
    authorizationUrl: authorizationUrl.href,
    authorizationScopes: authorization.scopes_supported ?? [],
    resourceScopes: resource.scopes_supported ?? [],
  };
}

async function inspectBaseline(origin: string): Promise<BaselineInspection> {
  const response = await mcpClient(mcpEndpoint(origin)).request("tools/list");
  const scope = challengeScope(response.headers.get("www-authenticate"));
  const actual = scope === undefined ? [] : scope.split(" ").filter(Boolean);
  const expected = onboardingScopeNames();
  return {
    status: response.status,
    scope,
    expected,
    matches: sameSet(actual, expected),
    asksForFullSet: sameSet(actual, advertisedScopeNames()),
  };
}

async function inspectTools(
  origin: string,
  client: McpClient,
  report: AcceptanceReport,
): Promise<ReadonlyArray<ToolScope>> {
  const response = await client.request("tools/list");
  if (response.status !== 200) {
    throw new Error(
      `tools/list returned ${response.status}.${response.status === 401 ? " The access token was not accepted." : ""}`,
    );
  }
  const listed = Schema.decodeUnknownSync(ToolsResponse)(await response.json()).result.tools;
  const anonymous = mcpClient(mcpEndpoint(origin));
  const tools: Array<ToolScope> = [];
  for (const tool of listed) {
    const challenge = await anonymous.request("tools/call", {
      name: tool.name,
      arguments: {},
    });
    const scope = challengeScope(challenge.headers.get("www-authenticate"));
    if (challenge.status !== 401) {
      report.addFinding(
        `Tool ${tool.name}: an unauthenticated call returned ${challenge.status} instead of 401.`,
      );
      continue;
    }
    const names = scope === undefined ? [] : scope.split(" ").filter(Boolean);
    const required = names[0];
    if (names.length !== 1 || required === undefined) {
      report.addFinding(
        `Tool ${tool.name}: the 401 challenge named ${scope === undefined ? "no scope" : `"${scope}"`} instead of exactly one scope.`,
      );
      continue;
    }
    if (!resourceScopes.some((candidate) => candidate.name === required)) {
      report.addFinding(
        `Tool ${tool.name}: required scope ${required} is not in the advertised resource set.`,
      );
    }
    tools.push({
      name: tool.name,
      scope: required,
      readOnly: tool.annotations?.readOnlyHint ?? false,
    });
  }
  const declared = new Set(tools.map((tool) => tool.scope));
  for (const scope of resourceScopeNames()) {
    if (!declared.has(scope)) {
      report.addFinding(
        `No tool requires ${scope}, which the protected-resource metadata advertises.`,
      );
    }
  }
  return tools;
}

async function runToolTable(
  client: McpClient,
  tools: ReadonlyArray<ToolScope>,
  granted: ReadonlyArray<string>,
  mode: "requested" | "restricted" | "token",
  team: string,
  report: AcceptanceReport,
): Promise<ReadonlyArray<ToolRow>> {
  const rows: Array<ToolRow> = [];
  for (const tool of tools) {
    const held = granted.includes(tool.scope);
    const writeSuppressed = mode === "token" && !tool.readOnly;
    const expectation: Expectation = held
      ? { kind: "authorized", writeSuppressed }
      : { kind: "refused", scope: tool.scope };
    const arguments_ = held && !writeSuppressed ? callArguments(tool.name, team) : {};
    const result = await callTool(client, tool.name, arguments_);
    const evaluation = evaluate(result, expectation);
    if (!evaluation.pass) {
      report.addFinding(`${modeLabel(mode)}: ${tool.name} (${tool.scope}) ${evaluation.finding}`);
    }
    rows.push({ tool: tool.name, scope: tool.scope, result: evaluation.label });
  }
  return rows;
}

async function runLocalFeedbackCase(
  client: McpClient,
  report: AcceptanceReport,
): Promise<FeedbackCase> {
  const title = `MCP acceptance feedback ${randomUUID()}`;
  const submitted = await callTool(client, "submit_feedback", {
    kind: "friction",
    title,
    body: "The acceptance command checks the feedback scope boundary.",
    context: { tool: "mcp:accept", surface: "mcp", client: "mcp:accept" },
  });
  const submittedId = feedbackId(submitted.structuredContent);
  const steps: Array<string> = [];
  steps.push(
    `submit_feedback: ${submitted.status === 200 && submitted.isError !== true ? "ok" : `failed (${submitted.status}${submitted.code === undefined ? "" : ` ${submitted.code}`})`}`,
  );
  if (submittedId === undefined) {
    report.addFinding("The feedback:manage case could not submit a report to triage.");
    return {
      status: "failed",
      steps,
      detail: "No feedback id was returned by submit_feedback.",
    };
  }
  const listed = await callTool(client, "list_feedback", { statuses: ["open"], limit: 5 });
  const listedOk =
    listed.status === 200 &&
    listed.isError !== true &&
    JSON.stringify(listed.structuredContent).includes(submittedId);
  steps.push(
    `list_feedback: ${listedOk ? "ok, the submitted report is listed" : `failed (${listed.status}${listed.code === undefined ? "" : ` ${listed.code}`})`}`,
  );
  const acknowledged = await callTool(client, "triage_feedback", {
    feedback: [{ feedback: submittedId, action: "acknowledge" }],
  });
  const acknowledgedStatus = triageStatus(acknowledged.structuredContent);
  const acknowledgedOk =
    acknowledged.status === 200 &&
    acknowledged.isError !== true &&
    acknowledgedStatus === "acknowledged";
  steps.push(
    `triage_feedback acknowledge: ${acknowledgedOk ? "changed to acknowledged" : `failed (${acknowledged.status}${acknowledged.code === undefined ? "" : ` ${acknowledged.code}`})`}`,
  );
  const resolved = await callTool(client, "triage_feedback", {
    feedback: [
      {
        feedback: submittedId,
        action: "resolve",
        note: "MCP acceptance closed this report.",
      },
    ],
  });
  const resolvedStatus = triageStatus(resolved.structuredContent);
  const resolvedOk =
    resolved.status === 200 && resolved.isError !== true && resolvedStatus === "resolved";
  steps.push(
    `triage_feedback resolve: ${resolvedOk ? "changed to resolved" : `failed (${resolved.status}${resolved.code === undefined ? "" : ` ${resolved.code}`})`}`,
  );
  const passed = listedOk && acknowledgedOk && resolvedOk;
  return {
    status: passed ? "passed" : "failed",
    steps,
    ...(passed
      ? {}
      : { detail: "At least one feedback step did not match the published contract." }),
  };
}

async function runTokenFeedbackCase(
  client: McpClient,
  granted: ReadonlyArray<string>,
): Promise<FeedbackCase> {
  const manage = feedbackScopes.manage.name;
  const read = connectionScopes.read.name;
  if (!granted.includes(manage)) {
    return {
      status: "not-tested",
      steps: [`The provided token does not hold ${manage}.`],
    };
  }
  if (!granted.includes(read)) {
    return {
      status: "not-tested",
      steps: [`The provided token holds ${manage} but not ${read}, so list_feedback cannot run.`],
    };
  }
  const listed = await callTool(client, "list_feedback", { limit: 5 });
  const listedOk = listed.status === 200 && listed.isError !== true;
  const triaged = await callTool(client, "triage_feedback", {
    feedback: [{ feedback: randomUUID(), action: "acknowledge" }],
  });
  const triagedOutcome = triageOutcome(triaged.structuredContent);
  const triagedOk =
    triaged.status === 200 && triaged.isError !== true && triagedOutcome === "not_found";
  return {
    status: listedOk && triagedOk ? "passed" : "failed",
    steps: [
      `list_feedback: ${listedOk ? "ok" : `failed (${listed.status}${listed.code === undefined ? "" : ` ${listed.code}`})`}`,
      `triage_feedback with a random report id: ${triagedOk ? "authorized, returned not_found, no write" : `failed (${triaged.status}${triaged.code === undefined ? "" : ` ${triaged.code}`})`}`,
    ],
    ...(listedOk && triagedOk
      ? {}
      : { detail: "The token holds feedback:manage but the feedback tools did not accept it." }),
  };
}

async function callTool(
  client: McpClient,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<ToolCallResult> {
  const response = await client.request("tools/call", { name, arguments: arguments_ });
  const body: unknown = await response.json().catch(() => undefined);
  if (response.status !== 200) {
    const error = Schema.decodeUnknownOption(ErrorBody)(body);
    return {
      status: response.status,
      scope: Option.isSome(error) ? error.value.scope : undefined,
      challengeScope: challengeScope(response.headers.get("www-authenticate")),
      error: Option.isSome(error) ? error.value.error : undefined,
      description: Option.isSome(error) ? error.value.error_description : undefined,
    };
  }
  const result = Schema.decodeUnknownSync(ToolResponse)(body).result;
  return {
    status: 200,
    isError: result.isError === true,
    code: result.isError === true ? toolErrorCode(result.content) : undefined,
    structuredContent: result.structuredContent,
  };
}

function evaluate(result: ToolCallResult, expectation: Expectation): Evaluation {
  if (expectation.kind === "authorized") {
    if (expectation.writeSuppressed) {
      if (result.status === 400) {
        return { pass: true, label: "scope accepted (no write)" };
      }
      return {
        pass: false,
        label: `FAIL ${result.status}`,
        finding: `returned ${result.status} instead of 400 for a suppressed write.`,
      };
    }
    if (result.status === 200) {
      return {
        pass: true,
        label: result.isError === true ? `authorized (${result.code ?? "tool error"})` : "ok",
      };
    }
    return {
      pass: false,
      label: `FAIL ${result.status}`,
      finding: describeFailure(result, "the tool to run"),
    };
  }
  if (result.status === 403) {
    const bodyMatches = result.scope === expectation.scope;
    const headerMatches = result.challengeScope === expectation.scope;
    if (bodyMatches && headerMatches) {
      return { pass: true, label: `refused ${expectation.scope} (expected)` };
    }
    return {
      pass: false,
      label: `FAIL 403 ${result.scope ?? result.challengeScope ?? "unknown"}`,
      finding: `was refused for ${result.scope ?? "no body scope"} with challenge ${result.challengeScope ?? "no header scope"}; expected ${expectation.scope} in both.`,
    };
  }
  if (result.status === 200) {
    return {
      pass: false,
      label: `FAIL authorized without ${expectation.scope}`,
      finding: `ran without holding ${expectation.scope}.`,
    };
  }
  return {
    pass: false,
    label: `FAIL ${result.status}`,
    finding: describeFailure(result, `403 ${expectation.scope}`),
  };
}

function callArguments(tool: string, team: string): Record<string, unknown> {
  switch (tool) {
    case "list_connections":
    case "list_teams":
    case "get_lineup_runs":
      return {};
    case "get_calendar":
    case "get_league":
    case "get_team_summary":
    case "get_transactions":
      return { team };
    case "get_rosters":
      return { team, period: { week: 1 } };
    case "search_players":
      return { team };
    case "get_players":
      return { team, players: [randomUUID()] };
    case "get_matchups":
      return { team, period: { week: 1 } };
    case "generate_transaction_review_links":
      return {
        team: randomUUID(),
        intents: [{ kind: "add", add: "r1.acceptance" }],
      };
    case "propose_transactions":
      return {
        items: [
          {
            team: randomUUID(),
            kind: "drop",
            adds: [],
            drops: ["r1.acceptance"],
            reason: "The acceptance command checks the proposal scope boundary.",
          },
        ],
      };
    case "get_transaction_proposal_set":
    case "revalidate_transaction_proposal_set":
      return { set: randomUUID() };
    case "get_pending_trade_offers":
      return { team: randomUUID() };
    case "set_lineup":
      return {
        requestId: randomUUID(),
        teams: [{ team: randomUUID(), period: { coverage: "week", week: 1 } }],
      };
    case "set_team_automation":
      return { teams: [{ team: randomUUID(), action: "enable" }] };
    case "submit_feedback":
      return {
        kind: "friction",
        title: `MCP acceptance ${randomUUID()}`,
        body: "The acceptance command checks the feedback scope boundary.",
        context: { tool: "mcp:accept", surface: "mcp", client: "mcp:accept" },
      };
    case "list_feedback":
      return { limit: 5 };
    case "triage_feedback":
      return { feedback: [{ feedback: randomUUID(), action: "acknowledge" }] };
    default:
      throw new Error(`No harmless call is defined for tool ${tool}.`);
  }
}

function toolErrorCode(content: ReadonlyArray<Record<string, unknown>>): string | undefined {
  for (const item of content) {
    const text = item["text"];
    if (typeof text !== "string") {
      continue;
    }
    const failure = Schema.decodeUnknownOption(ToolFailure)(parseJson(text));
    if (Option.isSome(failure)) {
      return failure.value.code;
    }
  }
  return undefined;
}

function feedbackId(content: Record<string, unknown> | undefined): string | undefined {
  const decoded = Schema.decodeUnknownOption(SubmittedFeedback)(content);
  return Option.isSome(decoded) ? decoded.value.feedback.id : undefined;
}

function triageStatus(content: Record<string, unknown> | undefined): string | undefined {
  const decoded = Schema.decodeUnknownOption(TriageResults)(content);
  if (Option.isNone(decoded)) {
    return undefined;
  }
  const feedback = decoded.value.results[0]?.feedback;
  return typeof feedback === "object" ? feedback.status : undefined;
}

function triageOutcome(content: Record<string, unknown> | undefined): string | undefined {
  const decoded = Schema.decodeUnknownOption(TriageResults)(content);
  return Option.isSome(decoded) ? decoded.value.results[0]?.outcome : undefined;
}

function describeFailure(result: ToolCallResult, expected: string): string {
  const detail = result.description ?? result.error ?? result.code ?? "no detail";
  return `returned ${result.status} instead of ${expected} (${detail}).`;
}

function modeLabel(mode: "requested" | "restricted" | "token"): string {
  switch (mode) {
    case "requested":
      return "requested grant";
    case "restricted":
      return "restricted grant";
    case "token":
      return "provided grant";
  }
}

function challengeScope(header: string | null): string | undefined {
  return header === null ? undefined : /\bscope="([^"]*)"/iu.exec(header)?.[1];
}

function resourceMetadataUrl(header: string | null): string | undefined {
  return header === null ? undefined : /\bresource_metadata="([^"]+)"/iu.exec(header)?.[1];
}

function advertisedScopeNames(): ReadonlyArray<string> {
  return advertisedScopes.map((scope) => scope.name);
}

function resourceScopeNames(): ReadonlyArray<string> {
  return resourceScopes.map((scope) => scope.name);
}

function onboardingScopeNames(): ReadonlyArray<string> {
  return onboardingScopes.map((scope) => scope.name);
}

function feedbackGrantNames(): ReadonlyArray<string> {
  return [...new Set([...onboardingScopeNames(), feedbackScopes.manage.name])];
}

function sameSet(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function codeList(values: ReadonlyArray<string>): string {
  return values.length === 0 ? "none" : values.map((value) => `\`${value}\``).join(", ");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function redactText(text: string): string {
  const redacted = redactEvidence(text);
  const withoutKnown = typeof redacted === "string" ? redacted : text;
  return withoutKnown
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+\b/giu, "Bearer [REDACTED]");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type McpClient = ReturnType<typeof mcpClient>;

type MetadataInspection = {
  readonly metadataUrl: string;
  readonly authorizationUrl: string;
  readonly authorizationScopes: ReadonlyArray<string>;
  readonly resourceScopes: ReadonlyArray<string>;
};

type BaselineInspection = {
  readonly status: number;
  readonly scope: string | undefined;
  readonly expected: ReadonlyArray<string>;
  readonly matches: boolean;
  readonly asksForFullSet: boolean;
};

type Registration = {
  readonly clientId: string;
  readonly scope: string;
};

type RegistrationReport = {
  readonly grant: string;
  readonly scope: string;
};

type ToolScope = {
  readonly name: string;
  readonly scope: string;
  readonly readOnly: boolean;
};

type ToolRow = {
  readonly tool: string;
  readonly scope: string;
  readonly result: string;
};

type ToolCallResult = {
  readonly status: number;
  readonly isError?: boolean;
  readonly code?: string;
  readonly scope?: string;
  readonly challengeScope?: string;
  readonly error?: string;
  readonly description?: string;
  readonly structuredContent?: Record<string, unknown>;
};

type Expectation =
  | { readonly kind: "authorized"; readonly writeSuppressed: boolean }
  | { readonly kind: "refused"; readonly scope: string };

type Evaluation = {
  readonly pass: boolean;
  readonly label: string;
  readonly finding?: string;
};

type FeedbackCase = {
  readonly status: "passed" | "failed" | "not-tested";
  readonly steps: ReadonlyArray<string>;
  readonly detail?: string;
};

export type ReportSummary = {
  readonly ok: boolean;
  readonly mode: "local" | "token";
  readonly origin: string;
  readonly findings: ReadonlyArray<string>;
  readonly generatedAt: string;
};

const ResourceMetadata = Schema.Struct({
  resource: Schema.String,
  authorization_servers: Schema.Array(Schema.String),
  scopes_supported: Schema.optional(Schema.Array(Schema.String)),
});

const AuthorizationMetadata = Schema.Struct({
  issuer: Schema.optional(Schema.String),
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
  scopes_supported: Schema.optional(Schema.Array(Schema.String)),
});

const ToolsResponse = Schema.Struct({
  result: Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        annotations: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              readOnlyHint: Schema.optional(Schema.Boolean),
            }),
          ),
        ),
      }),
    ),
  }),
});

const ToolResponse = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    content: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
    structuredContent: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
});

const ErrorBody = Schema.Struct({
  error: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
});

const ToolFailure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
});

const SubmittedFeedback = Schema.Struct({
  feedback: Schema.Struct({ id: Schema.String }),
});

const TriageResults = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      outcome: Schema.String,
      feedback: Schema.Union([Schema.Struct({ status: Schema.String }), Schema.String]),
    }),
  ),
});

const TokenClaims = Schema.Struct({
  scope: Schema.optional(Schema.String),
});
