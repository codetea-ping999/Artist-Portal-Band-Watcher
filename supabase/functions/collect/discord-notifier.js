export function buildDiscordPayload(candidate) {
  return {
    content: `**${candidate.event_type}**\n${candidate.title}\n${candidate.url}`.slice(0, 1900),
    // Do not permit an update title or source content to trigger a mention.
    allowed_mentions: { parse: [] }
  };
}

export class DiscordDeliveryError extends Error {
  constructor(message, { retryable = false } = {}) {
    super(message);
    this.name = "DiscordDeliveryError";
    this.retryable = retryable;
  }
}

export async function postDiscordUpdate(
  webhookUrl,
  candidate,
  { fetchImpl = fetch, timeoutMs = 12_000 } = {}
) {
  const response = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(buildDiscordPayload(candidate)),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new DiscordDeliveryError(`Discord webhook returned HTTP ${response.status}`, {
      retryable: response.status === 429 || response.status >= 500
    });
  }
}
