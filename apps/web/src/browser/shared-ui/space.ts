export type Space = "none" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

export const gapClass: Record<Space, string> = {
  none: "gap-0",
  "2xs": "gap-0.5",
  xs: "gap-1",
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
  xl: "gap-6",
  "2xl": "gap-8",
};
