# Manual test · project search in PC Command + contacts search (1 Oct 2026)

Branch `feat/search-bars-1oct`. No migration.

## PC Command · find a project
1. Sign in as staff, open **Projects** (`/pc`). A search box sits in the top bar between the date and the theme button. Open **Schedule**, **Project Progress**, **Updates**, **Timesheets** — the same box on each.
2. Type part of a job's reference (e.g. `WO-`), then part of an address, then a customer's surname, then an estimate number (`3096`). Each drops a list of jobs with their stage; open jobs first, closed ones greyed.
3. Click a hit → the job's console page opens and the box is empty again. Press **⌘K** anywhere → the box has focus. Press **/** on the page (not in a field) → same.
4. Type `zzqx` → "No project matches".
5. In a private window as a contractor: `/pc/api/search?q=WO` returns 403.

## Contacts · search
1. **Contacts** in the sidebar. The box is top right.
2. Type a surname → the list narrows without pressing anything. Type a company, an email, a suburb → each narrows. Type a phone with no spaces → the spaced number still matches.
3. **Clear** → full list. The address bar carries `?q=` while a search is on.
4. Type `zzqx` → "No contact matches".
