import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const xlsxPath = process.argv[2] || './ratecard.xlsx';
const VERSION = Number(process.argv[3] || 7);
const wb = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' });

const tab = (name) => {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: null });
  const headers = rows[0];
  const idx = (h) => headers.indexOf(h);
  return { rows: rows.slice(1), idx };
};

// ---- SQL value helpers ----
const q = (v) => v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`;
const num = (v) => (v == null || v === '') ? 'null' : Number(v);
const cents = (v) => (v == null || v === '') ? 'null' : Math.round(Number(v) * 100);
const bool = (v) => v ? 'true' : 'false';
const jsonb = (obj) => `'${JSON.stringify(obj).replace(/'/g, "''")}'::jsonb`;
const out = [];
const w = (s) => out.push(s);

w(`-- =====================================================================`);
w(`-- Paint Group — Rate Card v${VERSION} seed`);
w(`-- GENERATED from Paint_Group_Rate_Card_v${VERSION}.xlsx — do not hand-edit.`);
w(`-- Safe to re-run: reference data is upserted; the versioned rate card is`);
w(`-- inserted only once (existing versions and their quotes are never touched).`);
w(`-- =====================================================================`);

// ---------- Settings ----------
{
  const { rows, idx } = tab('Settings');
  const iK = idx('Setting'), iV = idx('Value'), iU = idx('Unit'), iN = idx('Notes');
  const data = rows.filter(r => r[iV] != null && typeof r[iV] === 'number');
  w(`\n-- Settings (${data.length})`);
  w(`insert into public.settings (key, value) values`);
  w(data.map(r => `  (${q(r[iK])}, ${jsonb({ value: r[iV], unit: r[iU], notes: r[iN] })})`).join(',\n') + ';'
      .replace(/;$/, '\non conflict (key) do update set value = excluded.value, updated_at = now();'));
}

// ---------- Modifiers ----------
{
  const { rows, idx } = tab('Modifiers');
  const iId = idx('ID'), iG = idx('Group'), iL = idx('Label'), iA = idx('Applies To'), iM = idx('Multiplier'), iS = idx('Source');
  const data = rows.filter(r => typeof r[iM] === 'number' && r[iG]);
  w(`\n-- Modifiers (${data.length})`);
  w(`insert into public.modifiers (code, group_name, label, applies_to, multiplier, source, active) values`);
  w(data.map(r => `  (${q(r[iId])}, ${q(r[iG])}, ${q(r[iL])}, ${q(r[iA])}, ${num(r[iM])}, ${q(r[iS])}, true)`).join(',\n'));
  w(`on conflict (code) do update set group_name=excluded.group_name, label=excluded.label, applies_to=excluded.applies_to, multiplier=excluded.multiplier, source=excluded.source, active=true;`);
}

// ---------- Colour Rules ----------
{
  const { rows, idx } = tab('Colour Rules');
  const iId = idx('ID'), iC = idx('Colour Change'), iCo = idx('Coats'), iU = idx('Undercoat'), iN = idx('Notes');
  const data = rows.filter(r => typeof r[iCo] === 'number');
  w(`\n-- Colour rules (${data.length})`);
  w(`insert into public.colour_rules (code, label, coats, undercoat, notes) values`);
  w(data.map(r => `  (${q(r[iId])}, ${q(r[iC])}, ${num(r[iCo])}, ${q(r[iU])}, ${q(r[iN])})`).join(',\n'));
  w(`on conflict (code) do update set label=excluded.label, coats=excluded.coats, undercoat=excluded.undercoat, notes=excluded.notes;`);
}

// ---------- Products ----------
{
  const { rows, idx } = tab('Products');
  const iN = idx('Product Name'), iT = idx('Type'), iC = idx('Coverage m²/L'), iP = idx('Price $/L'), iW = idx('Wastage %');
  const data = rows.filter(r => r[iT] === 'Interior' || r[iT] === 'Exterior');
  w(`\n-- Products (${data.length})`);
  w(`insert into public.products (name, type, coverage, price_per_litre, wastage_pct, effective_from) values`);
  w(data.map(r => `  (${q(r[iN])}, ${q(r[iT])}, ${num(r[iC])}, ${cents(r[iP])}, ${num(r[iW])}, current_date)`).join(',\n'));
  w(`on conflict (name) do update set type=excluded.type, coverage=excluded.coverage, price_per_litre=excluded.price_per_litre, wastage_pct=excluded.wastage_pct, effective_from=excluded.effective_from;`);
}

