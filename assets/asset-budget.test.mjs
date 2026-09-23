import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const root = new URL('./illustrations/', import.meta.url);
const referenced = new Set([
  'squirrel-wencang-logo-ip.png', 'squirrel-crayon.png', 'pinecone-icon.png', 'leaf-crayon.png',
  'book-crayon.png', 'star-crayon.png', 'search-crayon.png', 'user-crayon.png', 'plus-crayon.png',
  'more-crayon.png', 'grass-crayon.png', 'pinecone-warehouse-icon.png',
  'warehouse-icon-product-manager.png', 'warehouse-icon-human-nature.png', 'squirrel-toolbar-perched-v2.png',
]);
const roleCaps = new Map([
  ['warehouse-icon-product-manager.png', 192], ['warehouse-icon-human-nature.png', 192],
  ['squirrel-wencang-logo-ip.png', 256], ['squirrel-toolbar-perched-v2.png', 600],
]);

test('PNG assets stay inside the aggressive resolution and transfer budgets', async () => {
  const names = (await readdir(root)).filter((name) => name.endsWith('.png'));
  let allBytes = 0;
  let referencedBytes = 0;
  for (const name of names) {
    const path = new URL(name, root);
    const bytes = await readFile(path);
    const info = await stat(path);
    assert.equal(bytes.toString('ascii', 1, 4), 'PNG', name);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const cap = roleCaps.get(name) || (referenced.has(name) ? 96 : 384);
    assert.ok(Math.max(width, height) <= cap, `${name} is ${width}x${height}; cap is ${cap}px`);
    if (referenced.has(name) && name !== 'squirrel-toolbar-perched-v2.png') {
      assert.ok(info.size <= 180 * 1024, `${name} is ${info.size} bytes`);
    }
    allBytes += info.size;
    if (referenced.has(name)) referencedBytes += info.size;
  }
  assert.ok(allBytes <= 6 * 1024 * 1024, `all PNGs total ${allBytes} bytes`);
  assert.ok(referencedBytes <= 1.2 * 1024 * 1024, `referenced PNGs total ${referencedBytes} bytes`);
});
