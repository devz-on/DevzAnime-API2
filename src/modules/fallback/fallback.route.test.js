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

test('GET /api/v1/search keeps normal source when data exists', async (t) => {
  let wpCallCount = 0;

  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url.includes('/wp-json/wp/v2/')) {
      wpCallCount += 1;
      throw new Error('unexpected desidub call');
    }

    if (url.includes('https://9animes.cv/api/anime?')) {
      return jsonResponse({
        animes: [
          {
            _id: '101',
            title: 'Naruto',
            English: 'Naruto',
            Japanese: 'Naruto',
            image: 'https://cdn.example.com/naruto.jpg',
            totalSubbed: 220,
            totalDubbed: 220,
            totalEpisodes: 220,
            Type: 'TV',
            Duration: '24m',
            slugs: ['naruto-101'],
          },
        ],
        hasNextPage: false,
        nextCursor: null,
      });
    }

    throw new Error(`Unhandled fetch in test: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await app.request('http://localhost/api/v1/search?keyword=naruto&page=1');
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.data.response.length, 1);
  assert.equal(body.data.response[0].id, 'naruto-101');
  assert.equal(wpCallCount, 0);
});

test('GET /api/v1/search falls back to hindi-dubbed when normal search is empty', async (t) => {
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url.includes('/wp-json/wp/v2/tags') && url.includes('slug=hindi')) {
      return jsonResponse([{ id: 74, slug: 'hindi' }]);
    }

    if (url.includes('/wp-json/wp/v2/anime') && url.includes('tags=74') && url.includes('search=hindi-only')) {
      return jsonResponse(
        [
          {
            id: 9001,
            slug: 'hindi-only-show',
            link: 'https://www.desidubanime.me/anime/hindi-only-show/',
            title: {
              rendered: 'Hindi Only Show',
            },
            _embedded: {
              'wp:featuredmedia': [
                {
                  source_url: 'https://cdn.example.com/hindi-only.jpg',
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
            'x-wp-total': '1',
            'x-wp-totalpages': '1',
          },
        }
      );
    }

    if (url.includes('https://9animes.cv/api/anime?')) {
      return jsonResponse({
        animes: [
          {
            _id: '202',
            title: 'Some Other Anime',
            English: 'Some Other Anime',
            Japanese: 'Some Other Anime',
            image: 'https://cdn.example.com/other.jpg',
            totalSubbed: 12,
            totalDubbed: 0,
            totalEpisodes: 12,
            Type: 'TV',
            Duration: '24m',
            slugs: ['some-other-anime-202'],
          },
        ],
        hasNextPage: false,
        nextCursor: null,
      });
    }

    throw new Error(`Unhandled fetch in test: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await app.request('http://localhost/api/v1/search?keyword=hindi-only&page=1');
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.data.response.length, 1);
  assert.equal(body.data.response[0].id, 'desidub-9001-hindi-only-show');
});

test('GET /api/v1/stream falls back to hindi stream for hindi episode ids', async (t) => {
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url.includes('/wp-json/wp/v2/anime/5001?_embed=1')) {
      return jsonResponse({
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
      });
    }

    if (url.includes('/wp-admin/admin-ajax.php') && url.includes('action=get_episodes') && url.includes('anime_id=5001')) {
      return jsonResponse({
        success: true,
        data: {
          episodes: [
            {
              id: 7001,
              number: 'Episode 1',
              meta_number: '1',
              title: 'Episode 1',
              post_title: 'Attack on Titan Episode 1',
              url: 'https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-1/',
            },
            {
              id: 7002,
              number: 'Episode 2',
              meta_number: '2',
              title: 'Episode 2',
              post_title: 'Attack on Titan Episode 2',
              url: 'https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-2/',
            },
          ],
          max_episodes_page: 1,
        },
      });
    }

    if (url === 'https://www.desidubanime.me/anime/attack-on-titan-season-1/') {
      return textResponse(`
        <a class="episode-list-display-box episode-list-item"
           href="https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-1/"
           data-episode-search-query="1">
           <span class="episode-list-item-title">Episode 1</span>
        </a>
      `);
    }

    if (url === 'https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-1/') {
      return textResponse(`
        <span data-embed-id="Vk1vbHlkdWI=:aHR0cHM6Ly92aWRtb2x5Lm5ldC9lbWJlZC1hYmMxMjMuaHRtbA=="></span>
        <span data-embed-id="TWlycm9yZHVi:aHR0cHM6Ly9nZG1pcnJvcmJvdC5ubC9lbWJlZC90ZXN0LTEyMw=="></span>
      `);
    }

    if (url === 'https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-2/') {
      return textResponse(`
        <span data-embed-id="Vk1vbHlkdWI=:aHR0cHM6Ly92aWRtb2x5Lm5ldC9lbWJlZC1lcGlzb2RlLTIuaHRtbA=="></span>
      `);
    }

    throw new Error(`Unhandled fetch in test: ${url}`);
  };

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await app.request(
    'http://localhost/api/v1/stream?id=desidub-ep-5001-1&server=hd-1&type=sub'
  );
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(Array.isArray(body.data), true);
  assert.equal(body.data.length, 2);
  assert.equal(body.data[0].type, 'dub');

  const slugEpisodeResponse = await app.request(
    'http://localhost/api/v1/stream?id=desidub-5001-attack-on-titan-season-1-episode-1&server=hd-1&type=sub'
  );
  assert.equal(slugEpisodeResponse.status, 200);
  const slugEpisodeBody = await slugEpisodeResponse.json();
  assert.equal(slugEpisodeBody.success, true);
  assert.equal(slugEpisodeBody.data[0].id, 'desidub-ep-5001-1');
  assert.equal(slugEpisodeBody.data.some((stream) => stream.link.file.includes('episode-2')), false);
});
