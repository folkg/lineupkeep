import { randomUUID } from "node:crypto";

import { test, type Page, expect } from "@playwright/test";
import { Schema } from "effect";

import { pagePersona } from "./persona.ts";
import { CallObserver } from "./verify/performance.ts";
import { serviceCallName, ServiceCallJson, type ServicePhase } from "./verify/serviceEvidence.ts";
export function serviceOperations(
  origin: string,
  signIn: (persona: string) => Promise<ServiceIdentity>,
  observer = new CallObserver(),
): ServiceSetup {
  let sequence = 0;
  const run =
    (phase: ServicePhase): Scenario =>
    (identity, description, program, arguments_ = {}) => {
      const persona =
        identity instanceof ServiceIdentity ? identity.persona : pagePersona(identity);
      return test.step(`${phase} (services) [${persona}]: ${description}`, async (step) => {
        const request = await actingRequest(identity, origin);
        return observer.call("services", `${phase}: ${program}`, async (traceparent) => {
          const response = await fetch(new URL("/__verification/services", origin), {
            method: "POST",
            headers: {
              cookie: request.headers.get("cookie") ?? "",
              "content-type": "application/json",
              traceparent,
            },
            body: JSON.stringify({ phase, persona, description, program, arguments: arguments_ }),
          });
          if (response.headers.get("content-type")?.includes("application/json") !== true) {
            throw new Error(`Service invocation failed (${response.status}).`);
          }
          const text = await response.text();
          const evidence = Schema.decodeUnknownSync(ServiceCallJson)(text);
          await step.attach(serviceCallName(++sequence, description), {
            body: text,
            contentType: "application/json",
          });
          if (evidence.outcome.status === "failed") {
            throw new Error(`${evidence.outcome.failure.tag}: ${evidence.outcome.failure.message}`);
          }
          if ("note" in evidence.outcome) {
            throw new Error(evidence.outcome.note);
          }
          return evidence.outcome.result;
        });
      });
    };
  return { signIn, arrange: run("Setup"), exercise: run("Action"), inspect: run("Read") };
}

async function actingRequest(identity: Page | ServiceIdentity, origin: string): Promise<Request> {
  if (identity instanceof ServiceIdentity) {
    return identity.request();
  }
  const cookies = await identity.context().cookies(origin);
  return new Request(origin, {
    headers: { cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; ") },
  });
}

export class ServiceIdentity {
  static signIn(
    origin: string,
    persona: string,
    clientAddress: string,
    deliveredCode: (email: string, send: () => Promise<void>) => Promise<string>,
  ): Promise<ServiceIdentity> {
    return test.step(`Setup (services) [${persona}]: sign in headlessly`, async () => {
      const email = `service-${randomUUID()}@example.com`;
      const headers = {
        "content-type": "application/json",
        origin,
        "x-forwarded-for": clientAddress,
      };
      const otp = await deliveredCode(email, async () => {
        const sent = await fetch(new URL("/api/auth/email-otp/send-verification-otp", origin), {
          method: "POST",
          headers,
          body: JSON.stringify({ email, type: "sign-in" }),
        });
        expect(sent.status, "request an emailed sign-in code").toBe(200);
      });
      const verified = await fetch(new URL("/api/auth/sign-in/email-otp", origin), {
        method: "POST",
        headers,
        body: JSON.stringify({ email, otp }),
      });
      expect(verified.status, "verify the delivered sign-in code").toBe(200);
      const cookie = verified.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      if (cookie === "") {
        throw new Error("Headless sign-in returned no session cookies.");
      }

      return new ServiceIdentity(
        persona,
        () => new Request(origin, { headers: { cookie, "x-forwarded-for": clientAddress } }),
      );
    });
  }

  request(): Request {
    return this.#request();
  }

  readonly persona: string;
  #request: () => Request;

  private constructor(persona: string, request: () => Request) {
    this.persona = persona;
    this.#request = request;
  }
}

export type ServiceSetup = {
  readonly signIn: (persona: string) => Promise<ServiceIdentity>;
  readonly arrange: Scenario;
  readonly exercise: Scenario;
  readonly inspect: Scenario;
};

type Scenario = (
  identity: Page | ServiceIdentity,
  description: string,
  program: string,
  arguments_?: Schema.Json,
) => Promise<unknown>;
