export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter((value) => typeof value === "string").join(" ");
}
