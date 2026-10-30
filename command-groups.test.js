import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { groupApplicationCommands, resolveCommandName } from "./command-groups.js";

const source = readFileSync(new URL("./bot.js", import.meta.url), "utf8");
const definitions = source.slice(source.indexOf("  const characterCommand ="), source.indexOf("  aiHelper.setCommands(commands);"));
let originals;
const commands = new Function("SlashCommandBuilder", "PermissionFlagsBits", "groupApplicationCommands", `${definitions}\nreturn commands;`)(
  SlashCommandBuilder, PermissionFlagsBits, (input) => { originals = input; return groupApplicationCommands(input); }
);

const expected = {
  eco: { wallet: "wallet", points: "points", shop: "shop", leaderboard: "leaderboard" },
  item: { inventory: "inventory", use: "use-item", gift: "gift-item" }
};

test("registered groups preserve action fields and route execution and autocomplete", () => {
  assert.equal(commands.length, 12);
  assert.equal(new Set(commands.map(c => c.name)).size, commands.length);
  for (const [name, actions] of Object.entries(expected)) {
    const group = commands.find(c => c.name === name);
    assert.deepEqual(group.options.map(o => o.name), Object.keys(actions));
    for (const [action, oldName] of Object.entries(actions)) {
      const option = group.options.find(o => o.name === action);
      const original = originals.find(c => c.name === oldName);
      assert.deepEqual(option.options, original.options || []);
      assert.equal(option.type, 1);
      for (const kind of ["command", "autocomplete"]) {
        const interaction = { commandName: name, kind, options: { getSubcommand: () => action } };
        assert.equal(resolveCommandName(interaction), oldName);
        assert.ok(source.includes(`commandName === "${oldName}"`));
      }
      if (name !== oldName) assert.ok(!commands.some(c => c.name === oldName));
    }
  }
});

test("unaffected commands retain their options and permissions", () => {
  for (const name of ["character", "user", "admin", "setup", "trade", "lookup", "bot-say", "help", "tutorial", "premium"]) {
    assert.deepEqual(commands.find(c => c.name === name), originals.find(c => c.name === name));
    assert.equal(resolveCommandName({ commandName: name }), name);
  }
});

test("removed say commands are not registered or routed", () => {
  for (const name of ["say", "say-edit", "say-delete"]) {
    assert.ok(!commands.some(c => c.name === name));
    assert.equal(resolveCommandName({ commandName: name }), undefined);
  }
  for (const action of [null, "unknown", "toString", "constructor"]) {
    assert.equal(resolveCommandName({ commandName: "say", options: { getSubcommand: () => action } }), undefined);
  }
  assert.equal(resolveCommandName({ customId: "inventory:next" }), undefined);
});