// ---------- Sundries ----------
{
  const { rows, idx } = tab('Sundries');
  const iId = idx('ID'), iIt = idx('Item'), iB = idx('Basis'), iC = idx('Cost $ / %');
  const data = rows.filter(r => typeof r[iC] === 'number' && String(r[iId] || '').startsWith('SUN'));
  w(`\n-- Sundries (${data.length})`);
  w(`insert into public.sundries (code, item, basis, cost_cents) values`);
  w(data.map(r => `  (${q(r[iId])}, ${q(r[iIt])}, ${q(r[iB])}, ${cents(r[iC])})`).join(',\n'));
  w(`on conflict (code) do update set item=excluded.item, basis=excluded.basis, cost_cents=excluded.cost_cents;`);
}

// ---------- Commercial Rates ----------
{
  const { rows, idx } = tab('Commercial Rates');
  const iS = idx('Sector'), iL = idx('$ / m2 Low'), iH = idx('$ / m2 High'), iN = idx('Basis / Notes');
  const data = rows.filter(r => typeof r[iL] === 'number');
  w(`\n-- Commercial rates (${data.length})`);
  w(`insert into public.commercial_rates (sector, low_cents_per_m2, high_cents_per_m2, notes) values`);
  w(data.map(r => `  (${q(r[iS])}, ${cents(r[iL])}, ${cents(r[iH])}, ${q(r[iN])})`).join(',\n'));
  w(`on conflict (sector) do update set low_cents_per_m2=excluded.low_cents_per_m2, high_cents_per_m2=excluded.high_cents_per_m2, notes=excluded.notes;`);
}

// ---------- Area Names ----------
{
  const { rows, idx } = tab('Area Names');
  const iA = idx('Area'), iT = idx('Type');
  const data = rows.filter(r => r[iT] === 'Interior' || r[iT] === 'Exterior');
  w(`\n-- Area names (${data.length})`);
  w(`insert into public.area_names (area, type) values`);
  w(data.map(r => `  (${q(r[iA])}, ${q(String(r[iT]).toLowerCase())})`).join(',\n'));
  w(`on conflict (area) do update set type=excluded.type;`);
}

// ---------- Line Items ----------
{
  const { rows, idx } = tab('Line Items');
  const iN = idx('Name'), iT = idx('Type'), iP = idx('Pricing Method');
  const data = rows.filter(r => r[iP] != null && (r[iT] === 'Interior' || r[iT] === 'Exterior'));
  w(`\n-- Line items / templates (${data.length})`);
  w(`insert into public.line_items (name, type, pricing_method) values`);
  w(data.map(r => `  (${q(r[iN])}, ${q(r[iT])}, ${q(r[iP])})`).join(',\n'));
  w(`on conflict (name) do update set type=excluded.type, pricing_method=excluded.pricing_method;`);
}

// ---------- Production Rates -> versioned rate card ----------
{
  const { rows, idx } = tab('Production Rates');
  const iId = idx('ID'), iCat = idx('Category'), iSub = idx('Sub Category'), iU = idx('Unit'),
        i1 = idx('Rate 1 Coat'), i2 = idx('Rate 2 Coats'), i3 = idx('Rate 3 Coats'),
        iDc = idx('Default Coats'), iCh = idx('Charge-Out $/hr'), iDp = idx('Default Product'),
        iMpl = idx('Metres Per Litre'), iLipc = idx('Litres Per Item Per Coat');
  const data = rows.filter(r => (r[iCat] === 'Interior' || r[iCat] === 'Exterior') && r[iU]);
  w(`\n-- Rate card v${VERSION} + ${data.length} rate items (versioned; inserted once)`);
  w(`do $$`);
  w(`declare v_card uuid;`);
  w(`begin`);
  w(`  if exists (select 1 from public.rate_cards where version = ${VERSION}) then`);
  w(`    raise notice 'Rate card v${VERSION} already present — skipping rate_items.';`);
  w(`  else`);
  w(`    update public.rate_cards set is_active = false where is_active;`);
  w(`    insert into public.rate_cards (version, effective_from, is_active) values (${VERSION}, current_date, true) returning id into v_card;`);
  w(`    insert into public.rate_items (rate_card_id, code, category, sub_category, unit, rate_1_coat, rate_2_coat, rate_3_coat, default_coats, charge_out_cents, default_product, metres_per_litre, litres_per_item_per_coat) values`);
  w(data.map(r => `      (v_card, ${q(r[iId])}, ${q(r[iCat])}, ${q(r[iSub])}, ${q(r[iU])}, ${num(r[i1])}, ${num(r[i2])}, ${num(r[i3])}, ${num(r[iDc])}, ${cents(r[iCh])}, ${q(r[iDp])}, ${num(r[iMpl])}, ${num(r[iLipc])})`).join(',\n') + ';');
  w(`  end if;`);
  w(`end $$;`);
}

process.stdout.write(out.join('\n') + '\n');
