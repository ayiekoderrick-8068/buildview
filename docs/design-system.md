# Design system

**Reference note:** the BuildView AI reference image mentioned in the brief was not available to the implementation
session, so the layout was built from its written description (dark premium UI, dominant viewport, left tools,
right properties, bottom strip, Build/Design/Experience navigation, Save Project / Render). Compare against the
image and adjust spacing/colour tokens below.

## Tokens (`apps/web/src/index.css`)

| Token | Value | Use |
| --- | --- | --- |
| `--bv-bg` | `#0b0e12` | app background |
| `--bv-surface-0..3` | `#0f1319` → `#252d38` | inset wells, panels, raised controls |
| `--bv-border` | `#242b35` | hairlines |
| `--bv-text / -dim / -faint` | `#eceff3 / #a2adbb / #6c7788` | text hierarchy (all ≥ 4.5:1 on panels except *faint*, used for hints only) |
| `--bv-accent` | `#d9ae62` | selection, primary action, active tab |
| `--bv-ok / -warn / -danger` | `#62c58b / #e8b04a / #ef6b5f` | save state and banners |

Selection feedback in the 3D scene uses a warm highlight (`#f0c070`) - translucent overlay + outline on walls,
outline box on furniture - so painted colours are never tinted permanently.

## Layout

Top bar (56 px) · tool rail + tool panel (left) · viewport (flexible, dominant) · properties (336 px) · bottom strip.
Below `lg` the panels stack and a notice explains that phone/tablet is limited to orbit/select/review.

## Components (`packages/ui`)

Button, IconButton, Section, Slider (with explicit disabled reason), Segmented (radio group), Swatch, Toggle,
EmptyState. Icons: `lucide-react` only. Motion: 150-180 ms fades/transitions, disabled under
`prefers-reduced-motion`. Focus: 2 px accent outline on every interactive control.

## Honesty rules for controls

A control that does nothing for the current state is **disabled with a reason** (e.g. *Metalness* for plain paint,
*Texture scale* unless the Plaster finish is chosen), and unavailable product areas (Build, Experience, Décor,
Exterior, Walkthrough, Alternatives, Render) are visibly disabled and labelled as coming later.
