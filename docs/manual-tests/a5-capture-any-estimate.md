# Manual test — A5: capture opens wizard (and builder) estimates

What changed: capture now opens rooms from ANY estimate — wizard-drafted,
plan-read or hand-built — instead of showing dead cards. Saving a room from
capture no longer wipes builder-only detail (products, colours, custom lines).

## Steps (10 minutes)

1. Create an estimate through **/wizard** (a quick no-plan 3-bed run is fine,
   leave ceiling height as "not sure"). Open it in the builder, then hit
   **Capture detail**.
2. ✅ The height prompt appears PRE-FILLED (2.4 m) — confirm it. If you made
   a double-storey run, both Ground and First should be listed, not just
   ground.
3. ✅ Every room card shows "AI-drafted — confirm as you walk" and OPENS when
   tapped (they used to look tappable and do nothing).
4. Open "Bed 1", change the door count, hit **Next room** → open the builder.
   - ✅ The change is there, the totals moved.
5. **Parity check**: note the total. Undo the edit in the builder (set door
   count back). Then make the same edit in the BUILDER instead. The total
   should land on exactly the same number as step 4 gave.
6. **Builder-detail check**: in the builder, set a product + colour on a
   room's walls and add a custom line item to that room. Re-open the room in
   capture, change something small (e.g. coats), save.
   - ✅ Product, colour and the custom line are all still there.
7. **Exterior**: on a wizard exterior estimate, open an "Exterior - Front"
   card in capture — it should open with the exterior tile set (used to be
   the error "No scope rules exist for a \"exterior\"").
8. A recommitted room's old "confirm this room" items should disappear from
   the review list in the wizard editor.
