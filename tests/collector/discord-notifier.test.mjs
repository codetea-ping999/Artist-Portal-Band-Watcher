import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscordPayload, DiscordDeliveryError, postDiscordUpdate } from "../../supabase/functions/collect/discord-notifier.js";

const candidate = {
  event_type: "event_created",
  title: "An update with @everyone in its title",
  url: "https://example.test/events/1"
};

test("Discord payload disables mentions and has the expected content", () => {
  assert.deepEqual(buildDiscordPayload(candidate), {
    content: "**event_created**\nAn update with @everyone in its title\nhttps://example.test/events/1",
    allowed_mentions: { parse: [] }
  });
});

test("Discord notifier posts the candidate through an injected provider", async () => {
  let captured;
  await postDiscordUpdate("https://discord.test/webhook", candidate, {
    fetchImpl: async (url, request) => {
      captured = { url, request };
      return { ok: true, status: 204 };
    }
  });

  assert.equal(captured.url, "https://discord.test/webhook");
  assert.equal(captured.request.method, "POST");
  assert.deepEqual(JSON.parse(captured.request.body), buildDiscordPayload(candidate));
});

test("Discord notifier surfaces a provider error for retry tracking", async () => {
  await assert.rejects(
    () => postDiscordUpdate("https://discord.test/webhook", candidate, {
      fetchImpl: async () => ({ ok: false, status: 429 })
    }),
    (error) => error instanceof DiscordDeliveryError && error.retryable && /HTTP 429/.test(error.message)
  );

  await assert.rejects(
    () => postDiscordUpdate("https://discord.test/webhook", candidate, {
      fetchImpl: async () => ({ ok: false, status: 401 })
    }),
    (error) => error instanceof DiscordDeliveryError && !error.retryable
  );
});
