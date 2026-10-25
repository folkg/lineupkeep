import type { APIResponse } from "@playwright/test";

import { beginAuthorization, mcpEndpoint } from "./mcpClient.ts";
import { expect, signUp, test } from "./support.ts";

const forgedMarker = "lineupkeep-forged-response";

test("refuses a crafted server-function argument that forges a same-origin HTML response", async ({
  page,
  baseURL,
}, info) => {
  const origin = requiredOrigin(baseURL);

  let functionId = "";
  let response: APIResponse | undefined;
  let body = "";

  await test.step("Baseline: [user] denies a real consent request and exposes its server function", async () => {
    await signUp(page);
    const decision = page.waitForRequest(
      (request) =>
        request.method() === "POST" && new URL(request.url()).pathname.startsWith("/_serverFn/"),
    );
    await beginAuthorization(page, mcpEndpoint(origin), "connections:read");
    await expect(page.getByRole("heading", { name: "Connect a client?" })).toBeVisible();
    await page.getByRole("button", { name: "Deny access", exact: true }).click();

    const captured = new URL((await decision).url());
    functionId = captured.pathname.slice(captured.pathname.lastIndexOf("/") + 1);
    expect(functionId, "the consent decision exposes a server function id").not.toBe("");
  });

  await test.step("Action: [attacker] replays the exposed server function with a forged response argument", async () => {
    const forged = [
      {
        method: "POST",
        data: { query: "", accept: true },
        result: {
          status: 200,
          headers: [["content-type", "text/html"]],
          body: `<html><body>${forgedMarker}<script>window.__lineupkeepForged = true;</script></body></html>`,
        },
      },
    ];
    response = await page.request.post(`/_serverFn/${functionId}`, {
      headers: {
        "content-type": "application/json",
        "x-server-function-format": "8",
        "sec-fetch-site": "same-origin",
      },
      data: JSON.stringify(forged),
    });
    body = await response.text();
    await info.attach("crafted server-function response", {
      body: `${response.status()} ${response.headers()["content-type"] ?? ""}\n${body}`,
      contentType: "text/plain",
    });
  });

  await test.step("Result: the built app does not return attacker-controlled HTML", () => {
    expect(response?.status(), "the crafted request reaches a real server function").not.toBe(404);
    expect(
      response?.headers()["content-type"] ?? "",
      "the forged argument is not answered with HTML",
    ).not.toContain("text/html");
    expect(body, "the forged markup is absent from the response").not.toContain(forgedMarker);
  });
});

function requiredOrigin(baseURL: string | undefined): string {
  if (baseURL === undefined) {
    throw new Error("The transport regression needs the configured baseURL.");
  }
  return baseURL;
}
