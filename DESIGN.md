---
name: Lineupgrade
description: "Your lineup. Looked after."
colors:
  canvas: "#f4efe4"
  paper: "#fffdf7"
  ink: "#141217"
  ink-soft: "#6a6470"
  ink-faint: "#6f6875"
  rule: "#cdc5b7"
  rule-strong: "#141217"
  action: "#5b21b6"
  action-hover: "#4c1d95"
  action-soft: "#f3eeff"
  action-offset: "rgb(91 33 182 / 0.72)"
  on-action: "#fffdf7"
  accent: "#e0b64a"
  on-accent: "#101014"
  spot: "#d9482b"
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
  dark-action-offset: "rgb(196 181 253 / 0.55)"
  dark-on-action: "#17122a"
  dark-accent: "#e0b64a"
  dark-on-accent: "#101014"
  dark-spot: "#ff9e7a"
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
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "clamp(2.75rem, 5vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 0.98
    letterSpacing: "-0.035em"
  page-title:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "clamp(2.75rem, 5.4vw, 4.375rem)"
    fontWeight: 800
    lineHeight: 0.95
    letterSpacing: "-0.035em"
    textTransform: "uppercase"
  statement:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  section-title:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  team-name:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "1.625rem"
    fontWeight: 800
    lineHeight: 1.05
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
shadows:
  focus: "0 0 0 2px {colors.canvas}, 0 0 0 4px {colors.action}"
  panel: "8px 8px 0 {colors.action-offset}"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.on-action}"
    borderColor: "{colors.rule-strong}"
    borderWidth: "2px"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 20px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-secondary:
    textColor: "{colors.ink}"
    borderColor: "{colors.rule-strong}"
    borderWidth: "2px"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    height: "44px"
    padding: "0 20px"
  text-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    borderColor: "{colors.rule-strong}"
    borderWidth: "2px"
    rounded: "{rounded.control}"
    height: "44px"
  badge:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.action}"
    borderColor: "{colors.rule-strong}"
    borderWidth: "2px"
    typography: "{typography.label}"
    rounded: "{rounded.badge}"
    padding: "4px 8px"
  section-title:
    borderColor: "{colors.rule-strong}"
    borderWidth: "3px"
    typography: "{typography.section-title}"
  queue-panel:
    backgroundColor: "{colors.paper}"
    borderColor: "{colors.rule-strong}"
    borderWidth: "2px"
    boxShadow: "{shadows.panel}"
---

# Design System: Lineupgrade

## Overview

**Creative North Star: "Ink and paper"**

Lineupgrade reads as a printed sports sheet: warm newsprint, near-black ink, a display face for the
page and the teams, and Schibsted for the work in between. Section rules are 3px ink; row hairlines
stay 1px. A queue panel is the one offset panel, lifted by one hard violet offset with no blur;
team cards are plain 2px-ruled boxes on paper. Royal violet
is spent on interaction, gold exists only in the mark, and one spot ink marks urgency. The product
is calm enough to check in the morning and precise enough to trust with a lineup.

This is an Operate product: information before spectacle, familiar controls, direct labels, and
honest state. Light is warm newsprint; dark is a tinted violet sheet. Both are complete palettes.

**Key Characteristics:**

- Archivo Variable for page titles, section titles, and team names at weight 800;
  Schibsted Grotesk Variable for body, meta, labels, controls, and the wordmark
- Square everywhere; 3px ink section rules, 1px row hairlines, and a 2px ink rule around each team
  card
- One 680px measure and one solid action per view
- One 8px hard violet offset on a queue panel, and no other shadow
- Numbers aligned with tabular figures, never prose tracking
- Royal violet for interaction; gold only in the mark; spot ink only for urgency
- Light and dark designed together

Runtime values live in [brand-theme.css](apps/web/src/theme/brand-theme.css);
[design-system.css](apps/web/src/theme/design-system.css) maps them to Tailwind utilities. The
frontmatter and the [schema-v2 sidecar](.impeccable/design.json) carry the same primitives. Keep
all three aligned.

## Colour, exactly

Violet owns interaction. Ink and rule carry everything else. Gold is the brand mark's fill and is
never used for text, actions, status, or decoration. Spot ink is the one urgency accent; danger
remains the error and destructive colour.

### Paper light

