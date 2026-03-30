import test from 'node:test';
import assert from 'node:assert/strict';

import app from '../../app.js';

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

function buildFetchStub() {
  return async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url.includes('/wp-json/wp/v2/tags') && url.includes('slug=hindi')) {
      return jsonResponse([
        {
          id: 74,
          name: 'Hindi',
          slug: 'hindi',
        },
      ]);
    }

    if (url.includes('/wp-json/wp/v2/anime') && url.includes('tags=74') && url.includes('search=attack')) {
      return jsonResponse(
        [
          {
            id: 5001,
            slug: 'attack-on-titan-season-1',
            link: 'https://www.desidubanime.me/anime/attack-on-titan-season-1/',
            title: {
              rendered: 'Attack on Titan',
            },
            _embedded: {
              'wp:featuredmedia': [
                {
                  source_url: 'https://cdn.example.com/aot.jpg',
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
          },
          {
            id: 5002,
            slug: 'unknown-anime-special',
            link: 'https://www.desidubanime.me/anime/unknown-anime-special/',
            title: {
              rendered: 'Unknown Anime Special',
            },
            _embedded: {
              'wp:featuredmedia': [
                {
                  source_url: 'https://cdn.example.com/unknown.jpg',
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
          },
        ],
        {
          headers: {
            'x-wp-total': '2',
            'x-wp-totalpages': '1',
          },
        }
      );
    }

    if (url.includes('https://9animes.cv/api/anime?')) {
      return jsonResponse({
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
      });
    }

    throw new Error(`Unhandled fetch in test: ${url}`);
  };
}

test('GET /api/v1/hindi-dubbed/search returns mapped and unmapped results', async (t) => {
  globalThis.fetch = buildFetchStub();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await app.request('http://localhost/api/v1/hindi-dubbed/search?keyword=attack&page=1');
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.data.pageInfo.currentPage, 1);
  assert.equal(body.data.response.length, 2);

  const mapped = body.data.response.find((item) => item.mapping?.mapped);
  const unmapped = body.data.response.find((item) => !item.mapping?.mapped);
  assert.ok(mapped);
  assert.ok(unmapped);
  assert.equal(mapped.id, 'attack-on-titan-16498');
  assert.equal(typeof mapped.streamId, 'string');
  assert.equal(unmapped.mapping.daniId, null);
});

test('GET /api/v1/hindi-dubbed/search with mappedOnly=true filters unmapped', async (t) => {
  globalThis.fetch = buildFetchStub();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await app.request(
    'http://localhost/api/v1/hindi-dubbed/search?keyword=attack&page=1&mappedOnly=true'
  );
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.data.response.length, 1);
  assert.equal(body.data.response[0].mapping.mapped, true);
});
