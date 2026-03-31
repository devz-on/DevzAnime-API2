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
          rendered: '<p>Sample synopsis</p>',
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
              title: 'To You, in 2000 Years',
              post_title: 'Attack on Titan Episode 1',
              url: 'https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-1/',
            },
            {
              id: 7002,
              number: 'Episode 2',
              meta_number: '2',
              title: 'That Day',
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
        <div class="episodes">
          <a class="episode-list-display-box episode-list-item current-episode"
             href="https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-1/"
             data-episode-search-query="1">
             <span class="episode-list-item-title">To You, in 2000 Years</span>
          </a>
          <a class="episode-list-display-box episode-list-item"
             href="https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-2/"
             data-episode-search-query="2">
             <span class="episode-list-item-title">That Day</span>
          </a>
        </div>
      `);
    }

    if (url === 'https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-1/') {
      return textResponse(`
        <div class="episode-player-box">
          <iframe src="https://gdmirrorbot.nl/embed/test-123"></iframe>
        </div>
        <span data-embed-id="TWlycm9yZHVi:aHR0cHM6Ly9nZG1pcnJvcmJvdC5ubC9lbWJlZC90ZXN0LTEyMw=="></span>
        <span data-embed-id="U3RyZWFtcDJwZHVi:PGlmcmFtZSBzcmM9J2h0dHBzOi8vZGVzaWR1YmFuaW1lLnBsYXllcnAycC5saXZlLyN0ZXN0MTIzJyB3aWR0aD0nMTAwJScgaGVpZ2h0PScxMDAlJyBmcmFtZWJvcmRlcj0nMCcgYWxsb3dmdWxsc2NyZWVuPjwvaWZyYW1lPg=="></span>
        <span data-embed-id="Vk1vbHlkdWI=:aHR0cHM6Ly92aWRtb2x5Lm5ldC9lbWJlZC1hYmMxMjMuaHRtbA=="></span>
        <script src="https://static.cloudflareinsights.com/beacon.min.js/v8"></script>
      `);
    }

    if (url === 'https://www.desidubanime.me/watch/attack-on-titan-season-1-episode-2/') {
      return textResponse(`
        <div class="episode-player-box">
          <iframe src="https://gdmirrorbot.nl/embed/test-456"></iframe>
        </div>
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

test('GET /api/v1/hindi-dubbed/stream returns streams for requested episode', async (t) => {
  globalThis.fetch = buildFetchStub();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await app.request(
    'http://localhost/api/v1/hindi-dubbed/stream?id=desidub-5001-attack-on-titan-season-1&episode=1'
  );
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.data.anime.streamId, 'desidub-5001-attack-on-titan-season-1');
  assert.equal(body.data.episode.number, 1);
  assert.equal(body.data.streams.length, 3);
  assert.equal(body.data.streams[0].type, 'dub');
  assert.equal(body.data.streams.some((stream) => stream.link.file.includes('cloudflareinsights')), false);
});

test('GET /api/v1/hindi-dubbed/stream filters by server', async (t) => {
  globalThis.fetch = buildFetchStub();
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await app.request(
    'http://localhost/api/v1/hindi-dubbed/stream?id=desidub-5001-attack-on-titan-season-1&episode=1&server=vmolydub'
  );
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.data.streams.length, 1);
  assert.equal(body.data.streams[0].server, 'vmolydub');
});
