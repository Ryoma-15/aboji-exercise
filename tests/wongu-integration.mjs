import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));
const RealDate = globalThis.Date;
let fakeNow = RealDate.parse("2026-10-09T03:00:00Z");
class FakeDate extends RealDate {
  constructor(...args) { super(...(args.length ? args : [fakeNow])); }
  static now() { return fakeNow; }
}
globalThis.Date = FakeDate;

const workerSource = await readFile(join(ROOT, "_worker.js"), "utf8");
const worker = (await import(`data:text/javascript;base64,${Buffer.from(workerSource).toString("base64")}`)).default;

class D1Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() { return this.db.prepare(this.sql).get(...this.args) || null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() {
    const result = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(result.changes || 0) } };
  }
}
class D1Database {
  constructor() { this.db = new DatabaseSync(":memory:"); }
  prepare(sql) { return new D1Statement(this.db, sql); }
  exec(sql) { this.db.exec(sql); }
}

const REG_DB = new D1Database();
REG_DB.exec("PRAGMA foreign_keys=ON;");
REG_DB.exec(await readFile(join(ROOT, "en-schema.sql"), "utf8"));
REG_DB.exec(await readFile(join(ROOT, "en-120-schema.sql"), "utf8"));

const tokenA = "A".repeat(43);
const tokenB = "B".repeat(43);
const hash = value => createHash("sha256").update(value).digest("base64url");
REG_DB.db.prepare(`INSERT INTO en_registrations
  (id,email,full_name,country,time_zone,status,created_at,reviewed_at)
  VALUES(?,?,?,?,?,'approved',1,1)`).run("11111111-1111-4111-8111-111111111111","member-a@example.test","Member A","Japan","Asia/Tokyo");
REG_DB.db.prepare(`INSERT INTO en_registrations
  (id,email,full_name,country,time_zone,status,created_at,reviewed_at)
  VALUES(?,?,?,?,?,'approved',1,1)`).run("22222222-2222-4222-8222-222222222222","member-b@example.test","Member B","United States","America/New_York");
REG_DB.db.prepare("INSERT INTO en_sessions(token_hash,registration_id,expires_at) VALUES(?,?,?)").run(hash(tokenA),"11111111-1111-4111-8111-111111111111",4102444800);
REG_DB.db.prepare("INSERT INTO en_sessions(token_hash,registration_id,expires_at) VALUES(?,?,?)").run(hash(tokenB),"22222222-2222-4222-8222-222222222222",4102444800);

const ASSETS = {
  async fetch(request) {
    const path = new URL(request.url).pathname.replace(/^\/+/, "");
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) return new Response("Not found", { status: 404 });
    try { return new Response(await readFile(file), { status: 200 }); }
    catch (_) { return new Response("Not found", { status: 404 }); }
  }
};
const env = {
  REG_DB,
  ASSETS,
  EN_120_START_DATE: "2026-10-10",
  EN_ZOOM_URL: "https://example.test/morning-6"
};

function setNow(iso) { fakeNow = RealDate.parse(iso); }
function request(path, token, init = {}) {
  const headers = new Headers(init.headers || {});
  if (token) headers.set("Cookie", `__Host-aboji_en_session=${token}`);
  return new Request(`https://aboji.test${path}`, { ...init, headers });
}
async function call(path, token, init) {
  return worker.fetch(request(path, token, init), env, { waitUntil() {} });
}
async function body(response) { return response.json(); }
function postInit(payload, origin = "https://aboji.test") {
  return { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(payload) };
}

test("schema is additive and contains all four Wongu tables", () => {
  const names = REG_DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'en_120_%' ORDER BY name").all().map(row => row.name);
  assert.deepEqual(names, ["en_120_body_checks","en_120_checklist","en_120_events","en_120_visits"]);
  assert.equal(REG_DB.db.prepare("SELECT COUNT(*) n FROM en_registrations").get().n, 2);
});

test("member page and Wongu API reject an unauthenticated visitor", async () => {
  const page = await call("/en/members", null);
  assert.equal(page.status, 302);
  assert.equal(new URL(page.headers.get("location")).pathname, "/en/");
  const api = await call("/api/en/120", null);
  assert.equal(api.status, 401);
});

test("October 9 is pre-start and does not create a visit", async () => {
  setNow("2026-10-09T03:00:00Z");
  const response = await call("/api/en/120", tokenA);
  assert.equal(response.status, 200);
  const data = await body(response);
  assert.equal(data.currentDay, 0);
  assert.equal(data.practiceDays, 0);
  assert.equal(REG_DB.db.prepare("SELECT COUNT(*) n FROM en_120_visits WHERE registration_id=?").get("11111111-1111-4111-8111-111111111111").n, 0);
});