| Token           | Value                   | Role                                                      |
| --------------- | ----------------------- | --------------------------------------------------------- |
| `canvas`        | `#f4efe4`               | Warm newsprint page field                                 |
| `paper`         | `#fffdf7`               | Inputs, badges, queue panels, and the mark's surroundings |
| `ink`           | `#141217`               | Primary text, headings, mark strokes                      |
| `ink-soft`      | `#6a6470`               | Secondary text, quiet links, quiet controls               |
| `ink-faint`     | `#6f6875`               | Metadata, labels, placeholders                            |
| `rule`          | `#cdc5b7`               | 1px hairlines between rows                                |
| `rule-strong`   | `#141217`               | 3px section rules, 2px control borders, active nav rule   |
| `action`        | `#5b21b6`               | The one solid action, action links, live controls, focus  |
| `action-hover`  | `#4c1d95`               | Action hover                                              |
| `action-soft`   | `#f3eeff`               | Selection and quiet interactive ground                    |
| `action-offset` | `rgb(91 33 182 / 0.72)` | The hard violet offset behind a queue panel               |
| `on-action`     | `#fffdf7`               | Text on a solid action                                    |
| `accent`        | `#e0b64a`               | Brand mark fill only                                      |
| `on-accent`     | `#101014`               | Mark strokes only                                         |
| `spot`          | `#d9482b`               | Urgency only: runs immediately, illegal roster, stamp     |
| `danger`        | `#a33432`               | Errors, destructive actions, attention text               |
| `danger-hover`  | `#802421`               | Danger hover                                              |
| `danger-soft`   | `#faece9`               | Danger hover ground                                       |
| `scrim`         | `rgb(16 16 20 / 0.55)`  | Modal scrim                                               |

### Tinted dark

| Token          | Value               | Role                                                     |
| -------------- | ------------------- | -------------------------------------------------------- |
| `canvas`       | `#17122a`           | Page field                                               |
| `paper`        | `#1e1836`           | Inputs and queue panels, one step above the field        |
| `ink`          | `#efeafc`           | Primary text, headings                                   |
| `ink-soft`     | `#b3a4d8`           | Secondary text, quiet links, quiet controls              |
| `ink-faint`    | `#9b8cc4`           | Metadata, labels, placeholders                           |
| `rule`         | `#34285c`           | 1px hairlines between rows                               |
| `rule-strong`  | `#b9a6e8`           | 3px section rules, 2px control borders, active nav rule  |
| `action`       | `#c4b5fd`           | The one solid action, action links, live controls, focus |
| `action-hover` | `#d8c6ff`           | Action hover                                             |
| `action-soft`  | `#2a2150`           | Selection and quiet interactive ground                   |
| `on-action`    | `#17122a`           | Text on a solid action                                   |
| `accent`       | `#e0b64a`           | Brand mark fill only                                     |
| `on-accent`    | `#101014`           | Mark strokes only                                        |
| `spot`         | `#ff9e7a`           | Urgency only: runs immediately, illegal roster, stamp    |
| `danger`       | `#ffb9b0`           | Errors, destructive actions, attention text              |
| `danger-hover` | `#ffd1c9`           | Danger hover                                             |
| `danger-soft`  | `#492b27`           | Danger hover ground                                      |
| `scrim`        | `rgb(0 0 0 / 0.65)` | Modal scrim                                              |

**Measured pairs.** Body and interface text pairs clear WCAG AA: ink 16.2:1 (light) and 15.4:1
(dark); ink-soft 5.0:1 and 8.0:1; ink-faint 4.7:1 and 6.0:1; action 7.8:1 on canvas and 9.8:1 on
the dark field; on-action on action 8.8:1 and 9.8:1; action on action-soft 7.9:1 in both; danger
5.9:1 and 11.1:1; danger on danger-soft 5.9:1 and 7.7:1; on-accent on accent 9.9:1 in both.
Hairlines are non-text. The mark's strokes are a graphic and clear 9.9:1. Gold never carries text
on the page. Spot ink is 3.7:1 on canvas and 4.2:1 on paper in light, and 9.0:1 in dark; it is
reserved for short, bold urgency marks and the square, never for body copy.

**The One Violet Rule.** Per view, one solid violet element: the primary action. Links and live
controls carry violet as text, underline, or border. Everything else is ink, soft ink, and rule.
Danger is a semantic exception, used only for errors and destructive actions.

**The Gold Reserve Rule.** Gold belongs to the mark and nowhere else. It is not a status, a
highlight, a badge, or a second action.

**The Spot Ink Rule.** Spot ink is reserved for three urgency marks: a group that runs immediately,
a roster that blocks adds and drops, and the printed stamp. It is not an error colour; danger owns
errors and destructive actions.

## Typography

