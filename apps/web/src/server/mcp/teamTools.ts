import type { UserId } from "@lineupkeep/backend/auth/User";
import { TeamControlInput, TeamControlResult, Teams } from "@lineupkeep/backend/connections/Teams";
import { teamScopes } from "@lineupkeep/backend/connections/TeamScopes";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

export const SetTeamAutomationInput = Schema.Struct({
  teams: Schema.Array(TeamControlInput).pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(10),
      Schema.makeFilter((inputs: ReadonlyArray<TeamControlInput>) =>
        new Set(inputs.map((input) => input.team)).size === inputs.length
          ? undefined
          : "Each team may appear once per automation request.",
      ),
    ),
  ),
});
export type SetTeamAutomationInput = typeof SetTeamAutomationInput.Type;

const SetTeamAutomationResult = Schema.Struct({
  teams: Schema.Array(TeamControlResult),
});
type SetTeamAutomationResult = typeof SetTeamAutomationResult.Type;

export const teamTools = Toolkit.make(
  Tool.make("set_team_automation", {
    description:
      "Change scheduled lineup automation for one or more teams you own, using the private team ids from list_teams. Each requested team names one action: enable enrolls the team without changing its configuration; disable stops scheduled work but retains its configuration; pause-today suspends scheduled work until the provider fantasy day ends and returns resumesAt; resume clears that pause. Repeating an action is a no-op with the resulting state. A team's availability is separate from enrollment: an unavailable team keeps the recorded setting but scheduled checks skip it. This changes only Lineupgrade automation state; it does not set a lineup or contact the provider. set_lineup remains the manual way to run a lineup, bypassing enrollment but not ownership, connection readiness, availability, locks, or uncertain-write protection.",
    parameters: SetTeamAutomationInput,
    success: Schema.toCodecJson(SetTeamAutomationResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, teamScopes.manage)
    .annotate(Tool.Title, "Set team automation")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function teamToolHandlers(
  userId: UserId,
): Layer.Layer<Tool.HandlersFor<Toolkit.Tools<typeof teamTools>>, never, Teams> {
  return teamTools.toLayer(
    Effect.gen(function* () {
      const teams = yield* Teams;
      return teamTools.of({
        set_team_automation: (input) =>
          teams.control(userId, input.teams).pipe(
            Effect.map((results): SetTeamAutomationResult => ({ teams: results })),
            Effect.catchTag("team.persistence_failed", (error) =>
              Effect.annotateCurrentSpan({
                "app.outcome": "failure",
                "error.type": error._tag,
              }).pipe(
                Effect.andThen(
                  Effect.die(
                    new Error(
                      "The automation change could not be completed. List your teams again.",
                    ),
                  ),
                ),
              ),
            ),
          ),
      });
    }),
  );
}
