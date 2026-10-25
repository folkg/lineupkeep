import { render } from "@solidjs/web";
import { createSignal } from "solid-js";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { TextField } from "./TextField";
import type { TextFieldProps } from "./TextField";

it("announces errors and marks the control invalid", async () => {
  using _app = renderTextField({
    description: "Use the address associated with your account.",
    error: "Enter an email address.",
    label: "Email",
  });
  const input = page.getByLabelText("Email");

  await expect.element(input).toHaveAttribute("aria-invalid", "true");
  const describedBy = input.element().getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  for (const id of describedBy?.split(" ") ?? []) {
    expect(document.getElementById(id)).not.toBeNull();
  }
  await expect
    .element(page.getByText("Use the address associated with your account."))
    .toBeVisible();
  await expect.element(page.getByRole("alert")).toHaveTextContent("Enter an email address.");
});

it("keeps the focused control and its value when an error appears and clears", async () => {
  const [value, setValue] = createSignal("");
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <TextField
        error={value().length === 0 ? "Add a title." : undefined}
        label="Title"
        value={value()}
        onInput={(event) => setValue(event.currentTarget.value)}
      />
    ),
    host,
  );
  using _app = {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
  const input = page.getByLabelText("Title");
  const element = input.element();
  await input.click();

  await input.fill("Typed");

  await expect.element(input).toHaveFocus();
  expect(input.element()).toBe(element);
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

function renderTextField(props: TextFieldProps): {
  [Symbol.dispose](): void;
} {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <TextField {...props} />, host);

  return {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}
