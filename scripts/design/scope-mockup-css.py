"""Port a design/reference mockup's <style> into a page stylesheet scoped under .pm.

    python3 scripts/design/scope-mockup-css.py <mockup.css> app/invoicing/payments/payments.css

Extract the CSS first (everything between the mockup's <style> tags) into <mockup.css>.
Every selector gets `.pm ` in front; :root becomes .pm; [data-theme="light"] becomes the
invoicing shell's `.invx[data-theme="light"] .pm`; the mockup-only chrome (.mockbar, .top,
.theme, html, body) is dropped; keyframes get a pm- prefix; button-styled controls that the
page renders as links (.views, .fchips, .quiet, .strip-h) match both. Regenerate rather than
hand-edit payments.css when the mockup moves.
"""
import re, sys
css = open(sys.argv[1]).read()
css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
DROP = {'.mockbar', '.top', '.theme', 'html', 'body'}
def scope_sel(sel):
    out = []
    for s in sel.split(','):
        s = s.strip()
        if not s: continue
        head = re.split(r'[\s:.>\[]', s.lstrip('.'), 1)[0]
        if any(s == d or s.startswith(d + ' ') or s.startswith(d + '.') or s.startswith(d + ':') or s.startswith(d+'{') for d in DROP):
            continue
        if s == ':root': out.append('.pm'); continue
        if s.startswith('[data-theme="light"]'): out.append('.invx[data-theme="light"] .pm' + s[len('[data-theme="light"]'):]); continue
        if s == '*': out.append('.pm, .pm *'); continue
        if s.startswith(':focus-visible'): out.append('.pm ' + s); continue
        out.append('.pm ' + s)
    return ', '.join(out)
def walk(text):
    res = []; i = 0
    while i < len(text):
        j = text.find('{', i)
        if j < 0: break
        head = text[i:j].strip()
        # find matching brace
        depth = 0; k = j
        while True:
            if text[k] == '{': depth += 1
            elif text[k] == '}':
                depth -= 1
                if depth == 0: break
            k += 1
        body = text[j+1:k]
        if head.startswith('@keyframes'):
            name = head.split()[1]
            res.append(f'@keyframes pm-{name}{{{body}}}')
        elif head.startswith('@media'):
            inner = walk(body)
            if inner.strip(): res.append(f'{head}{{{inner}}}')
        else:
            sel = scope_sel(head)
            if sel: res.append(f'{sel}{{{body.strip()}}}')
        i = k + 1
    return '\n'.join(res)
out = walk(css)
out = re.sub(r'animation:\s*glow\b', 'animation:pm-glow', out)
out = out.replace('.pm .wrap{', '.pm .pm-wrap{')
for cls in ('.views', '.fchips', '.quiet', '.strip-h', '.tabs'):
    out = out.replace(f'.pm {cls} button', f'.pm {cls} :is(button,a)')
out += '''
/* ---- port additions (not in the mockup) ---- */
/* The page itself carries the mockup's body rules; the shell (.invx) owns the header. */
.pm{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.4;-webkit-font-smoothing:antialiased;min-height:100vh}
/* Views, stages, blocks and filters are links (shareable query params, R §4.2), styled as the mockup's buttons. */
.pm a{color:inherit;text-decoration:none}
.pm a.led,.pm a.stg{cursor:pointer}
.pm .views a,.pm .fchips a,.pm .tabs a{display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
/* Step 7: the job panel as a whole page (/invoicing/job/[id]) — the drawer's width, centred. */
.pm .pm-jobpage{max-width:660px;margin:0 auto;padding-bottom:110px}
.pm .pm-jobpage .dh{position:static}
/* Step 8a: the aged-receivables bar under the Customers views (Tom, 13 Oct: kept from the old page). */
.pm .aged{margin-top:18px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.pm .aged h3{font-size:13px;font-weight:600;color:var(--text2)}
.pm .aged .bar{display:flex;height:10px;border-radius:5px;overflow:hidden;margin-top:10px;background:var(--line)}
.pm .aged .bar i{height:100%}
.pm .aged .keys{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-top:10px}
.pm .aged .keys div{font-size:12px;color:var(--mute)}
.pm .aged .keys b{display:block;font-family:var(--mono);font-size:13px;color:var(--text);font-weight:600;letter-spacing:-.04em}
@media (max-width:560px){.pm .aged .keys{grid-template-columns:repeat(3,minmax(0,1fr))}}
/* Step 8a: Activity (§6.7) — one line per event, views folded. */
.pm .feed{background:var(--card);border:1px solid var(--line);border-radius:12px;margin-top:14px}
.pm .feed .fl{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:10px;align-items:start;padding:11px 14px;border-top:1px solid var(--line)}
.pm .feed .fl:first-child{border-top:0}
.pm .feed .dot{width:8px;height:8px;border-radius:50%;margin-top:6px;background:var(--mute)}
.pm .feed .dot.pay{background:var(--green)}.pm .feed .dot.send{background:var(--pri)}.pm .feed .dot.draft{background:var(--orange)}.pm .feed .dot.stop{background:var(--red)}
.pm .feed b{font-weight:600;font-size:14px}
.pm .feed small{display:block;font-size:12.5px;color:var(--text2);margin-top:2px;overflow-wrap:anywhere}
.pm .feed .fd{font-size:12px;color:var(--mute);white-space:nowrap}
/* Step 8b: the Contractors rows' terms chips, wrapping buttons, and the ask-first cap box. */
.pm .prow .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:5px}
.pm .prow .p4{flex-wrap:wrap}
.pm .prow .p4 .cust-amt{display:flex;align-items:center;gap:6px;height:38px;padding:0 10px;border:1px solid var(--line2);border-radius:8px;background:var(--card)}
.pm .prow .p4 .cust-amt input{width:92px;border:0;background:none;color:var(--text);font-family:var(--mono);font-size:13px;outline:none}
/* Step 7: Add cost's category chips — the methods buttons, wrapping. */
.pm .chipset{display:flex;flex-wrap:wrap;gap:6px}
.pm .chipset button{height:36px;padding:0 12px;border:1px solid var(--line2);border-radius:18px;font-size:13px;color:var(--text2)}
.pm .chipset button.on{border-color:var(--pri);color:var(--cyan-t);background:var(--cyan-bg)}
.pm .job .addr a:hover,.pm .tr .a a:hover{text-decoration:underline}'''
header = '''/* Payments — the merged page (payments-merge brief §4.2, Step 2).
   Ported 1:1 from design/reference/payments-merged-v3-mockup.html, scoped to
   .pm inside the invoicing shell (.invx), which owns the header and the
   light/dark switch. Regenerate rather than hand-edit where the mockup moves. */
'''
open(sys.argv[2], 'w').write(header + out + '\n')
print(len(out.splitlines()))
