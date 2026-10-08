# Wizard UI refresh — test hooks to preserve

**Every class and test id below is used by an existing e2e spec. The refresh may move a hook to a new element that does the same job. It may not remove one.** Generated from `e2e/customer-journey/**` and the wizard and visit specs at `main` `ed5a94c` (9 Oct 2026): 73 spec files, 78 class hooks, 551 test ids.

Regenerate in every preflight and report any difference:

    grep -rhoE "\.(wz|sc|sd|il|pp|as)-[A-Za-z0-9_-]+" e2e/customer-journey e2e/*wizard* e2e/visit-* | sort | uniq -c | sort -rn
    grep -rhoE "getByTestId\([^)]+" e2e/customer-journey e2e/*wizard* e2e/visit-* | sort | uniq -c | sort -rn

## 1. Contracts the new layout must keep

These are assertions, not just selectors. Each one constrains where something can go.

| Hook | What the spec asserts | What that means for the new layout |
|---|---|---|
| `.sc-freeze` | Still pinned at the top (y ≤ 1) after scrolling to the bottom; under a third of a 780px phone screen | The slim header keeps this class. On phones the header plus the range strip stay under 260px. |
| `.sc-num`, `.il-prog` | Visible at any scroll position | The price card in the sticky right rail (desktop) and the range strip (phone) carry them. |
| `data-testid="range-width"` | Text parses to a number once `±` and `%` are removed; never widens when a room is confirmed | Keep the number alone in this element. Put "within" outside it. |
| `.il-prog` | Contains `N OF M` with the combined count on a "both" job | One combined count. Keep the text contract or change the spec under ⚑ 7 and list it. |
| `.sc-stick button` | Exactly two buttons | One container, once in the DOM. Move it with CSS between the rail and the phone bar. Do not render a second copy. |
| `.sc-rc[data-room]`, `.sd-card`, `[data-side="last"]` | Room cards, side cards and the last-checks block are all present on a "both" job | The "both" editor is stacked. Jump links scroll; they never unmount a section. |
| `.sc-grouplbl`, "Whole house" button | Count is 0 | The old element-grouped exterior editor stays deleted. |
| `.sc-lbl b` | Reads "Your range" | Keep the label. |
| `.sc-r`, `reveal-range` | Match the money-range pattern | Keep the en dash format the specs expect; the count-up must settle on the exact figures. |
| `wz-chat-bubble` | Opens chat | Keep the id on the new header button. |
| `estimator-strip` | Present on range and editor | Keep the id on the estimator card in its new place. |
| `ql-book`, `ql-call`, `ql-message` | Reachable on every step before the range | The Talk it through card carries them. |
| `door-tighten`, `door-speak`, `door-book`, `door-message`, `door-keep` | Present or absent by the existing rules | Restyle only. |

## 2. Class hooks (78)

### Quick steps, range, shell (`app/wizard`)

| Class | Uses | Seen in (up to four specs) |
|---|---|---|
| `.wz-err` | 14 | assistant-trade.spec.ts, doors-tiles-steppers.spec.ts, draft-versioning.spec.ts, drive.ts |
| `.wz-qhead` | 10 | assistant-trade.spec.ts, doors-tiles-steppers.spec.ts, exterior-path.spec.ts, parity-mechanics.spec.ts |
| `.wz-confirmonsite` | 5 | assistant-trade.spec.ts, commercial-segments.spec.ts, commercial-warehouse.spec.ts, document-model.spec.ts |
| `.wz-crow` | 5 | assistant-trade.spec.ts, drive.ts, exterior-path.spec.ts, simpler-form.spec.ts |
| `.wz-step` | 4 | exterior-path.spec.ts |
| `.wz-tile` | 3 | exterior-path.spec.ts, tom-batch-7sep.spec.ts |
| `.wz-kick` | 3 | tom-batch-7sep.spec.ts |
| `.wz-planframe` | 3 | plan-panel.spec.ts |
| `.wz-photo-stub` | 2 | tom-batch-7sep.spec.ts |
| `.wz-photonote` | 1 | document-model.spec.ts |
| `.wz-doors` | 1 | gate.spec.ts |
| `.wz-segtag` | 1 | commercial-segments.spec.ts |
| `.wz-wrap` | 1 | exterior-path.spec.ts |
| `.wz-quick` | 1 | outside-commercial.spec.ts |
| `.wz-sub` | 1 | outside-commercial.spec.ts |

### Room editor (`ScopeEditor`)

| Class | Uses | Seen in (up to four specs) |
|---|---|---|
| `.sc-rc` | 43 | both-stacked.spec.ts, dark-to-light.spec.ts, doors-tiles-steppers.spec.ts, finalise-gate.spec.ts |
| `.sc-r` | 36 | assistant-trade.spec.ts, assistant.spec.ts, both-stacked.spec.ts, dark-to-light.spec.ts |
| `.sc-tl` | 18 | doors-tiles-steppers.spec.ts, interior-addpanel.spec.ts, interior-loop.spec.ts, openings-priced.spec.ts |
| `.sc-st` | 11 | doors-tiles-steppers.spec.ts, interior-addpanel.spec.ts, openings-priced.spec.ts, parity-mechanics.spec.ts |
| `.sc-freeze` | 5 | finalise-gate.spec.ts, human-moments.spec.ts, r5-editor.spec.ts, tom-batch-7sep.spec.ts |
| `.sc-stick` | 3 | both-stacked.spec.ts, finalise-gate.spec.ts, tom-batch-7sep.spec.ts |
| `.sc-tile` | 2 | room-spots.spec.ts |
| `.sc-tier` | 2 | finalise-gate.spec.ts, tom-batch-7sep.spec.ts |
| `.sc-hd` | 2 | dark-to-light.spec.ts |
| `.sc-x` | 2 | response-contract.spec.ts |
| `.sc-num` | 2 | r5-editor.spec.ts |
| `.sc-styleconfirm` | 2 | openings-priced.spec.ts |
| `.sc-spots` | 1 | document-model.spec.ts |
| `.sc-tgrid` | 1 | doors-tiles-steppers.spec.ts |
| `.sc-btn` | 1 | reach-and-chat.spec.ts |
| `.sc-grouplbl` | 1 | both-stacked.spec.ts |
| `.sc-lbl` | 1 | r5-editor.spec.ts |
| `.sc-toast` | 1 | interior-loop.spec.ts |
| `.sc-details` | 1 | finalise-gate.spec.ts |

### Side-by-side editor (`SidesEditor`)

| Class | Uses | Seen in (up to four specs) |
|---|---|---|
| `.sd-saving` | 33 | dark-to-light.spec.ts, document-model.spec.ts, doors-tiles-steppers.spec.ts, drive.ts |
| `.sd-hd` | 20 | exterior-batch-15sep.spec.ts, parity-mechanics.spec.ts, sides-editor.spec.ts, tom-batch-8sep.spec.ts |
| `.sd-card` | 18 | both-stacked.spec.ts, doors-tiles-steppers.spec.ts, exterior-batch-15sep.spec.ts, parity-mechanics.spec.ts |
| `.sd-tl` | 8 | doors-tiles-steppers.spec.ts, parity-mechanics.spec.ts, sides-editor.spec.ts, tom-batch-8sep.spec.ts |
| `.sd-toast` | 8 | parity-mechanics.spec.ts, sides-editor.spec.ts, tom-batch-8sep.spec.ts |
| `.sd-prog` | 7 | exterior-batch-15sep.spec.ts, sides-editor.spec.ts, tom-batch-7sep.spec.ts |
| `.sd-wseg` | 6 | doors-tiles-steppers.spec.ts, interior-addpanel.spec.ts, parity-mechanics.spec.ts, response-contract.spec.ts |
| `.sd-wall` | 6 | sides-editor.spec.ts |
| `.sd-addpanel` | 4 | doors-tiles-steppers.spec.ts, interior-addpanel.spec.ts, r5-editor.spec.ts, tom-batch-8sep.spec.ts |
| `.sd-cta` | 4 | doors-tiles-steppers.spec.ts, sides-editor.spec.ts, tom-batch-8sep.spec.ts |
| `.sd-wallsum` | 4 | sides-editor.spec.ts |
| `.sd-pc` | 4 | sides-editor.spec.ts |
| `.sd-mseg` | 3 | tom-batch-8sep.spec.ts |
| `.sd-x` | 2 | doors-tiles-steppers.spec.ts |
| `.sd-tlname` | 2 | doors-tiles-steppers.spec.ts |
| `.sd-range` | 2 | sides-editor.spec.ts, tom-batch-7sep.spec.ts |
| `.sd-pcts` | 1 | doors-tiles-steppers.spec.ts |
| `.sd-pill` | 1 | tom-batch-7sep.spec.ts |
| `.sd-visual` | 1 | parity-mechanics.spec.ts |
| `.sd-st` | 1 | parity-mechanics.spec.ts |
| `.sd-geo` | 1 | exterior-batch-15sep.spec.ts |
| `.sd-addsurf` | 1 | r5-editor.spec.ts |
| `.sd-gl` | 1 | r5-editor.spec.ts |
| `.sd-chip` | 1 | r5-editor.spec.ts |
| `.sd-mrow` | 1 | self-sign.spec.ts |
| `.sd-tier` | 1 | sides-editor.spec.ts |

### Confirm loop (shared by both editors)

| Class | Uses | Seen in (up to four specs) |
|---|---|---|
| `.il-cup` | 21 | finalise-gate.spec.ts, interior-loop.spec.ts, ladder.spec.ts, parity-mechanics.spec.ts |
| `.il-confirm` | 15 | finalise-gate.spec.ts, interior-loop.spec.ts, ladder.spec.ts, parity-mechanics.spec.ts |
| `.il-hd` | 13 | finalise-gate.spec.ts, human-moments.spec.ts, interior-loop.spec.ts, range-envelope.spec.ts |
| `.il-cta` | 6 | both-stacked.spec.ts, holding-and-honest-defaults.spec.ts, interior-loop.spec.ts, ladder.spec.ts |
| `.il-prog` | 6 | both-stacked.spec.ts, holding-and-honest-defaults.spec.ts, interior-loop.spec.ts, r5-editor.spec.ts |
| `.il-size` | 6 | interior-loop.spec.ts, tom-batch-7oct.spec.ts |
| `.il-q` | 4 | doors-tiles-steppers.spec.ts, parity-mechanics.spec.ts |
| `.il-first` | 3 | doors-tiles-steppers.spec.ts, room-card.spec.ts, self-sign.spec.ts |
| `.il-pill` | 2 | r5-editor.spec.ts |
| `.il-kick` | 1 | doors-tiles-steppers.spec.ts |
| `.il-wingroups` | 1 | parity-mechanics.spec.ts |
| `.il-custom` | 1 | interior-loop.spec.ts |

### Plan and photos panel

| Class | Uses | Seen in (up to four specs) |
|---|---|---|
| `.pp-full` | 4 | plan-panel.spec.ts |
| `.pp-sheet` | 4 | plan-panel.spec.ts, r5-editor.spec.ts |
| `.pp-peek` | 2 | plan-panel.spec.ts, r5-editor.spec.ts |
| `.pp-side` | 1 | plan-panel.spec.ts |

### Assistant

| Class | Uses | Seen in (up to four specs) |
|---|---|---|
| `.as-typing` | 1 | assistant.spec.ts |
| `.as-disclosure` | 1 | assistant.spec.ts |

## 3. Test ids (551)

Most used first. Ids ending in a hyphen are prefixes built at run time (for example `spot-open-<n>`).

`ql-next` (35) · `reveal-range` (32) · `door-tighten` (28) · `reveal-restatement` (14) · `check-dw-ok` (12) · `reveal-assumed-toggle` (11) · `estimator-strip` (11) · `ql-kind-house` (11) · `reveal` (10) · `scope-book` (9) · `details-card` (9) · `what-we-do` (9) · `ql-excl-none` (9) · `door-book` (8) · `missed-card` (8) · `spot-open-` (8) · `ql-scope-whole` (8) · `scope-finalise` (8) · `check-rooms-ok` (7) · `ql-jobtype-exterior` (7) · `ql-bedrooms-2` (7) · `ql-kind-commercial` (7) · `ql-error` (7) · `ql-changing-` (7) · `ql-bedrooms-4` (6) · `what-we-do-trims` (6) · `reach-strip` (6) · `ql-condition-good` (6) · `wz-resume` (6) · `ql-ext-el-body` (6) · `visit-calendar` (5) · `suburb-status` (5) · `ql-plan-upload` (5) · `entry-upload` (5) · `details-cornices` (5) · `details-paint-base` (5) · `room-extras-` (5) · `side-dims-front` (5) · `ql-excl-windows` (5) · `ext-pergola-confirm` (5) · `ql-condition-wear` (5) · `door-keep` (5) · `finish-send_for_confirmation` (5) · `sides-q-settled` (5) · `visit-request` (4) · `zone-search` (4) · `visit-block` (4) · `check-rooms-add` (4) · `wz-chat-bubble` (4) · `spot-tag-` (4) · `access-cleared-yes` (4) · `door-tile-panel` (4) · `window-tile-casement` (4) · `reach-callback` (4) · `ext-pergola-length` (4) · `ext-pergola-width` (4) · `entry-describe` (4) · `talk-name` (4) · `talk-email` (4) · `talk-mobile` (4) · `talk-go` (4) · `reveal-kicker` (4) · `darklight-ceilings-some-note` (4) · `segment-visit-note` (4) · `door-speak` (4) · `sides-q` (4) · `ql-both-self` (4) · `sides-q-done` (4) · `sched-est-` (3) · `visit-schedule-msg` (3) · `zone-check-go` (3) · `zone-check-result` (3) · `mode-visit` (3) · `visit-search` (3) · `visit-save` (3) · `visit-hit` (3) · `wz-chat-text` (3) · `details-trims-current` (3) · `reach-visit` (3) · `reach-phone` (3) · `reach-phone-change` (3) · `assistant-widget-launch` (3) · `assistant-widget-panel` (3) · `ql-excl` (3) · `ql-excl-line` (3) · `darklight-doors` (3) · `ql-add-room-open` (3) · `ql-add-room-name` (3) · `ext-side-all` (3) · `cta-hint` (3) · `gate-name` (3) · `gate-email` (3) · `gate-mobile` (3) · `finish-fix_online` (3) · `staff-dock` (3) · `add-room-go` (3) · `ql-segment-office` (3) · `com-count-offices-n` (3) · `ql-changing-walls` (3) · `as-range` (3) · `visit-details` (3) · `ql-book` (3) · `talk-sent` (3) · `ql-ext-el-fascias` (3) · `sides-q-step-rot` (3) · `rot-where` (3) · `sides-last` (3) · `sides-last-step-sweep` (3) · `side-assumed-back` (3) · `side-dims-back` (3) · `range-width` (3) · `ql-jobtype-` (3) · `reveal-keep-email` (3) · `extra-note` (3) · `visit-book` (3) · `visit-code-input` (3) · `visit-confirm` (3) · `ql-damage-photo-count` (3) · `sent-status` (3) · `ql-scope-walls_ceilings` (3) · `ql-changing-trims` (3) · `save-and-book-pill` (3) · `ql-jobtype-interior` (3) · `ext-body-q` (3) · `ext-windows-q` (3) · `ql-ext-el-windows` (3) · `ql-ext-el-doors` (3) · `finish` (2) · `finish-book_visit` (2) · `contact-card` (2) · `contact-phone` (2) · `contact-send` (2) · `finish-requested` (2) · `sched-empty` (2) · `sched-day-1` (2) · `slot-zone-1` (2) · `slot-no-zones` (2) · `rules-save` (2) · `rules-msg` (2) · `suburb-mordialloc-3195` (2) · `zone-check-suburb` (2) · `visit-zones-msg` (2) · `unmapped-` (2) · `tray-job` (2) · `hold-block` (2) · `holding-send` (2) · `holding-sent` (2) · `reveal-assumed-hazards` (2) · `assumed-bedrooms` (2) · `assumed-storeys` (2) · `spot-extent-` (2) · `spot-list-` (2) · `access-cleared-no` (2) · `access-stairwell` (2) · `access-stairwell-yes` (2) · `access-parking` (2) · `access-parking-drive` (2) · `missed-card-settled` (2) · `missed-card-change-access-cleared` (2) · `missed-card-done` (2) · `spot-photo-` (2) · `details-card-step-trims_current` (2) · `what-we-do-note-trims` (2) · `room-wallpaper-` (2) · `room-feature-walls-` (2) · `room-extras-note-` (2) · `side-rename-left` (2) · `side-note-text-front` (2) · `wz-chat-panel` (2) · `sp-msg-assistant` (2) · `ql-bold-which` (2) · `ql-bold-yes` (2) · `ql-changing-ceilings` (2) · `ql-bold-which-walls` (2) · `darklight-walls` (2) · `ql-add-room-go` (2) · `ql-room-added-1` (2) · `estimates-search-empty` (2) · `ext-fence` (2) · `ext-fence-metres` (2) · `describe-job` (2) · `estimator-name` (2) · `finalise-prompt` (2) · `talk-sheet` (2) · `gate-sessions` (2) · `ql-segment-retail` (2) · `book-done` (2) · `wz-chat-send` (2) · `systems-card` (2) · `darklight-card` (2) · `darklight-ceilings-some` (2) · `ql-segment-warehouse` (2) · `wh-height-6` (2) · `wh-count-rollerDoors-n` (2) · `wh-surf-walls` (2) · `wh-materials-q` (2) · `reveal-assumed-height` (2) · `ql-segment-strata` (2) · `com-open` (2) · `reveal-commercial-note` (2) · `reveal-assumed-open` (2) · `as-cta` (2) · `as-msg-assistant` (2) · `visit-message` (2) · `visit-name` (2) · `visit-email` (2) · `visit-mobile` (2) · `visit-details-go` (2) · `ql-talk` (2) · `ql-message` (2) · `ql-ext-mat-weatherboards` (2) · `ql-ext-colour-new` (2) · `sides-which` (2) · `sides-q-step-rotWhere` (2) · `check-sweep-ok` (2) · `reveal-keep-send` (2) · `reveal-kept` (2) · `door-tile-` (2) · `extras-card` (2) · `extra-colour-help` (2) · `extra-note-save` (2) · `visit-time` (2) · `visit-code` (2) · `visit-done` (2) · `ql-needs-work` (2) · `ql-condition-needs_work` (2) · `com-photo-input` (2) · `reveal-prep-check` (2) · `tier-chip` (2) · `ql-changing-windows` (2) · `save-and-book-done` (2) · `ql-jobtype-both` (2) · `ql-storeys-double` (2) · `sides-q-change-rot` (2) · `ql-ext-sep-pergola` (2) · `ext-pergola-q` (2) · `ext-door-count` (2) · `ext-win-n` (2) · `ext-door-n` (2) · `ql-ext-access-lift` (2) · `tier-next` (2) · `visit-calendar-state` (1) · `wizard-pill-` (1) · `wizard-line-` (1) · `journey-drawer` (1) · `journey-bucket` (1) · `journey-steps` (1) · `dropped-this-week` (1) · `dropped-group` (1) · `dropped-row` (1) · `contact-callback` (1) · `finish-error` (1) · `who-chips` (1) · `estimate-pill-` (1) · `sched-load-standard` (1) · `sched-total-` (1) · `total-n` (1) · `slot-1-660` (1) · `sched-day-5` (1) · `slot-5-750` (1) · `sched-add-time` (1) · `sched-add` (1) · `booking-rules` (1) · `rules-windowDays` (1) · `rules-holiday-new` (1) · `rules-holiday-add` (1) · `rules-holidays` (1) · `rules-visitMinutes` (1) · `visit-zones` (1) · `visit-zones-load-error` (1) · `suburb-glen-waverley-3150` (1) · `suburb-wheelers-hill-3150` (1) · `suburb-parkdale-3195` (1) · `suburb-mornington-3931` (1) · `suburb-far-edge` (1) · `zone-check-postcode` (1) · `empty-drag-dates` (1) · `visit-picked` (1) · `visit-note` (1) · `visit-detail` (1) · `visit-remove` (1) · `mode-hold` (1) · `hold-job` (1) · `hold-note` (1) · `hold-save` (1) · `hold-detail` (1) · `hold-book` (1) · `hold-release` (1) · `tray-search` (1) · `booking-dates` (1) · `drop-hold` (1) · `lane` (1) · `holding-page` (1) · `add-room-type-wc` (1) · `wz-describe` (1) · `wz-describe-text` (1) · `wz-describe-go` (1) · `wz-describe-reply` (1) · `assumed-jobType` (1) · `room-spots-` (1) · `access-cleared` (1) · `access-pets` (1) · `access-floors` (1) · `access-lift` (1) · `missed-card-change-access-stairwell` (1) · `reveal-assumed-trims` (1) · `reveal-open-trims` (1) · `what-we-do-doors` (1) · `details-trims-check` (1) · `size-confirm-` (1) · `size-confirm-change-` (1) · `size-confirm-ok-` (1) · `side-rename-open-left` (1) · `side-note-front` (1) · `side-note-save-front` (1) · `reach-call` (1) · `reach-hours` (1) · `reach-phone-known` (1) · `wz-chat-log` (1) · `sp-input` (1) · `sp-send` (1) · `sp-person` (1) · `support` (1) · `sp-msg-user` (1) · `ql-excl-done` (1) · `ql-bold-which-` (1) · `ql-bold-which-ceilings` (1) · `ql-add-room-type-bedroom` (1) · `estimates-search-input` (1) · `estimate-customer` (1) · `estimates-search` (1) · `estimates-search-clear` (1) · `ql-add-room-type-dining` (1) · `ql-room-added-0` (1) · `ql-add-room-kind` (1) · `ext-target-house` (1) · `ext-target-fence` (1) · `ext-target-shed` (1) · `ext-target-pergola` (1) · `ext-cladding-` (1) · `ext-cladding-brick` (1) · `ext-element-doors` (1) · `ext-side-front` (1) · `ext-shed` (1) · `ext-shed-cladding` (1) · `ext-pergola` (1) · `customer-photos-panel` (1) · `photos-sign-off` (1) · `builder-save` (1) · `portal-unsubmitted-estimate` (1) · `reveal-tiers` (1) · `finish-tiers` (1) · `offer-not_sures` (1) · `offer-measure` (1) · `offer-damage` (1) · `gate-marketing` (1) · `funnel-gate` (1) · `funnel-gate-details_first` (1) · `funnel-gate-range_first` (1) · `ql-plan-done` (1) · `com-count-floor-n` (1) · `com-count-boh-n` (1) · `reach-send` (1) · `reach-slot` (1) · `reach-book` (1) · `wz-chat-assistant` (1) · `dock-row` (1) · `dock-claim` (1) · `dock-msg-system` (1) · `dock-input` (1) · `dock-send` (1) · `wz-chat-staff` (1) · `dock-minimise` (1) · `dock-pill` (1) · `darklight-some-walls` (1) · `darklight-ceilings-row` (1) · `darklight-ceilings-all` (1) · `spot-panel-` (1) · `add-room-name` (1) · `add-room-kind` (1) · `size-form-` (1) · `size-length-` (1) · `size-width-` (1) · `size-height-` (1) · `size-save-` (1) · `details-height` (1) · `ql-plan-reading-panel` (1) · `ql-plan-reading` (1) · `ql-plan-preview` (1) · `wh-area-1000` (1) · `wh-count-personnelDoors-n` (1) · `wh-count-offices-n` (1) · `wh-mat-` (1) · `wh-surf-roof` (1) · `wh-count-rollerDoors-plus` (1) · `wh-surf-` (1) · `wh-surf-offices` (1) · `wh-area-2500` (1) · `wh-mat-precast` (1) · `wh-rack-some` (1) · `wh-op-yes` (1) · `com-surf` (1) · `com-occ` (1) · `reveal-assumed-racking` (1) · `wh-mat-sheeting` (1) · `wh-lift-yes` (1) · `ql-segment-` (1) · `ql-cpart-interior` (1) · `com-count-open-n` (1) · `com-count-meeting-n` (1) · `com-ceil-tiles` (1) · `com-height` (1) · `com-count-offices-plus` (1) · `com-count-offices-minus` (1) · `com-surf-walls` (1) · `com-hours-business` (1) · `com-occ-vacant` (1) · `com-hours-after` (1) · `reveal-assumed-hours` (1) · `reveal-flag` (1) · `ql-segment-health` (1) · `com-kind-aged` (1) · `com-count-rooms-n` (1) · `com-kind-hospital` (1) · `ql-segment-school` (1) · `com-height-6` (1) · `com-height-9` (1) · `com-hours-holidays` (1) · `as-chips` (1) · `chat-it` (1) · `visit-day-1` (1) · `visit-day-3` (1) · `visit-part-morning` (1) · `visit-request-send` (1) · `visit-request-sent` (1) · `visit-message-go` (1) · `visit-message-text` (1) · `visit-message-send` (1) · `talk-address` (1) · `talk-note` (1) · `talk-close` (1) · `talk-message` (1) · `talk-send` (1) · `door-message` (1) · `request-prefs` (1) · `request-slot` (1) · `request-done` (1) · `request-answered` (1) · `request-due` (1) · `ql-ext-storeys-` (1) · `ql-ext-side-` (1) · `sides-q-step-cond` (1) · `side-delete-front` (1) · `sides-q-step-peeling` (1) · `peeling-photo-label` (1) · `peeling-sides` (1) · `sides-last-settled` (1) · `side-assumed-front` (1) · `side-assumed-left` (1) · `book-steps` (1) · `book-slot` (1) · `book-email` (1) · `book-name` (1) · `book-phone` (1) · `brief-done` (1) · `brief-sub` (1) · `brief-what` (1) · `brief-what-stairwells` (1) · `brief-opt-timing-before-the-next-meeting` (1) · `brief-date-input` (1) · `brief-notes` (1) · `brief-done-line` (1) · `ql-segment-shopfront` (1) · `brief-date` (1) · `brief-opt-where-is-it-shopping-centre` (1) · `spot-reading-` (1) · `reveal-assumed-link-rooms` (1) · `strip-actions` (1) · `strip-visit` (1) · `add-room-type-hallway` (1) · `ql-kind-` (1) · `ql-bedrooms-` (1) · `ql-storeys-` (1) · `ql-scope-` (1) · `ql-condition-` (1) · `ql-occupied-` (1) · `ql-prep-check` (1) · `ql-damage-note` (1) · `ql-damage-photos-clear` (1) · `visit-none-suit` (1) · `visit-tighten` (1) · `visit-summary` (1) · `visit-hold-clock` (1) · `visit-error` (1) · `finish-fixed` (1) · `sent` (1) · `sent-steps` (1) · `sent-saved` (1) · `sent-who` (1) · `waiting-row-` (1) · `ql-scope-trims_doors` (1) · `ql-excl-walls` (1) · `desk-check` (1) · `desk-check-verdict` (1) · `desk-check-promise` (1) · `desk-check-band` (1) · `sab-email` (1) · `sab-call` (1) · `assisted-banner` (1) · `ql-both` (1) · `ql-both-book` (1) · `save-and-book` (1) · `sab-close` (1) · `reveal-part-interior` (1) · `reveal-part-exterior` (1) · `ql-bedrooms-3` (1) · `ql-back` (1) · `wz-start-again` (1) · `ql-scope-some_rooms` (1) · `ql-rooms-none` (1) · `side-dims-left` (1) · `side-delete-right` (1) · `sides-q-change-cond` (1) · `sides-q-change-acc` (1) · `ql-bedrooms` (1) · `ql-storeys` (1) · `ql-ext-el-` (1) · `ql-ext-sep-` (1) · `ql-ext-storeys` (1) · `ql-ext-mat-` (1) · `ext-lift-note` (1) · `ql-ext-access-none` (1) · `ql-ext-win-` (1) · `ql-ext-condition` (1) · `reveal-assumed` (1) · `reveal-assumed-windows` (1) · `human-line` (1) · `prompt-answer` (1) · `prompt-book` (1) · `book-page` (1) · `book-back` (1) · `details-card-settled` (1) · `access-stairwell-no` (1) · `all-done-banner` (1) · `wz-entry` (1) · `reveal-assumed-rooms` (1) · `last-change` (1) · `ql-changing` (1) · `what-we-do-walls` (1) · `contact-visit` (1) · `contact-when` (1)
