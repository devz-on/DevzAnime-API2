import test from 'node:test';
import assert from 'node:assert/strict';

import { pickAnimeByInput } from './catalog.js';

test('pickAnimeByInput resolves MAL-style slug suffix to catalog entry by mal_id', () => {
  const catalog = [
    {
      __id: 'ichijouma-mankitsugurashi!-6qd7w9',
      __titleNorm: 'ichijouma mankitsugurashi',
      __altNorm: 'ichijouma mankitsugurashi',
      slug: '',
      slugs: [],
      mal_id: 62018,
    },
  ];

  const result = pickAnimeByInput(catalog, 'ichijouma-mankitsugurashi-62018');
  assert.equal(result?.__id, 'ichijouma-mankitsugurashi!-6qd7w9');
});