**Two faces with separate jobs.** Display type is Archivo Variable, self-hosted through
Fontsource (`@fontsource-variable/archivo`). Work type is Schibsted Grotesk Variable,
self-hosted through Fontsource. Archivo carries page titles, section titles, team names, the
landing statement, and the display scale at weight 800. Schibsted carries body, meta, labels,
controls, and the wordmark. No serif, no third face. Google's branded button keeps Google's
prescribed G and type.

The display scale:

- **Page title** — `clamp(44px, 5.4vw, 70px)`, weight 800, line height 0.95, `-0.035em` tracking,
  uppercase. A team name used as a page title takes the team-name size and keeps its case.
- **Display** — `clamp(44px, 5vw, 68px)`, weight 800, line height 0.98, `-0.035em`. The
  landing statement only.
- **Statement** — 28px, weight 800, line height 1.15, `-0.02em`. Auth and quiet statements.
- **Section title** — 22px, weight 800, line height 1.2, `-0.02em`.
- **Team name** — 26px, weight 800, line height 1.05, `-0.02em`.

The work scale:

- **11px label** — uppercase, weight 600, `0.16em` tracking. Masthead, nav, control labels, field
  labels, status words, section counts.
- **12px meta** — weight 400, line height 1.5. League context, timestamps, helper copy, feedback.
- **15px body** — weight 400, line height 1.55. Prose, rows, links, field values.

Tracking belongs to display type and labels. Body and meta use normal tracking; display and team
names use `-0.02em` to `-0.035em`. Never add letter spacing to body text.

**Numerals.** Use `font-variant-numeric: tabular-nums` on anything compared to anything else:
`time`, counts in a row, attempts, ratios, and record tallies. Apply it to the numeric element or
line, never to prose: in Schibsted Grotesk tabular figures widen punctuation and produce gaps
before commas and full stops.

**The Wordmark Rule.** The wordmark stays continuous lowercase `lineupgrade` in Schibsted Grotesk at
the 11px label weight and tracking, beside the square mark. Archivo never sets the wordmark. Use
Lineupgrade in prose. Do not uppercase, split, outline, or colour the syllables.

**The Mark.** A 20px gold square with ink `lu` strokes: a lowercase l with a short foot so it
cannot read as an I, and a square u with a rounded inner corner, 6 units of stroke in a 64 unit
box. It sits at the masthead's left edge. The same artwork is the favicon. Gold appears nowhere
else.

## Layout

**One measure.** The application column is 680px. Lists and tables may extend to 960px when their
columns genuinely need it; no content runs the viewport width. The masthead, section rules, row
rules, and controls share the column's left and right edges.

**The masthead** is one row inside the measure on wide screens: the brand mark and lowercase
wordmark at the left, the primary navigation at the right. Below 560px the navigation wraps under
the brand. There is no theme control or sign-out utility in the masthead. One 3px `rule-strong`
rule closes it. Navigation labels are 11px caps; the active item carries a 2px ink rule that spans
exactly the item, not a short bar or an overhanging block. The links wrap as whole items, with no
utility action left on a line of its own.

**Rows and cards** use two columns from 560px: text at the left, one control cluster at the right. A team
card puts its provider jump-out beside the 26px team name in the text column; the right cluster
carries the checks toggle and the pause control, so every card has the same control shape. The
pause is a 28px square icon frame showing Pause or Play, so changing state never shifts the
cluster; its accessible name stays the full pause or resume sentence, and it stays in place and
is disabled while checks are off. Below 560px a card stacks: full-width text first, then the
controls on their own line, aligned left. A long team or league name wraps; it never truncates.
Controls never overlap a name.

**Team detail order** is fixed: back link, title with the provider jump-out beside it, one
metadata line (sport and league), one control row with toggle and pause on the same line, a quiet
report link, then the activity section behind its rule, then the owner note. The provider jump-out
sits beside the title here and beside the name on the list. Nothing floats to the right of the
metadata line.

**Team cards.** The team list puts each team in its own card, sorted by sport then name; the
sport is already in the card's meta line, so there are no league headings or counts. A card has
a 2px ink rule and the normal `paper` ground, never the queue offset. Team names are 26px
Archivo; the meta and status lines stay 12px Schibsted.

**Activity ranges** omit a repeated date: `Nov 1, 11:44 AM to 1:12 PM`. When the group is a
single instant, say `at Nov 1, 11:44 AM`; when it crosses the reader's midnight, show both full
dates.

**Alignment.** Text shares one left edge. Controls share one right edge above 560px and one left
edge below it. Toggle, pause, and provider controls sit on the text's first-line baseline; the
toggle and pause share one horizontal line.

## Elevation and shape

