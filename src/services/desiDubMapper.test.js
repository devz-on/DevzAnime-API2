import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCatalogMatcherIndex,
  buildDesiFallbackId,
  decodeHtmlEntities,
  resolveDesiDubMapping,
  tokenDiceScore,
} from './desiDubMapper.js';
import { normalizeText } from './normalizers.js';

function makeCatalogEntry({ id, title, alt = '', slugs = [], popularity = 100 }) {
  return {
    __id: id,
    __titleNorm: normalizeText(title),
    __altNorm: normalizeText(alt),
    __popularity: popularity,
    slugs,
    title,
    English: title,
    Japanese: alt,
    image: '',
    totalSubbed: 12,
    totalDubbed: 12,
    totalEpisodes: 12,
  };
}

test('decodeHtmlEntities decodes common numeric and named entities', () => {
  const value = 'Invincible &#8211; Season 4 &amp; Beyond';
  assert.equal(decodeHtmlEntities(value), 'Invincible - Season 4 & Beyond');
});

test('tokenDiceScore returns expected overlap ratio', () => {
  const left = new Set(['attack', 'titan']);
  const right = new Set(['attack', 'on', 'titan']);
  assert.equal(tokenDiceScore(left, right), 0.8);
});

test('buildDesiFallbackId creates deterministic fallback id', () => {
  const source = {
    postId: 22548,
    slug: 'yuusha-party-wo-oidasareta-kiyoubinbou',
  };
  assert.equal(buildDesiFallbackId(source), 'desidub-22548-yuusha-party-wo-oidasareta-kiyoubinbou');
});

test('resolveDesiDubMapping uses override mapping first', () => {
  const catalog = [
    makeCatalogEntry({
      id: 'naruto-20',
      title: 'Naruto',
      slugs: ['naruto-20'],
    }),
  ];
  const source = {
    title: 'Unknown source title',
    slug: 'naruto-special-slug',
    url: 'https://example.test/naruto-special-slug',
  };
  const result = resolveDesiDubMapping(source, catalog, null, {
    overrides: {
      'naruto special slug': 'naruto-20',
    },
  });

  assert.equal(result.mapped, true);
  assert.equal(result.method, 'override');
  assert.equal(result.daniId, 'naruto-20');
});

test('resolveDesiDubMapping resolves exact candidate match', () => {
  const catalog = [
    makeCatalogEntry({
      id: 'attack-on-titan-16498',
      title: 'Attack on Titan',
      alt: 'Shingeki no Kyojin',
      slugs: ['attack-on-titan-16498'],
    }),
  ];
  const source = {
    title: 'Attack on Titan',
    slug: 'attack-on-titan-season-1',
  };
  const result = resolveDesiDubMapping(source, catalog, null, {
    overrides: {},
  });

  assert.equal(result.mapped, true);
  assert.equal(result.method, 'exact');
  assert.equal(result.daniId, 'attack-on-titan-16498');
});

test('resolveDesiDubMapping falls back to fuzzy match above threshold', () => {
  const catalog = [
    makeCatalogEntry({
      id: 'attack-on-titan-final-season-1',
      title: 'Attack on Titan Final Season',
      slugs: ['attack-on-titan-final-season-1'],
      popularity: 2,
    }),
    makeCatalogEntry({
      id: 'jujutsu-kaisen-18',
      title: 'Jujutsu Kaisen',
      slugs: ['jujutsu-kaisen-18'],
      popularity: 1,
    }),
  ];
  const matcherIndex = buildCatalogMatcherIndex(catalog);
  const source = {
    title: 'Attack Titan Final',
    slug: 'attack-titan-final',
  };
  const result = resolveDesiDubMapping(source, catalog, matcherIndex, {
    overrides: {},
  });

  assert.equal(result.mapped, true);
  assert.equal(result.method, 'fuzzy');
  assert.equal(result.daniId, 'attack-on-titan-final-season-1');
  assert.ok(result.confidence >= 0.72);
});

test('resolveDesiDubMapping returns unmapped when confidence is low', () => {
  const catalog = [
    makeCatalogEntry({
      id: 'one-piece-100',
      title: 'One Piece',
      slugs: ['one-piece-100'],
    }),
  ];
  const source = {
    title: 'Completely Different Name',
    slug: 'different-name',
  };
  const result = resolveDesiDubMapping(source, catalog, null, {
    overrides: {},
  });

  assert.equal(result.mapped, false);
  assert.equal(result.method, 'none');
  assert.equal(result.daniId, null);
});

test('resolveDesiDubMapping handles roman numerals and dub noise tokens', () => {
  const catalog = [
    makeCatalogEntry({
      id: 'one-punch-man-2nd-season-42',
      title: 'One Punch Man Season 2',
      slugs: ['one-punch-man-2nd-season-42'],
    }),
  ];

  const source = {
    title: 'One Punch Man Season II Hindi Dub',
    slug: 'one-punch-man-season-ii-hindi-dub',
  };

  const result = resolveDesiDubMapping(source, catalog, null, {
    overrides: {},
  });

  assert.equal(result.mapped, true);
  assert.equal(result.daniId, 'one-punch-man-2nd-season-42');
});

test('resolveDesiDubMapping uses season-aware matching for close titles', () => {
  const catalog = [
    makeCatalogEntry({
      id: 'attack-on-titan-season-2-11',
      title: 'Attack on Titan Season 2',
      slugs: ['attack-on-titan-season-2-11'],
      popularity: 100,
    }),
    makeCatalogEntry({
      id: 'attack-on-titan-season-3-22',
      title: 'Attack on Titan Season 3',
      slugs: ['attack-on-titan-season-3-22'],
      popularity: 1,
    }),
  ];

  const source = {
    title: 'Attack on Titan 3rd Season Hindi Dub',
    slug: 'attack-on-titan-3rd-season-hindi-dub',
  };

  const result = resolveDesiDubMapping(source, catalog, null, {
    overrides: {},
  });

  assert.equal(result.mapped, true);
  assert.equal(result.daniId, 'attack-on-titan-season-3-22');
});
