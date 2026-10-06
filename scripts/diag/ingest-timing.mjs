// READ-MOSTLY diagnostic (30 Sep): time each step of the photo INGEST against
// the TEST project — stage a 67-byte PNG, then do exactly what
// app/api/wo/photos/route.ts PUT does: signed URL, Range fetch of 64 bytes,
// cancel the stream, download() fallback. Prints milliseconds per step.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(".env.test.local", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const svc = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const path = `wo/diag/${Date.now()}.png`;
const t = () => Date.now();
let s = t();
const up = await svc.storage.from("wo-photos").upload(path, PNG, { contentType: "image/png" });
console.log("stage upload", t() - s, "ms", up.error?.message ?? "ok");
s = t();
const { data: signed, error: sErr } = await svc.storage.from("wo-photos").createSignedUrl(path, 60);
console.log("createSignedUrl", t() - s, "ms", sErr?.message ?? "ok");
s = t();
const res = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-63" } });
console.log("range fetch headers", t() - s, "ms", "status", res.status, "len", res.headers.get("content-length"), "range", res.headers.get("content-range"));
s = t();
const reader = res.body.getReader();
let got = 0;
while (got < 64) { const { value, done } = await reader.read(); if (done) break; if (value) got += value.length; }
console.log("read", got, "bytes", t() - s, "ms");
s = t();
await reader.cancel().catch((e) => console.log("cancel threw", e.message));
console.log("cancel", t() - s, "ms");
s = t();
const dl = await svc.storage.from("wo-photos").download(path);
console.log("download()", t() - s, "ms", dl.error?.message ?? `${(await dl.data.arrayBuffer()).byteLength} bytes`);
await svc.storage.from("wo-photos").remove([path]);
console.log("cleaned");
