import test from 'node:test';
import assert from 'node:assert/strict';

import { getHindiDubbedData, normalizeDesiAnimeRow, parseWpPagination } from './desiDub.js';

const originalFetch = globalThis.fetch;

function jsonResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
  });
}

function makeCatalogPayload() {
  return {
    animes: [
      {
        _id: '12345',
        title: 'Attack on Titan',
        English: 'Attack on Titan',
        Japanese: 'Shingeki no Kyojin',
        image: 'https://cdn.example.com/aot-hianime.jpg',
        totalSubbed: 25,
        totalDubbed: 25,
        totalEpisodes: 25,
        Type: 'TV',
        Duration: '24m',
        slugs: ['attack-on-titan-16498'],
      },
    ],
    hasNextPage: false,
    nextCursor: null,
  };
}

test('parseWpPagination reads WordPress pagination headers', () => {
  const headers = new Headers({
    'x-wp-total': '348',
    'x-wp-totalpages': '70',
  });
  const pageInfo = parseWpPagination(headers, 3);

  assert.equal(pageInfo.currentPage, 3);
  assert.equal(pageInfo.totalItems, 348);
  assert.equal(pageInfo.totalPages, 70);
  assert.equal(pageInfo.hasNextPage, true);
});

test('normalizeDesiAnimeRow handles embedded media and taxonomy values', () => {
  const row = {
    id: 24295,
    slug: 'the-daily-life-of-the-immortal-king-4th-season',
    link: 'https://www.desidubanime.me/anime/the-daily-life-of-the-immortal-king-4th-season/',
    title: {
      rendered: 'Xian Wang de Richang Shenghuo 4',
    },
    _embedded: {
      'wp:featuredmedia': [
        {
          source_url: 'https://cdn.example.com/poster.jpg',
        },
      ],
      'wp:term': [
        [
          {
            taxonomy: 'anime_type',
            name: 'TV',
          },
        ],
      ],
    },
  };

  const normalized = normalizeDesiAnimeRow(row);
  assert.equal(normalized.postId, 24295);
  assert.equal(normalized.slug, 'the-daily-life-of-the-immortal-king-4th-season');
  assert.equal(normalized.title, 'Xian Wang de Richang Shenghuo 4');
  assert.equal(normalized.poster, 'https://cdn.example.com/poster.jpg');
  assert.equal(normalized.type, 'TV');
});

test('normalizeDesiAnimeRow survives missing optional fields', () => {
  const normalized = normalizeDesiAnimeRow({
    id: 100,
    slug: '',
    title: {
      rendered: '',
    },
  });

  assert.equal(normalized.postId, 100);
  assert.equal(normalized.title, '');
  assert.equal(normalized.poster, '');
  assert.equal(normalized.type, 'TV');
  assert.equal(normalized.duration, 'N/A');
});

test('getHindiDubbedData falls back to default Hindi tag id when tag lookup is empty', async (t) => {
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    calls.push(url);

    if (url.includes('/wp-json/wp/v2/tags') && url.includes('slug=hindi')) {
      return jsonResponse([]);
    }
    if (url.includes('/wp-json/wp/v2/anime') && url.includes('tags=74')) {
      return jsonResponse([], {
        headers: {
          'x-wp-total': '0',
          'x-wp-totalpages': '1',
        },
      });
    }
    if (url.includes('https://9animes.cv/api/anime?')) {
      return jsonResponse(makeCatalogPayload());
    }

    throw new Error(`Unhandled fetch in test: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const data = await getHindiDubbedData(1, false, { env: {} });
  assert.equal(data.pageInfo.currentPage, 1);
  assert.equal(Array.isArray(data.response), true);
  assert.equal(data.response.length, 0);
  assert.equal(calls.some((url) => url.includes('/wp-json/wp/v2/tags?') && url.includes('slug=hindi')), true);
  assert.equal(calls.some((url) => url.includes('/wp-json/wp/v2/anime?') && url.includes('tags=74')), true);
});

test('getHindiDubbedData uses DESIDUB_TAG_ID override and skips tag slug lookup', async (t) => {
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    calls.push(url);

    if (url.includes('/wp-json/wp/v2/tags')) {
      throw new Error('tag lookup should not run when DESIDUB_TAG_ID is provided');
    }
    if (url.includes('/wp-json/wp/v2/anime') && url.includes('tags=99')) {
      return jsonResponse([], {
        headers: {
          'x-wp-total': '0',
          'x-wp-totalpages': '1',
        },
      });
    }
    if (url.includes('https://9animes.cv/api/anime?')) {
      return jsonResponse(makeCatalogPayload());
    }

    throw new Error(`Unhandled fetch in test: ${url}`);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const data = await getHindiDubbedData(1, false, {
    env: {
      DESIDUB_TAG_ID: '99',
    },
  });

  assert.equal(data.pageInfo.currentPage, 1);
  assert.equal(data.response.length, 0);
  assert.equal(calls.some((url) => url.includes('/wp-json/wp/v2/tags?')), false);
  assert.equal(calls.some((url) => url.includes('/wp-json/wp/v2/anime?') && url.includes('tags=99')), true);
});
