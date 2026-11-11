import type { AuthenticatedAgent } from "@lineupkeep/backend/auth/Auth";
import { TeamAgentNoteSaved } from "@lineupkeep/backend/connections/AgentNote";
import type { TeamAgentNoteError } from "@lineupkeep/backend/connections/Teams";
import {
  TeamAgentNoteInput,
  TeamControlInput,
  TeamControlResult,
  Teams,
} from "@lineupkeep/backend/connections/Teams";
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
      "Change scheduled lineup automation for teams you own. It changes Lineupkeep settings only; it does not set a lineup.",
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
  Tool.make("add_team_agent_note", {
    description:
      "Append agent memory to one team you own and return the stored note with its author and time. Notes are append-only and never the owner's note.",
    parameters: TeamAgentNoteInput,
    success: Schema.toCodecJson(TeamAgentNoteSaved),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, teamScopes.agentNotes)
    .annotate(Tool.Title, "Add an agent note")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, false)
    .annotate(Tool.OpenWorld, false),
);

export function teamToolHandlers(
  agent: AuthenticatedAgent,
): Layer.Layer<Tool.HandlersFor<Toolkit.Tools<typeof teamTools>>, never, Teams> {
  return teamTools.toLayer(
    Effect.gen(function* () {
      const teams = yield* Teams;
      return teamTools.of({
        set_team_automation: (input) =>
          teams.control(agent.userId, input.teams).pipe(
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
        add_team_agent_note: (input) => {
          const clientId = agent.clientId;
          if (clientId === undefined) {
            return Effect.fail({
              code: "author_required",
              message:
                "A note needs an identified client as its author. Authorize again from a registered client and retry.",
            });
          }
          return teams
            .addAgentNote(agent.userId, { clientId, name: agent.clientName ?? null }, input)
            .pipe(mapAgentNoteFailure);
        },
      });
    }),
  );
}

function mapAgentNoteFailure<A>(
  program: Effect.Effect<A, TeamAgentNoteError>,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "team.agent_note_rejected":
          return Effect.fail({ code: error.reason, message: error.message });
        case "team.not_found":
          return Effect.fail({
            code: "team_not_found",
            message: "The selected team is not available to this account. List your teams again.",
          });
        case "team.persistence_failed":
          return Effect.annotateCurrentSpan({
            "app.outcome": "failure",
            "error.type": error._tag,
          }).pipe(
            Effect.andThen(Effect.die(new Error("The note could not be recorded. Add it again."))),
          );
      }
    }),
  );
}
