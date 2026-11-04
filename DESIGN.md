---
name: Lineupkeep
description: "Your lineup. Looked after."
colors:
  canvas: "#fbfbfa"
  paper: "#ffffff"
  ink: "#101014"
  ink-soft: "#5d5d68"
  ink-faint: "#6a6a72"
  rule: "#e2e2dc"
  rule-strong: "#101014"
  action: "#5b21b6"
  action-hover: "#4c1d95"
  action-soft: "#f3eeff"
  on-action: "#fbfbfa"
  accent: "#e0b64a"
  on-accent: "#101014"
  danger: "#a33432"
  danger-hover: "#802421"
  danger-soft: "#faece9"
  scrim: "rgb(16 16 20 / 0.55)"
  dark-canvas: "#17122a"
  dark-paper: "#1e1836"
  dark-ink: "#efeafc"
  dark-ink-soft: "#b3a4d8"
  dark-ink-faint: "#9b8cc4"
  dark-rule: "#34285c"
  dark-rule-strong: "#b9a6e8"
  dark-action: "#c4b5fd"
  dark-action-hover: "#d8c6ff"
  dark-action-soft: "#2a2150"
  dark-on-action: "#17122a"
  dark-accent: "#e0b64a"
  dark-on-accent: "#101014"
  dark-danger: "#ffb9b0"
  dark-danger-hover: "#ffd1c9"
  dark-danger-soft: "#492b27"
  dark-scrim: "rgb(0 0 0 / 0.65)"
typography:
  wordmark:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.16em"
  display:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  page-title:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  section-title:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  meta:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.16em"
rounded:
  badge: "0px"
  control: "0px"
  surface: "0px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "32px"
  section-wide: "48px"
  control-min: "44px"
  content-max: "680px"
  table-max: "960px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    textColor: "{colors.ink}"
    borderColor: "{colors.rule-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 20px"
  text-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    borderColor: "{colors.rule-strong}"
    rounded: "{rounded.control}"
    height: "44px"
  badge:
    textColor: "{colors.action}"
    typography: "{typography.label}"
    rounded: "{rounded.badge}"
---

# Design System: Lineupkeep

## Overview

**Creative North Star: "The Technical Sheet"**

Lineupkeep reads as one precise sheet: a single grotesk, square controls, a short measure, and
hairlines that do the work a card used to do. Royal violet is spent in one place per view. Gold
exists only in the mark. The product is calm enough to check in the morning and precise enough to
trust with a lineup.

This is an Operate product: information before spectacle, familiar controls, direct labels, and
honest state. Light is a warm paper; dark is a tinted violet sheet. Both are complete palettes.

**Key Characteristics:**

- One grotesk, six text sizes, no serif
- Square everywhere; hairlines instead of boxes
- One 680px measure and one solid action per view
- Numbers aligned with tabular figures, never prose tracking
- Royal violet for interaction; gold only in the mark
- Light and dark designed together

Runtime values live in [brand-theme.css](apps/web/src/theme/brand-theme.css);
[design-system.css](apps/web/src/theme/design-system.css) maps them to Tailwind utilities. The
frontmatter and the [schema-v2 sidecar](.impeccable/design.json) carry the same primitives. Keep
all three aligned.

## Colour, exactly

Violet owns interaction. Ink and rule carry everything else. Gold is the brand mark's fill and is
never used for text, actions, status, or decoration.

### Paper light

