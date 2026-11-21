import { EffectArray } from "@lineupkeep/collections";
export function cx(...classes: Array<string | false | null | undefined>): string {
  return EffectArray.join(
    EffectArray.filter(classes, (value) => typeof value === "string"),
    " ",
  );
}
