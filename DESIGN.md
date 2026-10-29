---
name: Lineupkeep
description: "Your lineup. Looked after."
colors:
  canvas: "#f6f5ff"
  paper: "#ffffff"
  ink: "#20143b"
  ink-soft: "#625675"
  ink-faint: "#726480"
  rule: "#dfd9ec"
  rule-strong: "#9483a8"
  action: "#6236e5"
  action-hover: "#4c24bf"
  action-soft: "#ece6ff"
  accent: "#ffe253"
  accent-hover: "#f5d137"
  on-accent: "#23113f"
  danger: "#a33432"
  danger-hover: "#802421"
  danger-soft: "#faece9"
  danger-on-panel: "#ffc0b9"
  panel: "#291450"
  on-panel: "#ffffff"
  on-panel-soft: "#dccff0"
  panel-rule: "#947eb3"
  dark-canvas: "#151020"
  dark-paper: "#21192f"
  dark-ink: "#f8f3ff"
  dark-ink-soft: "#c6b9d9"
  dark-ink-faint: "#b3a1ca"
  dark-rule: "#48375e"
  dark-rule-strong: "#a48bbc"
  dark-action: "#baa3ff"
  dark-action-hover: "#cfbdff"
  dark-action-soft: "#39275d"
  dark-accent: "#ffe253"
  dark-accent-hover: "#f5d137"
  dark-on-accent: "#271240"
  dark-danger: "#ffb9b0"
  dark-danger-hover: "#ffd1c9"
  dark-danger-soft: "#492b27"
  dark-danger-on-panel: "#ffb9b0"
  dark-panel: "#412479"
  dark-on-panel: "#ffffff"
  dark-on-panel-soft: "#e1d1ff"
  dark-panel-rule: "#a48bbc"
typography:
  wordmark:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  display:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "clamp(3rem, 5.5vw, 5.25rem)"
    fontWeight: 600
    lineHeight: 1.06
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "clamp(2.5rem, 4vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "clamp(2rem, 3.2vw, 2.75rem)"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  control:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.2
  caption:
    fontFamily: "Schibsted Grotesk Variable, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  badge: "4px"
  control: "6px"
  surface: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  section: "48px"
  section-wide: "64px"
  control-min: "44px"
  content-max: "76rem"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.paper}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "46px"
    padding: "0 18px"
  button-primary-hover:
    backgroundColor: "{colors.action-hover}"
  button-accent:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    height: "46px"
    padding: "0 18px"
  button-accent-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "46px"
  text-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "48px"
  badge:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.badge}"
---

# Design System: Lineupkeep

## Overview

**Creative North Star: "The Considered Instrument"**

An assured fantasy-team instrument with sporting energy: royal violet actions, golden yellow accents, and deep violet ink. A continuous lowercase wordmark, one self-hosted family, and ruled information keep the identity professional and solid.

This is an Operate product: familiar navigation, native controls, direct labels, and information before spectacle. Light supports daytime checks and dark supports evening use. The operational teams, connections, and lineup-run surfaces are implemented on this foundation.

**Key Characteristics:**

- Continuous typographic identity
- Clear operational state
- Confident sporting colour
- Light and dark as complete palettes

Runtime values live in [brand-theme.css](apps/web/src/theme/brand-theme.css); [design-system.css](apps/web/src/theme/design-system.css) maps them to semantic utilities. Frontmatter owns normative primitives. The [schema-v2 sidecar](.impeccable/design.json) adds metadata, dark-theme mappings, motion, focus, and portable component specimens. Keep all three aligned.

## Colors

### Primary

Royal violet **action** owns primary actions, links, focus, and selection; **action-soft** supports quieter interactive states. Deep violet **panel** is a confident companion surface with explicitly scoped foregrounds.

### Secondary

Golden yellow **accent**, paired with **on-accent** deep ink, brings sporting energy to highlighted calls to action and labelled attention. Gold is part of the approved identity, not a universal success or warning colour. Danger colours remain reserved for error/destructive meaning.

### Neutral

**Canvas** is pale violet; **paper** is clean white. Dark surfaces use violet-black rather than green or neutral charcoal. **Ink**, **ink-soft**, and **ink-faint** establish readable hierarchy. **Rule** separates rows; **rule-strong** defines important boundaries. Dark tokens use the corresponding dark-prefixed frontmatter names and map to the same runtime roles.

**The Violet and Gold Rule.** Violet owns everyday interaction; gold brings focused energy to highlighted actions and labelled attention. Do not use either colour alone as a success, warning, or risk signal.

Body/supporting/placeholder text must meet 4.5:1. Large text, focus, and essential control boundaries need 3:1. Every status also has a label or icon.

## Typography

**Display and body font:** Schibsted Grotesk Variable, self-hosted through Fontsource; system sans fallbacks. One family avoids theatrical sports display type.

- **Wordmark:** uniform medium lowercase, 24px in the header, one baseline and one colour. Clear space at least half its cap height; link target at least 44px.
- **Display:** semibold, fluid up to the recorded maximum; sentence case, balanced, not a dashboard headline treatment.
- **Headline/title:** semibold, readable line height, negative tracking restrained.
- **Body:** regular, 16px base, 1.55 leading; continuous prose near 65–75ch.
- **Controls:** semibold. Google-branded controls retain Google's prescribed treatment.
- **Caption:** sentence case. Metadata is for supplementary information, never the only presentation of essential state.
- **Numerals:** tabular only for comparable values, times, and tables.

