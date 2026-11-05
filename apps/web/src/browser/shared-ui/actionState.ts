export type ActionState = "idle" | "working" | "done";

export const departureDurationMs = 200;

export function actionState(working: boolean, done = false): ActionState {
  if (working) {
    return "working";
  }
  return done ? "done" : "idle";
}
