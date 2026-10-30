export const COMMAND_GROUPS = {
  eco: { description: "Wallets, points, shop, and rankings", actions: { wallet: "wallet", points: "points", shop: "shop", leaderboard: "leaderboard" } },
  item: { description: "View, use, and gift inventory items", actions: { inventory: "inventory", use: "use-item", gift: "gift-item" } }
};

// Reuse each action's existing options, including required fields and autocomplete.
export function groupApplicationCommands(commands) {
  const groupedNames = new Set(Object.values(COMMAND_GROUPS).flatMap((group) => Object.values(group.actions)));
  const byName = new Map(commands.map((command) => [command.name, command]));
  const groups = Object.entries(COMMAND_GROUPS).map(([name, group]) => ({
    name,
    description: group.description,
    options: Object.entries(group.actions).map(([action, originalName]) => {
      const original = byName.get(originalName);
      if (!original) throw new Error(`Missing command: ${originalName}`);
      return { type: 1, name: action, description: original.description, options: original.options || [] };
    })
  }));
  return [...commands.filter((command) => !groupedNames.has(command.name)), ...groups];
}

// Both command execution and autocomplete use the same action routing.
export function resolveCommandName(interaction) {
  if (["say", "say-edit", "say-delete"].includes(interaction.commandName)) return undefined;
  const group = COMMAND_GROUPS[interaction.commandName];
  if (!group || !Object.hasOwn(COMMAND_GROUPS, interaction.commandName)) return interaction.commandName;
  const action = interaction.options?.getSubcommand(false);
  return Object.hasOwn(group.actions, action) ? group.actions[action] : undefined;
}
