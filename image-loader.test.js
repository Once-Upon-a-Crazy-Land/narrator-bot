import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import vm from "node:vm";
import { createImageLoader } from "./image-loader.js";

const expired = "https://cdn.discordapp.com/attachments/123/456/avatar.png?ex=1&hm=old";
const renewed = expired.replace("ex=1&hm=old", "ex=ffffffff&hm=new");
const image = await sharp({ create: { width: 2, height: 2, channels: 4, background: "red" } }).png().toBuffer();
const response = () => new Response(image, { headers: { "content-type": "image/png" } });
const logger = { warn() {} };

test("recovers expired attachments and reuses disk cache after URL renewal and restart", async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "profile-images-"));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const requests = [];
  const load = createImageLoader({ cacheDir, logger,
    fetchImpl: async url => { requests.push(url); return url === renewed ? response() : new Response(null, { status: 404 }); },
    getRest: () => ({ get: async (route, { query }) => {
      assert.equal(route, "/channels/123/messages");
      assert.equal(query.get("around"), "456");
      return [{ attachments: [{ id: "999", url: "https://example.com/wrong.png" }, { id: "456", url: renewed }] }];
    } })
  });
  assert.deepEqual(await load(expired), image);
  assert.deepEqual(requests, [expired, renewed]);
  const offline = createImageLoader({ cacheDir, logger, fetchImpl: () => { throw Error("offline"); } });
  assert.deepEqual(await offline(renewed), image);
});

test("unavailable source returns null and invalid content is not cached", async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "profile-images-"));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const load = createImageLoader({ cacheDir, logger,
    fetchImpl: async () => new Response("not an image", { headers: { "content-type": "image/png" } }),
    getRest: () => ({ get: async () => { throw Error("Missing Access"); } })
  });
  assert.equal(await load(expired), null);
  assert.equal(await load("file:///private"), null);
  assert.deepEqual(await fs.readdir(cacheDir), []);
});

test("ordinary image URLs still work without Discord recovery", async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "profile-images-"));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const load = createImageLoader({ cacheDir, logger, fetchImpl: async () => response(),
    getRest: () => { throw Error("must not access Discord"); }
  });
  assert.deepEqual(await load("https://example.com/image.png"), image);
});

test("profile card renderer includes the recovered portrait with and without a background", async t => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "profile-images-"));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const loadImageBufferFromUrl = createImageLoader({ cacheDir, logger,
    fetchImpl: async url => url === expired ? new Response(null, { status: 404 }) : response(),
    getRest: () => ({ get: async () => [{ attachments: [{ id: "456", url: renewed }] }] })
  });
  // Exercise the real renderer without starting the bot or modifying its data.
  const source = await fs.readFile(new URL("./bot.js", import.meta.url), "utf8");
  const start = source.indexOf("async function generateCharacterCardImage(");
  const end = source.indexOf("\nconst client = new Client", start);
  const context = vm.createContext({ sharp, Buffer, console, loadImageBufferFromUrl,
    normalizeHexColor: (value, fallback) => value || fallback,
    clampText: (value, max) => String(value || "").slice(0, max),
    escapeSvgText: value => String(value),
    calculateCharacterLevel: () => ({ level: 1, currentXp: 0, nextXp: 100 })
  });
  vm.runInContext(source.slice(start, end), context);
  for (const backgroundUrl of ["", "https://example.com/background.png"]) {
    const card = await context.generateCharacterCardImage({ id: "test", name: "Test", avatarUrl: expired }, { backgroundUrl });
    const metadata = await sharp(card).metadata();
    assert.equal(metadata.width, 1200);
    assert.equal(metadata.height, 675);
    const pixel = await sharp(card).extract({ left: 150, top: 150, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.deepEqual([...pixel], [255, 0, 0]);
  }
});