There are no rounded corners. Controls, toggles, inputs, badges, dialogs, and surfaces are square.
Radii are `0px` in the tokens, and a component must not add one.

There is one hard shadow: a queue group is a `paper` panel with a 2px ink border and an 8px violet
offset, no blur. The offset is the only shadow a surface casts; the focus ring is the only other
shadow in the interface. Buttons, fields, team cards, notices, and quiet surfaces cast none. There
are no gradients except the phone submit sheet fade. A surface earns a border when it is a control
(an input, a button, the hosted browser viewport, or a dialog), a team card, or the queue panel.
Prose, connection lists, notices, and empty states use rules, not boxes.

**The Rule, Not a Box Rule.** A section title owns one 3px ink rule. Connection rows own 1px
hairlines between them. Team cards own a 2px ink rule each. Queue groups are the one offset panel.
Status and empty states use a leading rule or plain text, never a dashed or bordered card.

**The Phone Submit Sheet.** Below 560px the submit controls sit in a sheet fixed to the bottom with
no rule of their own. A 16px canvas fade above it takes the rule's place, so the page blends into
the action instead of stacking a second panel on top of it. The fade is the one gradient in the
product, and it exists only at that edge.

## Motion

Most of the interface does not move. Motion is spent on the few moments a person meets rarely: a
list arriving where an empty state was, and a submitted set settling into its outcome. Nothing on the
frequent path animates — no hover, focus, list row at rest, navigation, or control press. The one
continuous motion in the product is the hairline a working control draws.

**The Rare Moment Rule.** A moment earns motion when it is occasional or first-time and its purpose
is to prevent a jarring change or to make a state legible. If it repeats many times a day, or it only
looks nice, it stays still.

- An arrival settles in once: `opacity` from 0 with a 4px rise, on `--theme-duration-reveal` with
  `--theme-ease-out`. It plays when content becomes populated while the page is open; a page load or
  a navigation never animates.
- The phone submit sheet settles in once when it first appears at the bottom: the same 4px rise and
  `opacity` entrance on the reveal token, and it holds still after that. It is the one fixed element
  that animates, and it holds still under reduced motion.
- Only `transform` and `opacity` move. Nothing animates a width, a height, a margin, a padding, or an
  offset.
- The working hairline travels in container units — a length, never a percentage of its own box — and
  asks for its own layer with `will-change: transform`. Its travel is then a value the compositor can
  take, so the line keeps its speed and its one-third width without resolving against layout every
  frame.
- Durations and easings come from the tokens beside them. A component never invents one, and the UI
  stays under 300ms. Constant motion — the working hairline — is `linear`.
- Motion is CSS: a transition where a state can change back, keyframes for a one-shot entrance. There
  is no animation library.
- `prefers-reduced-motion: reduce` is authoritative. Every duration collapses to zero, the working
  hairline holds still, and entrances are removed rather than shortened. The content is the same
  content.

