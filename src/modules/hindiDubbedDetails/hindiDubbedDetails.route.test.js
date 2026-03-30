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

function textResponse(payload, { status = 200, headers = {} } = {}) {
  return new Response(payload, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...headers,
    },
  });
}

function buildFetchStub() {
  return async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url.includes('/wp-json/wp/v2/anime/5001?_embed=1')) {
      return jsonResponse({
        id: 5001,
        slug: 'attack-on-titan-season-1',
        link: 'https://www.desidubanime.me/anime/attack-on-titan-season-1/',
        title: {
          rendered: 'Attack on Titan',
        },
        content: {
          rendered: '<p>Humanity fights titans.</p>',
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
      });
    }

    if (url === 'https://www.desidubanime.me/anime/attack-on-titan-season-1/') {
      return textResponse(`
        <a class="episode-list-display-box episode-list-item"
           href="https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-1/"
           data-episode-search-query="1">
           <span class="episode-list-item-title">To You, in 2000 Years</span>
        </a>
        <a class="episode-list-display-box episode-list-item"
           href="https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-2/"
           data-episode-search-query="2">
           <span class="episode-list-item-title">That Day</span>
        </a>
      `);
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

test('GET /api/v1/hindi-dubbed/anime/{id} returns hindi details and episode list', async (t) => {
  globalThis.fetch = buildFetchStub();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await app.request(
    'http://localhost/api/v1/hindi-dubbed/anime/desidub-5001-attack-on-titan-season-1'
  );
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.data.id, 'attack-on-titan-16498');
  assert.equal(body.data.streamId, 'desidub-5001-attack-on-titan-season-1');
  assert.equal(body.data.source.postId, 5001);
  assert.equal(body.data.episodeList.length, 2);
  assert.equal(body.data.episodeList[0].episodeNumber, 1);
});
