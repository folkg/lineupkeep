import { redirect } from "@tanstack/solid-router";

export function connectionsRedirect(): never {
  throw redirect({ to: "/account" });
}