test("October 10 records one visit per member-local day and never duplicates", async () => {
  setNow("2026-10-10T03:00:00Z");
  const first = await body(await call("/api/en/120", tokenA));
  const second = await body(await call("/api/en/120", tokenA));
  assert.equal(first.currentDay, 1);
  assert.equal(second.practiceDays, 1);
  assert.equal(REG_DB.db.prepare("SELECT COUNT(*) n FROM en_120_visits WHERE registration_id=?").get("11111111-1111-4111-8111-111111111111").n, 1);

  const bBeforeMidnight = await body(await call("/api/en/120", tokenB));
  assert.equal(bBeforeMidnight.localDate, "2026-10-09");
  assert.equal(bBeforeMidnight.practiceDays, 0);
  setNow("2026-10-10T16:00:00Z");
  const bAfterMidnight = await body(await call("/api/en/120", tokenB));
  assert.equal(bAfterMidnight.localDate, "2026-10-10");
  assert.equal(bAfterMidnight.practiceDays, 1);
});

test("day boundaries are 40, 80, 120 and stop recording after the challenge", async () => {
  for (const [iso, expected] of [
    ["2026-11-18T03:00:00Z", 40],
    ["2026-12-28T03:00:00Z", 80],
    ["2027-02-06T03:00:00Z", 120]
  ]) {
    setNow(iso);
    assert.equal((await body(await call("/api/en/120", tokenA))).currentDay, expected);
  }
  const before = REG_DB.db.prepare("SELECT COUNT(*) n FROM en_120_visits WHERE registration_id=?").get("11111111-1111-4111-8111-111111111111").n;
  setNow("2027-02-07T03:00:00Z");
  const after = await body(await call("/api/en/120", tokenA));
  assert.equal(after.currentDay, 121);
  assert.equal(REG_DB.db.prepare("SELECT COUNT(*) n FROM en_120_visits WHERE registration_id=?").get("11111111-1111-4111-8111-111111111111").n, before);
});

test("body notes are stored in D1 and isolated by member", async () => {
  setNow("2026-10-10T03:00:00Z");
  const crossOrigin = await call("/api/en/120", tokenA, postInit({ action:"add-item", text:"Lower back tightness" }, "https://evil.test"));
  assert.equal(crossOrigin.status, 403);

  const added = await body(await call("/api/en/120", tokenA, postInit({ action:"add-item", text:"Lower back tightness" })));
  assert.equal(added.checklist.length, 1);
  assert.equal(added.checklist[0].text, "Lower back tightness");
  const memberB = await body(await call("/api/en/120", tokenB));
  assert.equal(memberB.checklist.length, 0);

  const check = await body(await call("/api/en/120", tokenA, postInit({ action:"body-check", answers:[{ key:"back", yes:true, detail:"After sitting", severity:2 }] })));
  assert.equal(check.milestones["1"].milestone_day, 1);
  await call("/api/en/120", tokenA, postInit({ action:"body-check", answers:[{ key:"back", yes:true, detail:"Improving", severity:1 }] }));
  assert.equal(REG_DB.db.prepare("SELECT COUNT(*) n FROM en_120_body_checks WHERE registration_id=? AND milestone_day=1").get("11111111-1111-4111-8111-111111111111").n, 1);

  const recordId = check.milestones["1"].id;
  const stolen = await call("/api/en/120", tokenB, postInit({ action:"body-check-detail", id:recordId }));
  assert.equal(stolen.status, 404);
  const own = await call("/api/en/120", tokenA, postInit({ action:"body-check-detail", id:recordId }));
  assert.equal(own.status, 200);
});

test("existing member, Zoom, news and production-only UI contracts remain connected", async () => {
  const member = await body(await call("/api/en/member", tokenA));
  assert.equal(member.name, "Member A");
  assert.equal(member.zoomUrl, "https://example.test/morning-6");
  const news = await call("/en/news", null);
  assert.equal(news.status, 200);

  const html = await readFile(join(ROOT,"en/members.html"),"utf8");
  assert.match(html, /\/api\/en\/videos/);
  assert.match(html, /\/media\/latest-video/);
  assert.match(html, /href="\/en\/news"/);
  assert.doesNotMatch(html, /I practiced today|manual increment|Auto Play|Reset Progress/i);
  for (const width of [390,375,360]) assert.match(html, new RegExp(`max-width:${width === 390 ? "620" : "620"}px`));
});

test.after(() => { globalThis.Date = RealDate; });