The [action states](#action-states) keep their own timing: the switch, the pause, the refresh tick,
and note save are decided there and are not retimed by a motion pass.

## Components

### Actions

- **Primary:** solid `action`, `on-action` text, a 2px ink border, 44px high, 11px caps, square.
  One per view.
- **Secondary:** 2px `rule-strong` border, ink text, 44px, square.
- **Quiet:** 11px caps ink-soft text, no border; used for sign-out and other low-stakes controls.
- **Link:** 15px action violet with a 2px underline, used for navigation and recovery. Quiet links
  use ink-soft, not violet.
- **Pause:** an icon control in the 28px square frame inside a 44px hit area, beside the team's
  checks toggle. It shows Pause or Play so the control keeps its place; its accessible name
  remains the full pause or resume sentence.
- **Icon:** a 28px square frame with a 2px `rule-strong` border inside a 44px hit area. The frame
  sits flush with the column edge; the hit area may extend into the gutter. Provider jump-outs,
  the pause control, and the refresh control use this control.
- **Google:** Google's G and prescribed light/dark fill, square to match the sheet, with its own
  14px type as the one branded exception.

Pressed, pending, disabled, and focus states remain native and accessible. Focus is a 2px action
ring with 2px separation; it is visible on every ground and does not rely on colour alone.

### Fields

Labels are 11px caps. Inputs are 44px, 15px body, square, with a 2px `rule-strong` border and
`paper` ground. Descriptions and errors are 12px; errors are danger and sit beside the field.
Placeholders are not labels. The caret and selection use action tokens.

### Toggle

A 40×22 track with a 2px ink edge, 3px padding, and a 16px square knob. The edge is drawn
inside the track so the outer size never changes. On fills the track with `action` and draws
the knob in `on-action`; off fills the track with `paper` and draws the knob in `ink`.
The track carries a 44px hit area. In a list of teams the label is hidden and the card's name
identifies the toggle; on a single team the `LINEUP CHECKS` label is visible. The pause control
always sits beside the toggle; when checks are off it is disabled with an explanatory title rather
than removed.

### Lists and status

Connection rows use 15px text with 12px meta and a 1px bottom hairline. Team cards and
transaction group cards share one Card frame: a 2px ink rule on the `paper` ground with an 8px hard
violet offset, one header rule, and one footer rule. A team name is 26px Archivo at 800 where the card is a primary
destination. Status is a labelled word in caps, never a colour alone. Team cards keep one status
line under the league context in every state — the next check, a pause with its resume time,
checks off, or a check in progress — then what the last check did, when, and the recent tally. The
status line reserves two lines so its sentence cannot change the card's height. A provider
jump-out sits beside the team name; the right cluster is the toggle and pause only. A list never
repeats a control label on every row.

Notices are a 2px leading rule with caps title and 12px detail. Empty and loading states are a
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

### Action states

Every `Button`, `ButtonLink`, `IconButton`, and `Switch` carries
`state?: "idle" | "working" | "done"`. A control that shows a value changes it the moment it is
pressed, then waits; a refusal returns the value and names the reason through `ActionFeedback`.
The control owns no value of its own.

While working, the control is natively disabled with `aria-busy`, keeps its label, and draws one
indeterminate hairline inside its own box: under a button's edge, inside a switch's track, inside
an icon's frame. `done` draws a tick only when the call site passes `confirmed`, because most
actions confirm themselves by changing something else. In an icon button the glyph fades fully out
before the tick draws alone in the same box, and returns after the tick has held; both are never
visible at once. A page never inserts words beside a control to describe its progress.
`ButtonLink` takes the action state as `actionState`, because TanStack Router owns `state` for
history.

`--theme-duration-work`, `--theme-duration-tick`, and `--theme-duration-confirm` in
[brand-theme.css](apps/web/src/theme/brand-theme.css) own the timing; components do not invent
durations, easings, or keyframes. Under `prefers-reduced-motion: reduce` the hairline holds still
and every state change is instant.

### Account

The Account page owns appearance, connections, sign-in sessions, data export, sign out, and
erasure. Appearance offers System, Light, and Dark; System follows the device and listens for
changes. Connect another account is a normal control inside Connections, under the description and
above the connection rows. A session row ends that session, and the current device carries the one
Sign out this device action. Your data holds the export first, then the erase action with its warning
and required export step. Sign out is not in the masthead navigation. The page title and the
navigation label are both Account.

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
- Do use one 3px ink rule under a section title and 1px hairlines between list rows.
- Do set page titles, section titles, and team names in Archivo at weight 800.
- Do spend violet once per view on the primary action.
- Do apply tabular numerals to comparable numbers only.
- Do keep the wordmark lowercase in Schibsted and the mark gold.
- Do use the 8px violet offset only on a queue panel.
- Do reserve spot ink for urgency.
- Do keep motion to the rare moments named under [Motion](#motion), on the theme's duration and
  easing tokens.
- Do preserve keyboard access, visible focus, selection, zoom, and reduced motion.
- Do keep the provider jump-out with the team name and the pause control in place.
- Do let long names wrap and rows stack below 560px.

### Don't

- Don't add border radii, a shadow beyond the queue panel offset, a colour gradient beyond the
  phone submit sheet fade, or a second accent.
- Don't use gold outside the mark.
- Don't use a serif or a third face.
- Don't set body, meta, labels, controls, or the wordmark in Archivo.
- Don't use spot ink for errors, destructive actions, or general status; danger owns those.
- Don't add a print texture.
- Don't box prose, connection rows, notices, or empty states.
- Don't add letter spacing to body text or apply tabular figures to prose.
- Don't repeat a control label on every row of a list.
- Don't remove a control or shift the cluster when it becomes unavailable; disable it in place.
- Don't float controls to the right of a metadata line.
- Don't use colour alone for connection, automation, or risk.
- Don't animate the frequent path: hover, focus, a list row at rest, navigation, or a control press.
- Don't expose credentials, cookies, provider GUIDs, raw payloads, or raw errors.

[Brand notes](docs/brand/BRAND.md) owns naming, voice, and placement. The [specimen](docs/brand/preview.html) illustrates the foundation; it is not a product prototype. This design does not authorize launch, waive the dependency blocker, or establish trademark/domain ownership.
