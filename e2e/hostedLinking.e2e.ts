import { expect, signUp, test } from "./support";
import { captureCheckpoint } from "./verify/capture";

const hostedBrowserAvailable = (process.env["E2E_TARGET"] ?? "node") === "node";

test("signs in through the hosted browser or reports why it is unavailable", async ({
  page,
  newUser,
}, info) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));

  await signUp(page);
  await expect(page.getByRole("button", { name: "Connect Yahoo" })).toBeVisible();
  await page.getByRole("button", { name: "Connect Yahoo" }).click();

  if (!hostedBrowserAvailable) {
    await expect(
      page.getByText(
        "The private browser is not available here. Try again from the Lineupgrade app.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();
    expect(sockets).toEqual([]);
    return;
  }

  const signInView = page.getByRole("textbox", { name: "Yahoo sign-in browser" });
  await expect(signInView).toBeVisible();
  await expect(page.locator('img[alt="Yahoo sign-in page"]')).toBeVisible();
  await captureCheckpoint(page, info, "hosted-browser-open");

  const target = sockets[0];
  if (target === undefined) {
    throw new Error("The hosted browser did not open a WebSocket");
  }

  const other = await newUser();
  await signUp(other);
  const otherOutcome = await other.evaluate(
    (url) =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(url);
        socket.onopen = () => {
          socket.close();
          resolve("open");
        };
        socket.onerror = () => resolve("error");
        socket.onclose = () => resolve("closed");
      }),
    target,
  );
  expect(otherOutcome).not.toBe("open");

  await signInView.focus();
  await page.keyboard.type("hosted-user");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/teams$/u);
  await expect(page.getByText("Embedded Browser Team", { exact: true })).toBeVisible();
  await expect(page.getByText("Hosted Hockey Team", { exact: true })).toBeVisible();
  await captureCheckpoint(page, info, "hosted-teams");

  const replayOutcome = await page.evaluate(
    (url) =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(url);
        socket.onopen = () => {
          socket.close();
          resolve("open");
        };
        socket.onerror = () => resolve("error");
        socket.onclose = () => resolve("closed");
      }),
    target,
  );
  expect(replayOutcome).not.toBe("open");
});
