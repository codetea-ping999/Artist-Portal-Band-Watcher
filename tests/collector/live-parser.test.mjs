import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseLiveEvents } from "../../supabase/functions/collect/live-parser.js";

const fixture = await readFile(new URL("../fixtures/live-page.html", import.meta.url), "utf8");
const streamingFixture = await readFile(new URL("../fixtures/live-page-streaming.html", import.meta.url), "utf8");
const source = {
  id: "source-live",
  artist_id: "artist-9mm",
  artist_name: "9mm Parabellum Bullet",
  source_type: "live",
  label: "Official Live Schedule",
  url: "https://www.9mm.jp/live.php"
};

test("parses multiple event formats from the selected artist section", () => {
  const events = parseLiveEvents(source, fixture);

  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map(({ title, venue, city, status }) => ({ title, venue, city, status })),
    [
      {
        title: "9mm Parabellum Bullet presents「カオスの百年 vol.22」",
        venue: "昭和女子大学人見記念講堂",
        city: "東京",
        status: "on_sale"
      },
      {
        title: "秋のスペシャルライブ",
        venue: "新宿LOFT",
        city: "東京",
        status: "sold_out"
      },
      {
        title: "公演中止になったイベント",
        venue: "大阪城ホール",
        city: "大阪",
        status: "cancelled"
      },
      {
        title: "先行受付ライブ",
        venue: "横浜アリーナ",
        city: "神奈川",
        status: "presale"
      }
    ]
  );

  assert.equal(events[0].starts_at, "2026-09-06T08:30:00.000Z");
  assert.equal(events[0].doors_at, "2026-09-06T07:30:00.000Z");
  assert.equal(events[0].ticket_url, "https://eplus.jp/9mm/");
  assert.equal(events[1].starts_at, "2026-10-01T10:00:00.000Z");
  assert.equal(events[1].doors_at, "2026-10-01T09:00:00.000Z");
  assert.equal(events[2].starts_at, "2026-11-02T15:00:00.000Z");
  assert.equal(events[2].doors_at, null);
  assert.equal(events[3].starts_at, "2026-12-05T09:30:00.000Z");
  assert.equal(events[3].doors_at, null);
  assert.equal(events[3].ticket_url, "https://example.com/presale");
  assert.equal(events.some((event) => event.title.includes("別アーティスト")), false);
});

test("returns deterministic, deduplicated events for repeated collection", () => {
  const firstRun = parseLiveEvents(source, fixture);
  const secondRun = parseLiveEvents(source, fixture);

  assert.deepEqual(secondRun, firstRun);
  assert.equal(new Set(firstRun.map((event) => `${event.title}:${event.starts_at}`)).size, firstRun.length);
  assert.ok(firstRun.every((event) => event.raw_hash));
});

test("does not import a different artist section when the target is absent", () => {
  assert.deepEqual(parseLiveEvents({ ...source, artist_name: "Unknown Artist" }, fixture), []);
  const unlabeledMultiArtistPage = `
    <h2>Alpha Band</h2><h3>2026/09/01 Alpha Hall [Tokyo]</h3><p>Event Name: Alpha Show</p><p>START 19:00</p>
    <h2>Beta Band</h2><h3>2026/09/02 Beta Hall [Tokyo]</h3><p>Event Name: Beta Show</p><p>START 19:00</p>
  `;
  assert.deepEqual(parseLiveEvents({ ...source, artist_name: "Missing Band" }, unlabeledMultiArtistPage), []);
});

test("handles empty and malformed pages without throwing", () => {
  assert.deepEqual(parseLiveEvents(source, ""), []);
  assert.deepEqual(parseLiveEvents(source, "<div><h3>2026/99/99 [東京]</h3><p>壊れたHTML"), []);
  assert.deepEqual(parseLiveEvents(source, "<a name=9mm>9mm Parabellum Bullet</a><div>情報不足</div>"), []);
  assert.deepEqual(
    parseLiveEvents(
      source,
      "<a name=9mm>9mm Parabellum Bullet</a><div>2026/12/31 東京ドーム [東京]</div><div>ラベルのない説明文</div>"
    ),
    []
  );
});

test("parses yearless multi-day online events and preserves multiple ticket URLs", () => {
  const events = parseLiveEvents({ ...source, artist_name: "Target Artist", config: { default_year: 2027 } }, streamingFixture);

  assert.equal(events.length, 3);
  assert.deepEqual(events.slice(0, 2).map((event) => event.starts_at), [
    "2027-09-20T11:00:00.000Z",
    "2027-09-21T11:00:00.000Z"
  ]);
  assert.equal(events[2].starts_at, "2027-09-22T20:00:00.000Z");
  assert.ok(events.every((event) => event.venue === "Online / 配信"));
  assert.ok(events.slice(0, 2).every((event) => event.ticket_url === "https://tickets.example/one"));
  assert.ok(events.slice(0, 2).every((event) => event.notes.includes("https://tickets.example/two")));
  assert.equal(events.some((event) => event.title.includes("MUST NOT IMPORT")), false);
});
