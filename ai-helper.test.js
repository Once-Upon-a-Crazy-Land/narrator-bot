import test from "node:test";
import assert from "node:assert/strict";
import { createAiHelper } from "./ai-helper.js";

function message(overrides = {}) {
  const replies = [];
  return {
    guild: { id: "guild" }, author: { id: "user" }, client: { user: { id: "123" } },
    content: "<@123> How do I create a character?",
    channel: { sendTyping: async () => {} }, replies,
    reply: async (payload) => { replies.push(payload); },
    ...overrides
  };
}

function harness(result = { botRelated: true, answer: "Use /character create." }) {
  const requests = [];
  const helper = createAiHelper({
    apiKey: "test-key",
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] }) };
    },
    logger: { warn() {} }
  });
  return { helper, requests };
}

test("only explicit mentions from humans in servers trigger Google", async () => {
  const { helper, requests } = harness();
  for (const overrides of [
    { content: "How does this bot work?" }, { content: "<@999> question" },
    { guild: null }, { author: { id: "bot", bot: true } }, { webhookId: "hook" }
  ]) await helper.handleMessage(message(overrides));
  assert.equal(requests.length, 0);
  const msg = message({ content: "<@!123> How does /say work? <@123>" });
  await helper.handleMessage(msg);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.contents[0].parts[0].text, "How does /say work?");
  assert.deepEqual(msg.replies[0].allowedMentions, { parse: [], repliedUser: false });
});

test("bot's managed role mentions trigger support; unrelated and same-named roles do not", async () => {
  const { helper, requests } = harness();
  const roles = [
    { id: "456", tags: { botId: "123" } },
    { id: "789", name: "The Narrator", tags: { botId: "999" } },
    { id: "987", name: "The Narrator" }
  ];
  const guild = { id: "guild", roles: { cache: { find: (fn) => roles.find(fn) } } };
  await helper.handleMessage(message({ guild, content: "<@&789> Question" }));
  await helper.handleMessage(message({ guild, content: "<@&987> Question" }));
  assert.equal(requests.length, 0);
  await helper.handleMessage(message({ guild, content: "<@&456> How does /say work?" }));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.contents[0].parts[0].text, "How does /say work?");
  await helper.handleMessage(message({ guild, author: { id: "other-user" }, content: "<@&456> How does /say work? <@123>" }));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.contents[0].parts[0].text, "How does /say work?");
});

test("delivery diagnostics do not log message text", async () => {
  const logs = [];
  const helper = createAiHelper({ logger: { info: (line) => logs.push(line) } });
  await helper.handleMessage(message({ content: "private unrelated message" }));
  await helper.handleMessage(message({ content: "another private message" }));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /delivery confirmed/);
  assert.doesNotMatch(logs[0], /private/);
});

test("context excludes server-specific command choices and message metadata", async () => {
  const { helper, requests } = harness();
  helper.setCommands([{ name: "character", description: "Manage characters", options: [
    { name: "name", description: "Character name", required: true, choices: [{ name: "PRIVATE", value: "secret" }] }
  ] }]);
  await helper.handleMessage(message({ attachments: ["private.png"], guild: { id: "private-guild" } }));
  const body = requests[0].options.body;
  assert.match(body, /Manage characters/);
  assert.doesNotMatch(body, /PRIVATE|secret|private.png|private-guild/);
  assert.equal(requests[0].options.headers["x-goog-api-key"], "test-key");
  assert.ok(requests[0].options.signal instanceof AbortSignal);
});

test("off-topic results cannot display the model's unrelated answer", async () => {
  const { helper } = harness({ botRelated: false, answer: "An unrelated answer" });
  const msg = message({ content: "<@123> What is the capital of France?" });
  await helper.handleMessage(msg);
  assert.match(msg.replies[0].content, /only help with my commands/);
  assert.doesNotMatch(msg.replies[0].content, /An unrelated answer/);
});

test("missing key, empty mention and long questions do not call Google", async () => {
  const { helper, requests } = harness();
  await helper.handleMessage(message({ content: "<@123>" }));
  await helper.handleMessage(message({ content: "<@123> " + "x".repeat(4001) }));
  assert.equal(requests.length, 0);
  const msg = message();
  await createAiHelper().handleMessage(msg);
  assert.match(msg.replies[0].content, /not ready/);
});

test("user cooldown prevents repeated provider requests", async () => {
  const { helper, requests } = harness();
  await helper.handleMessage(message());
  const second = message();
  await helper.handleMessage(second);
  assert.equal(requests.length, 1);
  assert.match(second.replies[0].content, /wait/);
});

test("provider failures and malformed responses produce safe fallback replies", async () => {
  for (const response of [
    { ok: false, status: 429 }, { ok: false, status: 403 },
    { ok: true, json: async () => ({ candidates: [] }) },
    { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "invalid json" }] } }] }) }
  ]) {
    const msg = message();
    const helper = createAiHelper({ apiKey: "test", fetchImpl: async () => response, logger: { warn() {} } });
    await helper.handleMessage(msg);
    assert.equal(msg.replies.length, 1);
    assert.match(msg.replies[0].content, /\/help/);
  }
});

test("long answers fit Discord's message limit", async () => {
  const { helper } = harness({ botRelated: true, answer: "x".repeat(5000) });
  const msg = message();
  await helper.handleMessage(msg);
  assert.ok(msg.replies[0].content.length <= 2000);
});

test("temporary Google errors recover with bounded backoff and one Discord answer", async () => {
  let calls = 0;
  let cancelled = 0;
  const delays = [];
  const signals = [];
  const helper = createAiHelper({
    apiKey: "test", logger: { warn() {} }, waitImpl: async (ms) => delays.push(ms),
    fetchImpl: async (_url, options) => {
      calls++;
      signals.push(options.signal);
      if (calls < 3) return { ok: false, status: 503, body: { cancel: async () => { cancelled++; } } };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [
        { text: JSON.stringify({ botRelated: true, answer: "Use /help." }) }
      ] } }] }) };
    }
  });
  const msg = message();
  await helper.handleMessage(msg);
  assert.equal(calls, 3);
  assert.equal(cancelled, 2);
  assert.ok(delays[0] >= 1000 && delays[0] < 1250);
  assert.ok(delays[1] >= 2000 && delays[1] < 2250);
  assert.ok(signals.every((signal) => signal === signals[0]));
  assert.equal(msg.replies.length, 1);
  assert.equal(msg.replies[0].content, "Use /help.");
});

test("persistent outages stop after three attempts; key and quota failures are not retried", async () => {
  for (const status of [503, 500, 502, 504, 400, 403, 404, 429]) {
    let calls = 0;
    const helper = createAiHelper({
      apiKey: "test", logger: { warn() {} }, waitImpl: async () => {},
      fetchImpl: async () => { calls++; return { ok: false, status }; }
    });
    const msg = message();
    await helper.handleMessage(msg);
    assert.equal(calls, status >= 500 ? 3 : 1);
    assert.equal(msg.replies.length, 1);
    if (status === 503) assert.match(msg.replies[0].content, /even after retrying/);
  }
});
