// Vertragstest für KV-Adapter (read/write mit ifNew/ifMatch, list, remove, readBin/writeBin). Gilt für Memory, Blobs und MySQL.
import assert from "node:assert/strict";

export async function runContract(store, label, prefix = `contract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}/`) {
  const k = (s) => prefix + s;
  assert.equal(await store.read(k("a")), null, "unbekannter Schlüssel => null");
  assert.equal(await store.write(k("a"), { n: 1, s: "Grüezi ✓" }, { ifNew: true }), true, "ifNew legt an");
  assert.equal(await store.write(k("a"), { n: 2 }, { ifNew: true }), false, "ifNew auf vorhandenem Schlüssel => false");
  const r1 = await store.read(k("a"));
  assert.deepEqual(r1.value, { n: 1, s: "Grüezi ✓" });
  assert.ok(r1.etag);
  assert.equal(await store.write(k("a"), { n: 2 }, { ifMatch: "falsch" }), false, "ifMatch mit falschem etag => false");
  assert.equal(await store.write(k("zz"), { n: 1 }, { ifMatch: "x" }), false, "ifMatch auf fehlendem Schlüssel => false");
  assert.equal(await store.write(k("a"), { n: 2 }, { ifMatch: r1.etag }), true);
  assert.equal(await store.write(k("a"), { n: 3 }, { ifMatch: r1.etag }), false, "altes etag ist ungültig");
  const r2 = await store.read(k("a"));
  assert.deepEqual(r2.value, { n: 2 });
  assert.notEqual(r2.etag, r1.etag);
  assert.equal(await store.write(k("a"), { n: 4 }), true, "unbedingtes Schreiben");
  // gleichzeitiges Schreiben: genau einer gewinnt
  const cur = await store.read(k("a"));
  const res = await Promise.all([1, 2, 3, 4].map((i) => store.write(k("a"), { n: 10 + i }, { ifMatch: cur.etag })));
  assert.equal(res.filter(Boolean).length, 1, "genau ein gleichzeitiger Schreiber gewinnt");
  await store.write(k("b/1"), { x: 1 });
  await store.write(k("b/2"), { x: 2 });
  await store.write(k("b_c"), { x: 3 });
  const l = (await store.list(k("b/"))).sort();
  assert.deepEqual(l, [k("b/1"), k("b/2")], "list nach Präfix (Sonderzeichen _ und % sind wörtlich)");
  assert.equal((await store.list(k("%"))).length, 0);
  assert.equal((await store.list(prefix)).length, 4);
  const bin = Buffer.from([0, 1, 2, 255, 254, 0x25, 0x50]);
  assert.equal(await store.readBin(k("fbin/x")), null);
  await store.writeBin(k("fbin/x"), bin);
  assert.ok(bin.equals(await store.readBin(k("fbin/x"))), "Binärdaten bleiben byte-genau");
  await store.remove(k("a"));
  assert.equal(await store.read(k("a")), null);
  await store.remove(k("a")); // idempotent
  await store.remove(k("fbin/x"));
  for (const key of await store.list(prefix)) await store.remove(key);
  assert.equal((await store.list(prefix)).length, 0);
  console.log(`ok  KV-Vertrag: ${label}`);
}
