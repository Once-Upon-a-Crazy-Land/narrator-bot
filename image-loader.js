import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

// Attachment IDs are snowflakes generated near the source message's ID.
// Fetch a bounded window and match the exact attachment, never a nearby image.
export async function recoverDiscordAttachment(url, rest) {
  const match = url.pathname.match(/^\/attachments\/(\d+)\/(\d+)\//);
  if (!match || !rest) return null;
  const [, channelId, attachmentId] = match;
  const messages = await rest.get(`/channels/${channelId}/messages`, {
    query: new URLSearchParams({ around: attachmentId, limit: "100" })
  });
  return messages.flatMap(message => message.attachments || [])
    .find(attachment => attachment.id === attachmentId)?.url || null;
}

export function createImageLoader({ cacheDir, getRest, fetchImpl = fetch, logger = console }) {
  return async function loadImageBufferFromUrl(value, timeoutMs = 12000) {
    let url;
    try { url = new URL(String(value || "").trim()); } catch { return null; }
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const discordAttachment = ["cdn.discordapp.com", "media.discordapp.net"].includes(url.hostname)
      && /^\/attachments\/\d+\/\d+\//.test(url.pathname);
    // Signed query parameters change when Discord renews the same attachment.
    const key = discordAttachment ? `discord:${url.pathname}` : url.href;
    const cachePath = path.join(cacheDir, `${createHash("sha256").update(key).digest("hex")}.img`);
    if (discordAttachment) {
      try { return await fs.readFile(cachePath); } catch { /* Not cached yet. */ }
    }
    const download = async target => {
      const response = await fetchImpl(target, {
        headers: { "User-Agent": "NarratorBot/1.0" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) { await response.body?.cancel(); return null; }
      const type = String(response.headers.get("content-type") || "").toLowerCase();
      if (type && !type.startsWith("image/")) { await response.body?.cancel(); return null; }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (!buffer.length) return null;
      await sharp(buffer).metadata();
      return buffer;
    };
    let buffer = null;
    try { buffer = await download(url.href); } catch { /* Try attachment recovery. */ }
    if (!buffer && discordAttachment) {
      try {
        const renewed = await recoverDiscordAttachment(url, getRest?.());
        if (renewed) buffer = await download(renewed);
      } catch { /* Deleted message or missing channel/history permissions. */ }
    }
    if (buffer && discordAttachment) {
      try {
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(cachePath, buffer);
      } catch (error) { logger.warn("Could not cache profile image:", error.message); }
    }
    if (!buffer) logger.warn("Could not load profile image; the source may have expired or become inaccessible.");
    return buffer;
  };
}
