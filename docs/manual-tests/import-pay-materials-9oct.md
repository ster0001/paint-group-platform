# Manual test · filled handover jobs: contractor pay and materials budget (9 Oct 2026)

Branch `fix/import-contractor-amounts-9oct` · migration `20270250000000_import_set_scope_real_pay.sql`.

1. Paste the migration in the production SQL editor. The read-back row must be `true,true,true,true,true,true,false`; the `_prod_migrations` row is the proof.
2. `zsh /tmp/wo/fill.sh check` — for each job read the `contractor:` line (Pelmet 226 h × $65 = $14,690.00; Lonsdale 71.5 h × $65 = $4,647.50) and the `materials budget` (PaintScout's estimate), and `proves:` = the signed total. Nothing is written.
3. `zsh /tmp/wo/fill.sh run` — `ok` per job. `skip:variations` means the job has a live variation, and nothing was changed.
4. Open each estimate → **Revise scope**: the Margin box shows **Contractor (N hr)** at $65/h and **Materials cost** = PaintScout's figure. Change **Contractor rate ($/hr)** and save: the job's pay on the Schedule tray card follows.
5. **Projects → the job → Materials**: the budget shows PaintScout's estimate instead of $0.
