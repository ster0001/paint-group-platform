# Wizard UI refresh — design documentation

The reference for building and maintaining the refreshed wizard: tokens, layout, components, pictures, motion, and where each old piece moved. The brief says *what* each screen shows; this says *what it is made of*. The mockup (`design/reference/estimator-wizard-redesign-mockup.html`) is the visual source of truth; class names in brackets below are the mockup's, so you can find each piece in its source.

Component names are suggestions. Where a component already exists, restyle it; do not create a second copy (`CLAUDE.md`: one component, a `mode` prop).

---

## 1. Tokens

All on `.wz` in `app/wizard/wizard.css`. Light theme only (Tom, 5 Oct 2026).

| Token | Value | Use |
|---|---|---|
| `--paint` | `#3BD8E9` | Primary button fill, progress stripe, range band, the one hero card. Never as text on white. |
| on `--paint` | `#03272D` | Text on primary buttons. |
| `--cyan` | `#0A7C8E` | Links, selected borders, ticks, icons, "checked" state. AA on white. |
| `--wash` / `--wash2` | `#DFF6FA` / `#BDEBF3` | Selected card and chip fill / its border. |
| `--amber`, wash, line | `#9A5F0A`, `#FCF3E0`, `#E5C078` | "Still to check" and notes that need attention. Only the open card carries an amber border. |
| `--emerald` | `#1F8A55` | "Saved", "Adds up to 100%", address accepted. |
| page / card / soft | `#F2F5F6` / `#FFFFFF` / `#E8EEF1` | Page, cards, control tracks. |
| line / line-strong | `#D5DDE2` / `#B4C0C8` | Borders. |
| ink / text / muted | `#0D161C` / `#16212A` / `#54626D` | Headings, body, hints. |

**Type.** Switzer for everything. Martian Mono for money, sizes and counts only. Body 17px. Hints 15–15.5px. Nothing below 13.5px. H1 `clamp(30px, 3.5vw, 46px)`, weight 600, tracking −0.035em. Inputs 16px or larger.

**Shape.** 16px radius on cards and fields; 22–26px on the picture, price and range cards; pills for buttons and chips. One soft shadow, used only on raised cards (picture, price, open room card, hero door).

**Hints and labels.** Sentence case, under the question. "Optional" is a small grey tag after the question. No capitals for emphasis.

**Breakpoints.** Two columns from 901px. One column at 900px and below. Content max-width 1,240px. Below 1,380px the step rail shows only the current label.

---

## 2. Shell

| Piece | Mockup | Notes |
|---|---|---|
| Header | `.top` | 64px desktop, 56px phone, sticky. Logo · step rail · phone number · chat icon · Save & book. Keeps `.wz-top`; in the editors it also keeps `.sc-freeze`. |
| Step rail | `.rail` | Built from `stepsFor()`. Numbered dots; done = tick. Compact (current label only) when there are more than six counted steps. Ends in "Your range" or "Booked". |
| Progress stripe | `.stripe` | 3px `--paint` line along the header's bottom edge. |
| Phone progress | `.mprog` | "Step 2 of 6 · The place" with a bar, under the header. |
| Step layout | `.stage` → `.pane` + `.side` | Left column max 640px. Right column 430px, sticky. On phones the picture card sits above the question; Job so far is hidden; Talk it through sits at the foot. |
| Step nav | `.nav`, `.why` | Back (text button) and Continue (primary pill) inside the left column. Fixed bottom bar on phones. Tapping Continue with something missing shakes it and shows one line saying what is missing. |

---

## 3. Controls

| Component | Mockup | Use | Keep these hooks |
|---|---|---|---|
| Option card | `.opt` | Pick one from a few (property type, scope, condition, segment). Selecting fills it with a wash, left to right. Tick badge on the right, never over the label. | `ql-*` ids (`ql-kind-*`, `ql-scope-*`, `ql-segment-*`) |
| Picture option card | `.opt.col` | Inside / Outside / Both, window types. Picture on top. | |
| Chip | `.chip` | Tick many (surfaces, rooms, materials, also-areas). Square tick box on the left. | `.wz-tile` |
| Segmented control | `.seg` | Pick one of two to five short answers (bedrooms, Yes/No, hours). | |
| Count row | `.crow` + `.stepper` | Label and hint on the left, stepper on the right (windows, doors, commercial counts). | `.wz-crow`, `*-plus`, `*-minus`, `*-n` |
| Follow-up box | `.follow` | A sub-question opened by an answer (pergola, open-plan area, visit-only note, extra prep). White, cyan left edge. | `ext-pergola-*`, `com-open`, `segment-visit-note` |
| Field | `.field`, `.field.big` | Label inside the box, 18px input. Big version has the pin icon (address). | `gate-*`, `talk-*` |
| Drop box | `.drop` | Upload a floorplan, add photos. Dashed border, icon, two lines. | `ql-plan-upload`, `.wz-photo-stub` |
| Question heading | `.q > h2` | 19px, weight 600. Hint below in muted 15.5px. | `.wz-qhead`, `.wz-kick`, `.wz-sub`, `.wz-step` |
| Tag | `.tag` | "Online, or we visit" / "We visit" on segment cards. | `.wz-segtag` |