| Token          | Value                  | Role                                                      |
| -------------- | ---------------------- | --------------------------------------------------------- |
| `canvas`       | `#fbfbfa`              | Page field                                                |
| `paper`        | `#ffffff`              | Inputs and the mark's surroundings, not cards             |
| `ink`          | `#101014`              | Primary text, headings, mark strokes                      |
| `ink-soft`     | `#5d5d68`              | Secondary text, quiet links, quiet controls               |
| `ink-faint`    | `#6a6a72`              | Metadata, labels, placeholders                            |
| `rule`         | `#e2e2dc`              | Hairlines between rows and under section titles           |
| `rule-strong`  | `#101014`              | Masthead rule, control and field borders, active nav rule |
| `action`       | `#5b21b6`              | The one solid action, action links, live controls, focus  |
| `action-hover` | `#4c1d95`              | Action hover                                              |
| `action-soft`  | `#f3eeff`              | Selection and quiet interactive ground                    |
| `on-action`    | `#fbfbfa`              | Text on a solid action, toggle knob when on               |
| `accent`       | `#e0b64a`              | Brand mark fill only                                      |
| `on-accent`    | `#101014`              | Mark strokes only                                         |
| `danger`       | `#a33432`              | Errors, destructive actions, attention text               |
| `danger-hover` | `#802421`              | Danger hover                                              |
| `danger-soft`  | `#faece9`              | Danger hover ground                                       |
| `scrim`        | `rgb(16 16 20 / 0.55)` | Modal scrim                                               |

### Tinted dark

| Token          | Value               | Role                                                      |
| -------------- | ------------------- | --------------------------------------------------------- |
| `canvas`       | `#17122a`           | Page field                                                |
| `paper`        | `#1e1836`           | Inputs, one step above the field                          |
| `ink`          | `#efeafc`           | Primary text, headings                                    |
| `ink-soft`     | `#b3a4d8`           | Secondary text, quiet links, quiet controls               |
| `ink-faint`    | `#9b8cc4`           | Metadata, labels, placeholders                            |
| `rule`         | `#34285c`           | Hairlines between rows and under section titles           |
| `rule-strong`  | `#b9a6e8`           | Masthead rule, control and field borders, active nav rule |
| `action`       | `#c4b5fd`           | The one solid action, action links, live controls, focus  |
| `action-hover` | `#d8c6ff`           | Action hover                                              |
| `action-soft`  | `#2a2150`           | Selection and quiet interactive ground                    |
| `on-action`    | `#17122a`           | Text on a solid action, toggle knob when on               |
| `accent`       | `#e0b64a`           | Brand mark fill only                                      |
| `on-accent`    | `#101014`           | Mark strokes only                                         |
| `danger`       | `#ffb9b0`           | Errors, destructive actions, attention text               |
| `danger-hover` | `#ffd1c9`           | Danger hover                                              |
| `danger-soft`  | `#492b27`           | Danger hover ground                                       |
| `scrim`        | `rgb(0 0 0 / 0.65)` | Modal scrim                                               |

**Measured pairs.** Text pairs clear WCAG AA: ink 18.3:1 (light) and 15.4:1 (dark); ink-soft
6.3:1 and 8.0:1; ink-faint 5.2:1 and 6.0:1; action 8.7:1 and 9.8:1; on-action on action 8.7:1
and 9.8:1; action on action-soft 7.9:1 in both; danger 6.6:1 and 11.1:1; danger on danger-soft
5.9:1 and 7.7:1; on-accent on accent 9.9:1 in both. Hairlines are non-text. The mark's strokes
are a graphic and clear 9.9:1. Gold never carries text on the page.

**The One Violet Rule.** Per view, one solid violet element: the primary action. Links and live
controls carry violet as text, underline, or border. Everything else is ink, soft ink, and rule.
Danger is a semantic exception, used only for errors and destructive actions.

**The Gold Reserve Rule.** Gold belongs to the mark and nowhere else. It is not a status, a
highlight, a badge, or a second action.

## Typography

**One family:** Schibsted Grotesk Variable, self-hosted through Fontsource. No serif, no display
face, no second grotesk. Google's branded button keeps Google's prescribed G and type.

The pages use six text sizes, and no others:

- **11px label** — uppercase, weight 600, `0.16em` tracking. Masthead, nav, control labels, field
  labels, status words, section kickers.
