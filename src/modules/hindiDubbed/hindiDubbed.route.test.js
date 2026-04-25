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
    if (!url) {
      throw new Error('missing url');
    }

    if (url.includes('/wp-json/wp/v2/tags') && url.includes('slug=hindi')) {
      return jsonResponse([
        {
          id: 74,
          name: 'Hindi',
          slug: 'hindi',
        },
      ]);
    }

    if (url.includes('/wp-json/wp/v2/anime') && url.includes('tags=74')) {
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
            slug: 'invincible-season-4',
            link: 'https://www.desidubanime.me/anime/invincible-season-4/',
            title: {
              rendered: 'Invincible &#8211; Season 4',
            },
            _embedded: {
              'wp:featuredmedia': [
                {
                  source_url: 'https://cdn.example.com/invincible.jpg',
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
            'x-wp-total': '40',
            'x-wp-totalpages': '2',
          },
        }
      );
    }

    if (url.includes('/api/anime/trending')) {
      return jsonResponse({
        animes: [
          {
            _id: '12345',
            title: 'Attack on Titan',
            English: 'Attack on Titan',
            image: 'https://cdn.example.com/aot-hianime.jpg',
            totalSubbed: 25,
            totalDubbed: 25,
            totalEpisodes: 25,
            Type: 'TV',
            Duration: '24m',
            slugs: ['attack-on-titan-16498'],
          },
        ],
      });
    }

    if (url.includes('/api/anime?')) {
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

    if (url.includes('https://aniwatchtv.to/top-airing')) {
      return textResponse(`
        <div class="block_area-content block_area-list film_list">
          <div class="film_list-wrap">
            <div class="flw-item">
              <div class="film-poster">
                <img class="film-poster-img" data-src="https://cdn.example.com/aot-hianime.jpg" />
                <div class="tick">
                  <span class="tick-sub">25</span>
                  <span class="tick-dub">25</span>
                </div>
              </div>
              <div class="film-detail">
                <h3 class="film-name">
                  <a class="dynamic-name" href="/attack-on-titan-16498" data-jname="Shingeki no Kyojin">Attack on Titan</a>
                </h3>
                <div class="fd-infor">
                  <span class="fdi-item">TV</span>
                  <span class="fdi-duration">24m</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      `);
    }

    throw new Error(`Unhandled fetch in test: ${url}`);
  };
}

test('GET /api/v1/hindi-dubbed returns Hindi dubbed rows without mapping payload', async (t) => {
  globalThis.fetch = buildFetchStub();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await app.request('http://localhost/api/v1/hindi-dubbed?page=1');
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.data.pageInfo.currentPage, 1);
  assert.equal(body.data.response.length, 2);
  assert.equal(body.data.response[0].id, 'desidub-5001-attack-on-titan-season-1');
  assert.equal(body.data.response[0].streamId, 'desidub-5001-attack-on-titan-season-1');
  assert.equal(body.data.response[1].title, 'Invincible - Season 4');
  assert.equal(Object.hasOwn(body.data.response[0], 'mapping'), false);
});

test('catch-all explore route still works for /api/v1/top-airing', async (t) => {
  globalThis.fetch = buildFetchStub();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await app.request('http://localhost/api/v1/top-airing?page=1');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.response));
});
