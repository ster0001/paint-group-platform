# Manual test — A3: floorplan upload

What changed: uploads now go straight to storage (signed URLs) instead of
through the server function, which was silently refusing anything over
~4.5 MB. iPhone HEIC photos are converted to JPEG on ingest so the plan
reader can actually read them. Uploads show progress, and failures say why.

## Steps — do these from your actual iPhone if you can (10 minutes)

1. Open **/wizard** on your phone, page 1.
2. **JPG**: upload a floorplan photo from your camera roll
   (e.g. "Leamington floorplan.png" / any of the Downloads plans).
   - ✅ Button shows "Uploading…", then "Checking the files…", then
     "✓ 1 file uploaded — reading in the background".
3. **HEIC**: take a fresh photo of a plan with the iPhone camera and upload
   it directly (don't screenshot it — we want a real HEIC).
   - ✅ Uploads and reads like the JPG did. This used to upload "fine" and
     then never price a single room.
4. **PDF**: upload a real multi-page plan PDF, ideally one over 5 MB — over
   4.5 MB is exactly the size that used to fail silently.
   - ✅ Uploads with progress; page count reflected after processing.
5. **Big file**: try a file over 25 MB (screen recording renamed .mov → will
   also be refused for type).
   - ✅ You get a plain-English refusal BEFORE it uploads, not a silent
     nothing.
6. **Forced failure**: turn on flight mode mid-upload of a big file.
   - ✅ A readable message appears ("didn't upload — check your connection"),
     and trying again works.
7. Finish the wizard run and confirm rooms priced from the uploaded plan.

Also worth a glance: several photos at once ("Uploading 2 of 3…" should
tick along), and the facade photo button on an exterior job (same new path).

## Root cause (for the record)

Three stacked problems: (1) every upload rode a multipart POST through the
serverless function, whose ~4.5 MB platform body cap refused real plans with
an error page the client couldn't parse; (2) the client's `res.json()` had no
guard, so that refusal became an unhandled exception — no message, nothing;
(3) HEIC passed validation and storage but the vision reader only accepts
JPEG/PNG/WEBP, so iPhone photos uploaded and then silently never read.