- **12px meta** — weight 400, line height 1.5. League context, timestamps, helper copy, feedback.
- **15px body** — weight 400, line height 1.55. Prose, rows, links, field values.
- **22px section title** — weight 600, line height 1.2. Section headings and auth form headings.
- **28px page title** — weight 600, line height 1.15. Page and auth titles.
- **40px display** — weight 600, line height 1.05. The landing statement only.

Tracking belongs to labels. Body, meta, and titles use normal tracking; titles may use `-0.02em`
to `-0.03em`. Never add letter spacing to body text.

**Numerals.** Use `font-variant-numeric: tabular-nums` on anything compared to anything else:
`time`, counts in a row, attempts, ratios, and record tallies. Apply it to the numeric element or
line, never to prose: in Schibsted Grotesk tabular figures widen punctuation and produce gaps
before commas and full stops.

**The Wordmark Rule.** The wordmark stays continuous lowercase `lineupkeep` at the 11px label
weight and tracking, beside the square mark. Use Lineupkeep in prose. Do not uppercase, split,
outline, or colour the syllables.

**The Mark.** A 20px gold square with ink `lk` strokes, square corners, placed at the masthead's
left edge. The same artwork is the favicon. Gold appears nowhere else.

## Layout

**One measure.** The application column is 680px. Lists and tables may extend to 960px when their
columns genuinely need it; no content runs the viewport width. The masthead, section rules, row
rules, and controls share the column's left and right edges.

**The masthead** is two rows inside the measure: brand mark and lowercase wordmark left, theme
toggle right; then primary navigation with the sign-out control at the right. One 1px
`rule-strong` rule closes the masthead. Navigation labels are 11px caps; the active item carries a
1px rule that spans the item, not a short bar under the word.

**Rows** are two columns from 560px: text at the left, one control cluster at the right. Below
560px a row stacks: full-width text first, then the controls on their own line, aligned left. A
long team or league name wraps; it never truncates. Controls never overlap a name.

**Team detail order** is fixed: back link, title, one metadata line (sport and league), one
control row with toggle, pause, and provider jump-out on the same line, a quiet report link, then
the activity section behind its rule, then the owner note. Nothing floats to the right of the
metadata line.

**Activity ranges** omit a repeated date: `Nov 1, 11:44 AM to 1:12 PM`. When the group is a
single instant, say `at Nov 1, 11:44 AM`; when it crosses the reader's midnight, show both full
dates.

**Alignment.** Text shares one left edge. Controls share one right edge above 560px and one left
edge below it. Toggle, pause, and provider controls sit on the text's first-line baseline.

## Elevation and shape

There are no rounded corners. Controls, toggles, inputs, badges, dialogs, and surfaces are square.
Radii are `0px` in the tokens, and a component must not add one.

There are no shadows, gradients, or layered panels. Hierarchy comes from ink weight, the 680px
measure, and 1px rules. A surface earns a border only when it is a control: an input, a button, the
hosted browser viewport, or a dialog. Prose, lists, notices, and empty states use rules, not boxes.

**The Rule, Not a Box Rule.** A section title owns one hairline. List rows own one hairline between
them. Status and empty states use a leading rule or plain text, never a dashed or bordered card.

## Components

### Actions

- **Primary:** solid `action`, `on-action` text, 44px high, 11px caps, square. One per view.
- **Secondary:** 1px `rule-strong` border, ink text, 44px, square.
- **Quiet:** 11px caps ink-soft text, no border; used for sign-out and other low-stakes controls.
- **Link:** 15px action violet with a 1px underline, used for navigation and recovery. Quiet links
  use ink-soft, not violet.
- **Icon:** a 28px square frame with a 1px `rule-strong` border inside a 44px hit area. The frame
  sits flush with the column edge; the hit area may extend into the gutter. Pause, provider, and
  theme toggle use this control.
- **Google:** Google's G and prescribed light/dark fill, square to match the sheet, with its own
  14px type as the one branded exception.