Minimum tap target 48 × 48px for every control.

---

## 4. Pictures

Inline SVG, one component each, no library. Fixed 4:3 box (`.viz-art`) so nothing shifts when the picture changes. `aria-hidden`; never the only way an answer is shown. Each surface is its own shape with a data attribute; "painted" is a class that changes its fill.

| Picture | Shown on | Responds to |
|---|---|---|
| House (`#house`) | Address, Place, Space, Questions, Book; and as the paint preview on Outside and the outside details step | Property type (house, townhouse with neighbours, block, shop front, warehouse). Storeys: roof lifts, upper floor slides in. Inside: windows lit. On Outside: body, window frames, doors, fascias, gutters and downpipes, eaves each take a fresh coat when ticked; fences, deck, pergola, shed, wall and garage door appear when ticked; wall texture follows the material; wall tone follows the colour answer. |
| Room (`#room`) | Job, Condition, commercial Job, inside details step | Walls, ceiling and cornice, skirting, architraves, door, window frame each paint in when ticked. Condition step shows the room "today" with marks that step up from Good to Needs work. Last surface touched is outlined for two seconds and named in the caption. |
| Floor plan (`.plansvg`) | Rooms, commercial Areas, and the "Your home" card in the room editor | One block per room (or per kind of area). Dashed = left out. Amber = still to check. Cyan with a tick = checked. Tap a block to open that card. Replaced by the customer's real floorplan when there is one. |
| View from above (`.topsvg`) | Sides step, and the "Your home" card in the side-by-side editor | Four edges, street at the bottom. Thick cyan = painting / checked. Amber = still to check. Grey dashed = not painting. Tap an edge to open that side. |
| Warehouse (`#wh`) | Building, warehouse Job | Walls, roof underside, steel, roller door, personnel door, bollards, line marking, offices and mezzanine each paint in when ticked. Height label follows the answer. |

Caption under every picture: one sentence, changes with the step. Trade words are explained there ("Architraves: the timber frame around each door").

---

## 5. Range and checking

| Component | Mockup | Notes | Keep these hooks |
|---|---|---|---|
| Range card | `.rangecard`, `.bigrange` | 10px cyan left edge. Range in Martian Mono. GST line. "Based on…" sentence. | `reveal-range`, `reveal-restatement`, `reveal-kicker` |
| Accuracy pill | `.pill` | "Guide · within 30%" (amber) / "Detailed · within 6%" (cyan). The number alone sits in `range-width`. | `range-width`, `.sc-tier` |
| Ladder | `.ladder` | Bars of decreasing width. Home inside: Guide, Detailed, Confirmed. Outside, both, commercial: Guide, Detailed, then one sentence about the visit. An explanation, not a control. | `reveal-tiers` |
| Part ranges | `.parts` | Inside and Outside tiles on a "both" job. | `reveal-parts`, `reveal-part-interior`, `reveal-part-exterior` |
| Commercial note | `.cnote` | Amber box under the range on commercial jobs. | `reveal-commercial-note` |
| Door card | `.door`, `.door.heroD` | Icon tile, title, one line, arrow. Tighten my price is the one cyan card. | `door-tighten`, `door-speak`, `door-book`, `door-message`, `door-keep`, `.wz-doors` |
| Estimator strip | `.signoff` | Dark bar on the range screen: who confirms the price, phone button. | `estimator-strip` |
| What we'll do | `.wwd` | Two columns on desktop. Content unchanged. | `what-we-do`, `what-we-do-*` |
| Editor layout | `.ed` | Cards on the left, all one width. Sticky rail 410px on the right. | `.sc-freeze` on the header |
| Price card | `.price` | Range, pill, band, checklist, the two buttons. | `.sc-num`, `.sc-r`, `.sc-lbl`, `.il-prog`, `.sc-stick` (once, two buttons), `scope-finalise`, `scope-book` |
| Range band | `.band` | Track with a dashed outline of the starting guide range and a cyan bar for now. Bar animates when it narrows. | |
| Checklist | `.todo` | Questions, rooms or areas, sides, last checks, each with a count. | |
| "Your home" card | `.mapcard` | Floor plan and/or view from above, with a key. | `.pp-*` for the plan panel |
| Quick question | `.qq` | One at a time: picture, dots, "Closes about $X of your range", answers as pills, Skip for now. | `details-*`, `sides-q*`, `darklight-*` |
| Unit card | `.rc` | Accordion. Closed: number or tick, name, size, action. Open card has the amber border; checked cards a pale cyan border and a one-line summary; "not painting" a dashed border. | `.sc-rc[data-room]`, `.sd-card`, `.il-hd`, `.sd-hd`, `.sc-st` |
| Size question | `.sizeq` | To-scale rectangle, the question, Looks right / Adjust it (/ Not sure on a side). Adjust shows two steppers. Amber until answered, then cyan. | `.il-size`, `.il-first`, `side-dims-*` |
| Surface tile | `.tile` | Pictogram, label, tick box. Counted tiles widen to two columns when on and show a stepper and a small segmented control. | `.sc-tile`, `.sc-tl`, `.sd-tl`, `door-tile-*`, `window-tile-*` |
| Wall mix | `.mixbox`, `.mix` | One tile per material with 25 / 50 / 75 / 100% chips and a line that says whether they add to 100%. | `.sd-wall`, `.sd-wseg`, `.sd-wallsum`, `.sd-pcts` |
| Section head and jump links | `.sechead`, `.tabs` | "Both" jobs only. The chips scroll to a section; they never hide one. | |
| Phone range strip | `.mstrip` | Dark one-line strip under the header: range, accuracy, count, mini band. | |
| Action bar | `.dock` | Phone only: Book a time · Finalise my price. Same DOM node as the rail buttons. | `.sc-stick` |
| Toast | `.toast` | "Range narrowed by $230". Above the action bar on phones. | `.sc-toast`, `.sd-toast` |
| Sheet | (not drawn) | One pattern for Talk, Save & book, contact, reach, finalise prompt and chat: 480px panel from the right on desktop, bottom sheet on phones. | `talk-*`, `reach-*`, `prompt-*` |
| Booked / Sent | `.booked`, `.steps4`, `.how`, `.slots` | Tick, headline, one line, "What happens next", call line. | `brief-done-*`, `book-*` |

