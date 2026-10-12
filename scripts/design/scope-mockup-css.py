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
for cls in ('.views', '.fchips', '.quiet', '.strip-h'):
    out = out.replace(f'.pm {cls} button', f'.pm {cls} :is(button,a)')
out += '''
/* ---- port additions (not in the mockup) ---- */
/* The page itself carries the mockup's body rules; the shell (.invx) owns the header. */
.pm{background:var(--bg);color:var(--text);font-family:var(--sans);font-size:15px;line-height:1.4;-webkit-font-smoothing:antialiased;min-height:100vh}
/* Views, stages, blocks and filters are links (shareable query params, R §4.2), styled as the mockup's buttons. */
.pm a{color:inherit;text-decoration:none}
.pm a.led,.pm a.stg{cursor:pointer}
.pm .views a,.pm .fchips a{display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.pm .job .addr a:hover,.pm .tr .a a:hover{text-decoration:underline}'''
header = '''/* Payments — the merged page (payments-merge brief §4.2, Step 2).
   Ported 1:1 from design/reference/payments-merged-v3-mockup.html, scoped to
   .pm inside the invoicing shell (.invx), which owns the header and the
   light/dark switch. Regenerate rather than hand-edit where the mockup moves. */
'''
open(sys.argv[2], 'w').write(header + out + '\n')
print(len(out.splitlines()))