Pressed, pending, disabled, and focus states remain native and accessible. Focus is a 2px action
ring with 2px separation; it is visible on every ground and does not rely on colour alone.

### Fields

Labels are 11px caps. Inputs are 44px, 15px body, square, with a 1px `rule-strong` border and
`paper` ground. Descriptions and errors are 12px; errors are danger and sit beside the field.
Placeholders are not labels. The caret and selection use action tokens.

### Toggle

A 40×22 square track with a 16px square knob. On is `action` with an `on-action` knob; off is
`rule` with a `paper` knob. The track carries a 44px hit area. In a list of teams the label is
hidden and the row's name identifies the toggle; on a single team the `LINEUP CHECKS` label is
visible. The pause control sits beside the toggle with its sentence in the title.

### Lists and status

Team and connection rows use 15px text with 12px meta, a 22px name where the row is a primary
destination, and a bottom hairline. Status is a labelled word in caps, never a colour alone. Team
rows show what the last check did, when, the recent tally, and a paused sentence in the text
column. A list never repeats a control label on every row.

Notices are a 1px leading rule with caps title and 12px detail. Empty and loading states are a
top rule with a 15px title and soft text. The live status region stays in the accessibility tree
when empty (visually hidden) and becomes visible when a message arrives.

### Browser and dialogs

The hosted browser viewport keeps a 1px border and square corners; it has no simulated traffic
lights, no shadow, and no panel treatment. A dialog uses a `paper` ground, a 1px border, the scrim
token, and the same square corners.

### Operational states

Connection health, team automation, actionable period, and run outcome stay explicit. Automation
off, paused, reconnect required, unavailable, queued, checking, verified unchanged, verified
updated, and needs reconciliation are distinct. Never flatten them into green/red or Done.

A pause is not a disable, expired connection is not lost enrollment, unavailable is not deleted,
and sent is not verified. Paused rows name the rest of the fantasy day and show the resume time in
the reader's locale. Reconnect-required rows retain enrollment and expose one explicit reconnect
path.

A run detail shows the target period, trigger, attempts, verified outcome, changes, and pending
reason without exposing credentials, cookies, provider GUIDs, raw payloads, or raw errors.

### Connections

The connection surface links through the hosted browser only; the web UI has no password field.
Each connection row names the provider, the teams it covers, when it was connected, and what its
current status can do. A connection that needs a new sign-in reopens the same hosted browser
session in place.

### Content and states

Use sentence case in prose and caps only for labels. Provider names appear only where a specific
connection, team, or run is named; the product stays provider neutral. Numbers are tabular when
compared; times are written in the reader's locale. Colour alone never communicates success, risk,
or connection health.

## Do's and Don'ts

### Do

- Do use semantic tokens and both complete themes.
- Do keep controls, inputs, badges, and dialogs square.
- Do keep the 680px measure and let tables exceed it only with a reason.
- Do use one hairline under a section title and between list rows.
- Do spend violet once per view on the primary action.
- Do apply tabular numerals to comparable numbers only.
- Do keep the wordmark lowercase and the mark gold.
- Do preserve keyboard access, visible focus, selection, zoom, and reduced motion.
- Do let long names wrap and rows stack below 560px.

### Don't

- Don't add border radii, shadows, gradients, or a second accent.
- Don't use gold outside the mark.
- Don't use a serif or a second typeface.
- Don't box prose, lists, notices, or empty states.
- Don't add letter spacing to body text or apply tabular figures to prose.
- Don't repeat a control label on every row of a list.
- Don't float controls to the right of a metadata line.
- Don't use colour alone for connection, automation, or risk.
- Don't expose credentials, cookies, provider GUIDs, raw payloads, or raw errors.

[Brand notes](docs/brand/BRAND.md) owns naming, voice, and placement. The [specimen](docs/brand/preview.html) illustrates the foundation; it is not a product prototype. This design does not authorize launch, waive the dependency blocker, or establish trademark/domain ownership.
