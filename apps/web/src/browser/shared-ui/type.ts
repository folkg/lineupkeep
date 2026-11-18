export const typeClass = {
  display: "font-display text-display",
  "page-title": "font-display text-page-title",
  "section-title": "font-display text-section-title",
  "card-title": "font-display text-card-title",
  body: "font-sans text-body",
  "body-strong": "font-sans text-body-strong",
  meta: "font-sans text-meta",
  label: "font-sans text-label",
  badge: "font-sans text-badge",
} as const;

export type TextType = keyof typeof typeClass;
