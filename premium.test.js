import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = await fs.readFile(new URL("./bot.js", import.meta.url), "utf8");
function setup() {
  const context = vm.createContext({ console, Date,
    DISCORD_PREMIUM_SLOT_SKU_IDS: new Set(["premium"]),
    PREMIUM_USER_IDS: new Set(["manual"]),
    DISCORD_PREMIUM_SUBSCRIPTION_SLOTS: 5,
    entitlementSlotBonusByScopeUser: new Map(),
    getUserSlotsKey: (guild, user) => `${guild}:${user}`,
    client: { guilds: { cache: new Map([["a", {}], ["b", {}]]) }, application: { entitlements: {} } }
  });
  vm.runInContext(source.slice(source.indexOf("function getEntitlementEntries("), source.indexOf("function ensureDir(")), context);
  vm.runInContext(source.slice(source.indexOf("function getPremiumSlotBonus("), source.indexOf("function getUserCharacterSlotLimit(")), context);
  return context;
}
const entitlement = (extra = {}) => ({ id: "1", skuId: "premium", userId: "owner", ...extra });

test("premium grants follow owner and scope, with manual grants preserved", () => {
  const c = setup();
  c.updatePremiumEntitlement(entitlement());
  assert.equal(c.getPremiumSlotBonus("a", "owner"), 5);
  assert.equal(c.getPremiumSlotBonus("b", "owner"), 5);
  assert.equal(c.getPremiumSlotBonus("a", "viewer"), 0);
  assert.equal(c.getPremiumSlotBonus("a", "manual"), 5);
  c.updatePremiumEntitlement(entitlement({ deleted: true }));
  assert.equal(c.getPremiumSlotBonus("b", "owner"), 0);
  c.updatePremiumEntitlement(entitlement({ guildId: "a" }));
  assert.equal(c.getPremiumSlotBonus("a", "owner"), 5);
  assert.equal(c.getPremiumSlotBonus("b", "owner"), 0);
});

test("expiry, future grants, unrelated SKUs and multiple subscriptions", () => {
  const c = setup();
  const entry = entitlement({ endsAt: new Date(Date.now() + 60000) });
  c.updatePremiumEntitlement(entry);
  entry.endsAt = new Date(0);
  assert.equal(c.getPremiumSlotBonus("a", "owner"), 0);
  for (const extra of [{ starts_at: "2999-01-01" }, { ends_at: "invalid" }, { skuId: "other" }]) {
    c.updatePremiumEntitlement(entitlement(extra));
    assert.equal(c.getPremiumSlotBonus("a", "owner"), 0);
  }
  c.updatePremiumEntitlement(entitlement());
  c.updatePremiumEntitlement(entitlement({ id: "2" }));
  c.updatePremiumEntitlement(entitlement({ deleted: true }));
  assert.equal(c.getPremiumSlotBonus("a", "owner"), 5);
  c.updatePremiumEntitlement(entitlement({ id: "2", ends_at: "2000-01-01" }));
  assert.equal(c.getPremiumSlotBonus("a", "owner"), 0);
});

test("interaction entitlements reject other users and guilds and remove revoked access", () => {
  const c = setup();
  const interaction = { inGuild: () => true, guildId: "a", user: { id: "owner" },
    entitlements: new Map([["1", entitlement()]]) };
  c.syncPremiumSlotsFromInteraction(interaction);
  assert.equal(c.getPremiumSlotBonus("a", "owner"), 5);
  interaction.entitlements = [entitlement({ userId: "other" }), entitlement({ guildId: "b" })];
  c.syncPremiumSlotsFromInteraction(interaction);
  assert.equal(c.getPremiumSlotBonus("a", "owner"), 0);
});

test("startup refresh paginates and preserves cache if Discord fails", async () => {
  const c = setup();
  let calls = 0;
  c.client.application.entitlements.fetch = async options => {
    assert.equal(options.excludeEnded, true);
    calls++;
    if (calls === 1) {
      const page = new Map(Array.from({ length: 100 }, (_, i) => [String(i), entitlement({ id: String(i) })]));
      page.last = () => page.get("99");
      return page;
    }
    assert.equal(options.after, "99");
    return new Map();
  };
  await c.refreshPremiumEntitlements();
  assert.equal(calls, 2);
  assert.equal(c.getPremiumSlotBonus("a", "owner"), 5);
  c.client.application.entitlements.fetch = async () => { throw Error("offline"); };
  await assert.rejects(c.refreshPremiumEntitlements(), /offline/);
  assert.equal(c.getPremiumSlotBonus("a", "owner"), 5);
  c.client.application.entitlements.fetch = async () => new Map();
  await c.refreshPremiumEntitlements();
  assert.equal(c.getPremiumSlotBonus("a", "owner"), 0);
});

test("daily rewards require membership, include uncached manual users and run once per day", async () => {
  const c = setup();
  const awards = [];
  let saved = {};
  Object.assign(c, {
    PREMIUM_DAILY_REWARD_PATH: "unused", PREMIUM_DAILY_POINTS: 10,
    readJson: () => saved,
    writeJson: (_, value) => { saved = value; },
    addPoints: (...args) => awards.push(args)
  });
  for (const [guildId, guild] of c.client.guilds.cache) {
    guild.members = { fetch: async userId => {
      if (guildId === "b") throw Object.assign(Error("Unknown Member"), { code: 10007 });
      return { displayName: userId };
    } };
  }
  vm.runInContext(source.slice(source.indexOf("async function distributePremiumDailyRewards("), source.indexOf("function getRandomMessagePointsReward(")), c);
  c.updatePremiumEntitlement(entitlement());
  c.updatePremiumEntitlement(entitlement({ id: "expired", userId: "expired", endsAt: new Date(0) }));
  await c.distributePremiumDailyRewards();
  assert.deepEqual(awards, [["a", "owner", 10], ["a", "manual", 10]]);
  await c.distributePremiumDailyRewards();
  assert.equal(awards.length, 2);
});