---

## 6. Motion

All of it answers something the customer just did. `prefers-reduced-motion: reduce` removes every item. Nothing loops.

| Trigger | Motion | Duration |
|---|---|---|
| Pick an option card | Wash fills left to right; tick pops in | 420ms |
| Tick a surface or element | Its shape changes fill; a roller sweeps once when walls go on | 700ms / 950ms |
| Tick an "other area" outside | It pops in beside the house | 450ms |
| Change storeys | Roof lifts, upper floor slides in | 600ms |
| Step change | Content rises 14px and fades in, staggered | 450ms |
| Range reveal | Numbers count up once; ladder bars grow | 1.1s |
| Confirm a room or side, answer a question | Band narrows; plan block or edge turns cyan; toast | 700ms |
| Incomplete confirm | The missing block shakes and the gap is named | 400ms |

---

## 7. Where each old piece went

| Today | After |
|---|---|
| Five dots beside the logo (`.wz-dots`) | The labelled step rail in the header. |
| "Step 1 of 6" floating mid-page (`.wz-steps`) | Phone progress row; on desktop the rail says it. |
| Dashed "Would you rather talk it through?" box (`.wz-rather`) | The Talk it through card in the right column (foot of the step on phones). Same three actions, same ids. |
| Full-width Continue bar on desktop | Continue inside the left column. Fixed bar on phones only. |
| Hints in capitals after the question (`.wz-opt`) | A sentence under the question; "Optional" as a small tag. |
| Floating "Chat with us" bubble | Icon button in the header (`wz-chat-bubble` keeps its id). |
| Editor's frozen stack: brand row, legend, estimator strip, range card | Slim header only. Range, accuracy and checklist move to the price card in the right rail; estimator to the rail card. On phones, the dark range strip. |
| "Orange = still to confirm · Blue = confirmed" legend line | The key under the "Your home" card. |
| Orange border on every room card | Amber only on the open card and on the number badge of unchecked cards. |
| Tiles in alphabetical order | Walls, Ceilings, Cornices, Doors, Windows, Skirting boards, Architraves, Balustrades. |
| Full-width bottom bar in the editor on desktop | The two buttons sit in the price card. |
| Three accuracy pills that look like tabs | The ladder, drawn as bars. |
| "Both" exterior embedded under the rooms with no signpost | Same stacked page, with a heading and two jump links. |

---

## 8. Rules that do not change

- Same questions, same option values, same payloads, same prices.
- Step order from `stepsFor()`; segment wording from the segment rows.
- No price in the DOM before the details step on residential jobs; none at all on visit-only paths.
- No points, badges, streaks, rewards or confetti. Guide, Detailed and Confirmed are accuracy labels.
- The estimator's name and the phone number come from records and Settings.