**The Continuous Word Rule.** Use Lineupkeep in prose and lineupkeep in the wordmark. The shared up is discoverable; no gap, uppercase UP, colour alternation, or extra logo badge. A commissioned slight weight change can be evaluated later; this foundation is uniform. Tracking never falls below -0.04em.

## Layout

Generous separation between tasks, tight grouping inside them. A four-pixel base rhythm with the recorded spacing steps supports familiar product layouts. Desktop can put controls beside a list; mobile stacks them in task order. Maximum application content width is 76rem; operational page content caps at 48rem so controls size to their content rather than to the viewport. On small screens the primary navigation occupies its own header row; signed-out visitors see no application navigation before sign-in.

Lists/tables—not repeated marketing cards—own teams and run history when those features are implemented. Shared alignment is the visual signature: wordmark, headings, labels, state text, and row rules sit on a disciplined baseline. No field grids, ornamental numbers, podiums, or trading-terminal clutter.

## Elevation & Depth

Flat by default. Tonal surfaces and 1px rules establish hierarchy. Use a border or a soft offset shadow, not both by default. Avoid halos and hard-offset block shadows. The current foundation needs no authored entrance animation; local state feedback is brief.

**The Honest Surface Rule.** A surface exists to group a task or establish hierarchy, not to make sparse content look substantial.

## Shapes

Gently softened corners: badge, control, and surface radii come from the frontmatter. Pills are for genuinely small controls, not every container. No tilted sheets, tape, ornamental clipping, or simulated physical objects.

## Components

### Home wordmark

[BrandLink](apps/web/src/browser/brand-ui/BrandLink.tsx) is a continuous lowercase home link, without a prefix monogram. Accessible name: Lineupkeep home. The small lk [favicon](apps/web/public/brand/lineupkeep-mark.svg) is a browser utility, not a second primary logo.

### Actions and navigation

Existing Button, ButtonLink, IconButton, NavLink, and TabLink retain native behavior and familiar selected/disabled/pending states. Minimum target 44px. Named Lucide icons only; icon-only controls need an accessible name. Focus is a visible 3px action ring with 3px separation.

Local feedback uses the sidecar's quick timing; honour reduced motion. Do not animate sections or delay content. Hover is not the only indication of actionability.

### Fields

TextField, TextArea, and SearchField keep persistent labels, visible boundaries, associated hints/errors, and a themed caret. Pending states keep accessible feedback. Error copy names the issue and recovery; placeholder text is not a label.

### Containers and metadata

Status metadata is labelled text, not a rank sticker. Reserve gold emphasis for highlighted calls to action; supporting state stays in ink tones without inventing another status palette. IntroPanel/Panel are occasional dark companion surfaces, not a site-wide card recipe. Do not derive the fantasy domain by renaming starter components.

### Operational states

Connection health, team automation, actionable period, and run outcome are explicit in team and run rows. Automation off, paused, reconnect required, unavailable, queued, checking, verified unchanged, verified updated, and needs reconciliation are distinct. Never flatten them into green/red or Done.

A pause is not a disable, expired connection is not lost enrollment, unavailable is not deleted, and sent is not verified. Paused rows name the rest of the fantasy day and show the resume time in the reader's locale. Reconnect-required rows retain enrollment and expose one explicit reconnect path.

### Teams and runs

Teams are a ruled list, not a grid of marketing cards. Each row carries the team name, one line of league context (sport, league, season), what the last check did and how long ago, and a tally of recent checks that changed the lineup. Status words appear only when something needs attention: a connection that needs a new sign-in, a sign-in in progress, or a team the provider no longer lists.

Lineup checks are one switch, optimistic and labelled for the team; pause and resume sit beside it as a quieter control. The switch keeps its confirmed state, shows a pending label while the write is in flight, and returns to the server's state with a message when the write is refused. The team detail keeps the same controls and the recent runs, folding consecutive checks that changed nothing into one expandable line while changed, blocked, failed, uncertain, and in-progress runs always stand alone. A run detail shows the target period, trigger, attempts, verified outcome, changes, and pending reason without exposing credentials, cookies, provider GUIDs, raw payloads, or raw errors.

### Connections and incidents

The connection surface links through the hosted browser only; the web UI has no local helper, pairing code, or password field. Each connection row names the provider, the number of teams it covers, when it was connected, and what its current status can do. A connection that needs a new sign-in reopens the same hosted browser session in place. The person never types a password here. One connection expiration opens one durable incident, and the paired action-required email uses a stable logical idempotency identity so retries cannot multiply reminders.

### Browser surfaces

Theme text selection, caret, scrollbar, focus, and underline offset from semantic roles. Dark is a full palette, not inversion. Respect reduced motion, keyboard order, landmarks, heading hierarchy, error associations, empty states, and long real-world names.

## Do's and Don'ts

### Do

- Do use semantic tokens and both complete themes.
- Do keep the wordmark continuous and uniform.
- Do distinguish verified, pending, and uncertain outcomes.
- Do label sample data and retained starter scaffolding honestly.
- Do preserve keyboard access, visible focus, and reduced motion.

### Don't

- Don't use LineUPkeep, LineUpKeep, arrows, trophies, shields, or AI decoration.
- Don't use gradient lettering, lime stickers, tilted paper, or simulated notebooks.
- Don't infer the fantasy domain by renaming starter-demo components.
- Don't use colour alone to communicate connection, automation, or risk.
- Don't claim live features, ownership, accuracy, or publication readiness without evidence.

[Brand notes](docs/brand/BRAND.md) owns naming/voice/placement. The [specimen](docs/brand/preview.html) illustrates this foundation; it is not a product prototype. This design does not authorize launch, waive the dependency blocker, or establish trademark/domain ownership.
