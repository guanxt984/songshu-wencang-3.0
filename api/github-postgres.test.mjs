import assert from 'node:assert/strict';
import test from 'node:test';

import { createGithubRepository } from './github-postgres.js';

function fixture({ seedVersion = 0, failOfficialInsert = false } = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  const database = {
    async query() { return { rows: [] }; },
    async withTransaction(work) {
      try {
        const result = await work({ query });
        committed = true;
        return result;
      } catch (error) {
        rolledBack = true;
        throw error;
      }
    },
  };
  async function query(text, values = []) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    calls.push({ text: normalized, values });
    if (normalized.startsWith('INSERT INTO users')) return { rows: [{ id: 'user-id', status: 'active', official_seed_version: seedVersion }] };
    if (normalized.startsWith('SELECT COALESCE(max(position)')) return { rows: [{ position: 3 }] };
    if (normalized.startsWith('INSERT INTO warehouses')) {
      if (failOfficialInsert) throw new Error('seed failed');
      return { rows: [{ id: values[1] }] };
    }
    if (normalized.startsWith('UPDATE users SET official_seed_version')) return { rows: [] };
    if (normalized.startsWith('INSERT INTO sessions')) return { rows: [] };
    throw new Error(`Unexpected query: ${normalized}`);
  }
  return { repository: createGithubRepository({ database }), calls, committed: () => committed, rolledBack: () => rolledBack };
}

test('first GitHub login adds both official warehouses and records the seed version atomically', async () => {
  const f = fixture();
  const token = await f.repository.createLogin({ id: '123', login: 'squirrel' });

  assert.match(token, /^[a-f0-9]{64}$/);
  const inserts = f.calls.filter(({ text }) => text.startsWith('INSERT INTO warehouses'));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts.map(({ values }) => values[3]), ['example_product_manager', 'example_human_nature']);
  assert.deepEqual(inserts.map(({ values }) => JSON.parse(values[5]).name), ['如何成为产品经理', '人性的弱点摘抄']);
  assert.deepEqual(inserts.map(({ values }) => values[4]), [3, 4]);
  assert.equal(f.calls.some(({ text, values }) => text.startsWith('UPDATE users SET official_seed_version') && values[1] === 2), true);
  assert.equal(f.calls.at(-1).text.startsWith('INSERT INTO sessions'), true);
  assert.equal(f.committed(), true);
});

test('subsequent GitHub login does not recreate deleted official warehouses', async () => {
  const f = fixture({ seedVersion: 2 });
  await f.repository.createLogin({ id: '123', login: 'squirrel' });

  assert.equal(f.calls.some(({ text }) => text.startsWith('INSERT INTO warehouses')), false);
  assert.equal(f.calls.some(({ text }) => text.startsWith('UPDATE users SET official_seed_version')), false);
  assert.equal(f.committed(), true);
});

test('official warehouse failure rolls back the login before a session is created', async () => {
  const f = fixture({ failOfficialInsert: true });
  await assert.rejects(() => f.repository.createLogin({ id: '123', login: 'squirrel' }), /seed failed/);

  assert.equal(f.calls.some(({ text }) => text.startsWith('INSERT INTO sessions')), false);
  assert.equal(f.rolledBack(), true);
});
