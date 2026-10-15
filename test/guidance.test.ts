import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BASKET_PLANNER_GUIDE, SERVER_INSTRUCTIONS } from '../src/mcp/guide.js';
import { createApplication } from '../src/application.js';
import { injectedServices, connect } from '../test-support/mcp-fixture.js';
import { present } from '../test-support/helpers.js';

import assert from 'node:assert/strict';
import test from 'node:test';

const skill = readFileSync(new URL('../../skills/basket-planner/SKILL.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the basket-planner prompt and the bundled skill carry the same guide', () => {
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skill);
  assert.match(present(frontmatter?.[1]), /^name: basket-planner$/m);
  assert.equal(skill.slice(present(frontmatter)[0].length).trim(), BASKET_PLANNER_GUIDE);
});

test('clients receive the cart rules as server instructions and the guide as a prompt', async t => {
  const { services, state } = injectedServices(); const { client } = await connect(t, services);
  assert.equal(client.getInstructions(), SERVER_INSTRUCTIONS);
  assert.ok(client.getServerCapabilities()?.prompts);
  const [prompt] = (await client.listPrompts()).prompts;
  assert.equal(present(prompt).name, 'basket-planner');
  assert.deepEqual(present(prompt).arguments?.map(argument => [argument.name, argument.required ?? false]), [['request', false]]);
  const plain = await client.getPrompt({ name: 'basket-planner' });
  assert.deepEqual(plain.messages, [{ role: 'user', content: { type: 'text', text: BASKET_PLANNER_GUIDE } }]);
  const asked = present((await client.getPrompt({ name: 'basket-planner', arguments: { request: '  weekly basket for two ' } })).messages[0]);
  assert.equal(asked.content.type === 'text' && asked.content.text, `${BASKET_PLANNER_GUIDE}\n\n## Request\n\nweekly basket for two`);
  assert.equal(state.reads, 0); assert.equal(state.writes, 0);
});

test('every tool named in the instructions and the guide exists', async t => {
  const { services } = injectedServices(); const { client } = await connect(t, services);
  const tools = new Set((await client.listTools()).tools.map(tool => tool.name));
  const mentioned = new Set(`${SERVER_INSTRUCTIONS}\n${BASKET_PLANNER_GUIDE}`.match(/\b(?:search|get|list|add|set|remove)_[a-z_]+\b/g));
  assert.ok(mentioned.size >= 8);
  for (const name of mentioned) assert.ok(tools.has(name), `${name} is not a registered tool`);
});

test('a server without guidance advertises no prompts or instructions', async t => {
  const app = createApplication({ version: 'test' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'guidance-test', version: '1' });
  await app.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await app.close(); });
  assert.equal(client.getInstructions(), undefined);
  assert.equal(client.getServerCapabilities()?.prompts, undefined);
});
