import desiDubMapOverrides from '../config/desiDubMapOverrides.js';
import { createSearchCandidates, pickAnimeByInput } from './catalog.js';
import { normalizeText, slugify, toNumber, toSafeString } from './normalizers.js';

export const DESIDUB_FUZZY_THRESHOLD = 0.72;
const DESIDUB_ID_PREFIX = 'desidub';
const matcherIndexCache = {
  catalogRef: null,
  index: null,
};

const NAMED_ENTITY_MAP = {
  amp: '&',
  apos: "'",
  quot: '"',
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  ndash: '-',
  mdash: '-',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  hellip: '...',
};

const TITLE_NOISE_WORDS = new Set([
  'hindi',
  'dub',
  'dubbed',
  'multi',
  'audio',
  'uncensored',
  'uncut',
  'episode',
  'ep',
  'watch',
]);

const ROMAN_SYMBOLS = {
  i: 1,
  v: 5,
  x: 10,
  l: 50,
  c: 100,
  d: 500,
  m: 1000,
};

function romanToNumber(value) {
  const input = toSafeString(value).toLowerCase();
  if (!/^[ivxlcdm]+$/.test(input)) return 0;

  let total = 0;
  let previous = 0;
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const current = ROMAN_SYMBOLS[input[i]] || 0;
    if (!current) return 0;
    if (current < previous) {
      total -= current;
    } else {
      total += current;
    }
    previous = current;
  }
  return total;
}

function normalizeRomanNumerals(value) {
  return toSafeString(value).replace(/\b[ivxlcdm]+\b/gi, (token) => {
    const asNumber = romanToNumber(token);
    if (asNumber <= 0 || asNumber > 100) {
      return token;
    }
    return String(asNumber);
  });
}

function stripBracketChunks(value) {
  return toSafeString(value)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/\{[^}]*}/g, ' ');
}

function removeNoiseWords(value) {
  const tokens = toSafeString(value)
    .split(/\s+/)
    .filter((token) => token && !TITLE_NOISE_WORDS.has(token));
  return tokens.join(' ');
}

function canonicalizeCandidate(value, options = {}) {
  const keepNoiseWords = Boolean(options.keepNoiseWords);
  const decoded = decodeHtmlEntities(value)
    .replace(/&/g, ' and ')
    .replace(/[_./]+/g, ' ')
    .replace(/-/g, ' ');
  const stripped = stripBracketChunks(decoded);
  const romanNormalized = normalizeRomanNumerals(stripped);
  const normalized = normalizeText(romanNormalized);
  if (!normalized) {
    return '';
  }

  return keepNoiseWords ? normalized : removeNoiseWords(normalized);
}

function extractSlugFromUrl(value) {
  const input = toSafeString(value);
  if (!input) return '';
  try {
    const parsed = new URL(input);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 1) return '';
    const animeIndex = segments.findIndex((segment) => segment === 'anime');
    if (animeIndex >= 0 && animeIndex + 1 < segments.length) {
      return segments[animeIndex + 1];
    }
    return segments[segments.length - 1];
  } catch {
    return '';
  }
}

function dedupeStrings(values) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const cleaned = toSafeString(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function extractSeasonHint(value) {
  const text = canonicalizeCandidate(value, { keepNoiseWords: true });
  if (!text) return 0;

  const seasonMatch =
    text.match(/\bseason\s*(\d+)\b/i) ||
    text.match(/\b(\d+)\s*(?:st|nd|rd|th)\s*season\b/i) ||
    text.match(/\bpart\s*(\d+)\b/i) ||
    text.match(/\bcour\s*(\d+)\b/i) ||
    text.match(/\bs(\d{1,2})\b/i);

  return seasonMatch?.[1] ? toNumber(seasonMatch[1], 0) : 0;
}

function stripSeasonMarkers(value) {
  return canonicalizeCandidate(value, { keepNoiseWords: true })
    .replace(/\b(?:season|part|cour)\s*\d+\b/gi, ' ')
    .replace(/\b\d+\s*(?:st|nd|rd|th)\s*season\b/gi, ' ')
    .replace(/\bs\d+\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toCharNgramSet(value, size = 3) {
  const normalized = canonicalizeCandidate(value).replace(/\s+/g, '');
  if (!normalized) return new Set();
  if (normalized.length <= size) return new Set([normalized]);

  const grams = new Set();
  for (let i = 0; i <= normalized.length - size; i += 1) {
    grams.add(normalized.slice(i, i + size));
  }
  return grams;
}

function tokenSetFromCanonical(value) {
  const normalized = canonicalizeCandidate(value);
  if (!normalized) return new Set();
  return new Set(normalized.split(' ').filter((token) => token.length > 1));
}

export function decodeHtmlEntities(value) {
  const input = toSafeString(value);
  if (!input) return '';

  return input
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      if (!Number.isFinite(parsed)) return _;
      if (parsed === 8211 || parsed === 8212) return '-';
      return String.fromCodePoint(parsed);
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const parsed = Number.parseInt(hex, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _;
    })
    .replace(/&([a-z]+);/gi, (match, name) => {
      const mapped = NAMED_ENTITY_MAP[String(name).toLowerCase()];
      return mapped ?? match;
    });
}

export function buildDesiSourceCandidates(source) {
  const title = decodeHtmlEntities(source?.title);
  const slug = toSafeString(source?.slug);
  const slugWords = slug.replace(/-/g, ' ').trim();
  const urlSlug = extractSlugFromUrl(source?.url);
  const urlSlugWords = urlSlug.replace(/-/g, ' ').trim();

  const base = dedupeStrings([title, slug, slugWords, urlSlug, urlSlugWords]);
  const expanded = [];
  base.forEach((candidate) => {
    const canonical = canonicalizeCandidate(candidate);
    const canonicalWithNoise = canonicalizeCandidate(candidate, { keepNoiseWords: true });
    const withoutSeason = stripSeasonMarkers(candidate);
    expanded.push(candidate, canonical, canonicalWithNoise, withoutSeason);
  });

  return dedupeStrings(expanded);
}

function normalizeOverrideKey(value) {
  return canonicalizeCandidate(value);
}

function resolveOverrideMapping(source, catalog, overrides) {
  const candidates = dedupeStrings([source?.slug, source?.title, source?.url, extractSlugFromUrl(source?.url)]);
  for (const candidate of candidates) {
    const key = normalizeOverrideKey(candidate);
    if (!key) continue;
    const mappedId = toSafeString(overrides?.[key]);
    if (!mappedId) continue;
    const direct = catalog.find((entry) => entry?.__id === mappedId);
    if (direct) {
      return {
        entry: direct,
        method: 'override',
        confidence: 1,
      };
    }

    const picked = pickAnimeByInput(catalog, mappedId);
    if (picked) {
      return {
        entry: picked,
        method: 'override',
        confidence: 1,
      };
    }
  }
  return null;
}

export function tokenDiceScore(leftTokens, rightTokens) {
  const left = leftTokens instanceof Set ? leftTokens : new Set();
  const right = rightTokens instanceof Set ? rightTokens : new Set();
  if (left.size < 1 || right.size < 1) return 0;

  let intersection = 0;
  left.forEach((token) => {
    if (right.has(token)) intersection += 1;
  });

  return (2 * intersection) / (left.size + right.size);
}

function charDiceScore(leftChars, rightChars) {
  const left = leftChars instanceof Set ? leftChars : new Set();
  const right = rightChars instanceof Set ? rightChars : new Set();
  if (left.size < 1 || right.size < 1) return 0;

  let intersection = 0;
  left.forEach((chunk) => {
    if (right.has(chunk)) intersection += 1;
  });

  return (2 * intersection) / (left.size + right.size);
}

function toCatalogPriority(entry) {
  return {
    popularity: toNumber(entry?.__popularity, Number.MAX_SAFE_INTEGER),
    id: toSafeString(entry?.__id || ''),
  };
}

function pickHigherPriorityMatch(current, incoming) {
  if (!current) return incoming;
  if (incoming.score > current.score) return incoming;
  if (incoming.score < current.score) return current;

  const currentPriority = toCatalogPriority(current.entry);
  const incomingPriority = toCatalogPriority(incoming.entry);
  if (incomingPriority.popularity < currentPriority.popularity) return incoming;
  if (incomingPriority.popularity > currentPriority.popularity) return current;
  return incomingPriority.id < currentPriority.id ? incoming : current;
}

function choosePriorityEntry(current, incoming) {
  if (!current) return incoming;
  const currentPriority = toCatalogPriority(current);
  const incomingPriority = toCatalogPriority(incoming);
  if (incomingPriority.popularity < currentPriority.popularity) return incoming;
  if (incomingPriority.popularity > currentPriority.popularity) return current;
  return incomingPriority.id < currentPriority.id ? incoming : current;
}

function toCandidateFeature(value) {
  const raw = toSafeString(value);
  const normalized = canonicalizeCandidate(raw);
  if (!normalized) return null;
  return {
    raw,
    normalized,
    tokenSet: tokenSetFromCanonical(raw),
    charSet: toCharNgramSet(raw, 3),
    seasonHint: extractSeasonHint(raw),
  };
}

function addToExactLookup(exactLookup, key, entry) {
  const lookupKey = canonicalizeCandidate(key);
  if (!lookupKey) return;
  const current = exactLookup.get(lookupKey);
  exactLookup.set(lookupKey, choosePriorityEntry(current, entry));
}

export function buildCatalogMatcherIndex(catalog) {
  const rows = Array.isArray(catalog) ? catalog : [];
  const exactLookup = new Map();

  const index = rows.map((entry) => {
    const candidatePool = dedupeStrings([
      ...createSearchCandidates(entry),
      toSafeString(entry?.__id),
      stripSeasonMarkers(entry?.__title || ''),
      stripSeasonMarkers(entry?.__altNorm || ''),
    ]);

    const candidates = candidatePool.map((candidate) => toCandidateFeature(candidate)).filter(Boolean);
    candidates.forEach((candidate) => {
      addToExactLookup(exactLookup, candidate.normalized, entry);
      addToExactLookup(exactLookup, stripSeasonMarkers(candidate.normalized), entry);
    });

    return {
      entry,
      candidates,
    };
  });

  index.exactLookup = exactLookup;
  return index;
}

export function getCatalogMatcherIndex(catalog) {
  const rows = Array.isArray(catalog) ? catalog : [];
  if (matcherIndexCache.catalogRef === rows && Array.isArray(matcherIndexCache.index)) {
    return matcherIndexCache.index;
  }

  const index = buildCatalogMatcherIndex(rows);
  matcherIndexCache.catalogRef = rows;
  matcherIndexCache.index = index;
  return index;
}

function scoreCandidatePair(sourceFeature, targetFeature) {
  const tokenScore = tokenDiceScore(sourceFeature?.tokenSet, targetFeature?.tokenSet);
  const gramScore = charDiceScore(sourceFeature?.charSet, targetFeature?.charSet);
  let score = tokenScore * 0.65 + gramScore * 0.35;

  const sourceText = toSafeString(sourceFeature?.normalized);
  const targetText = toSafeString(targetFeature?.normalized);
  if (sourceText && targetText) {
    const isContained = sourceText.includes(targetText) || targetText.includes(sourceText);
    const minLen = Math.min(sourceText.length, targetText.length);
    if (isContained && minLen >= 6) {
      score += 0.05;
    }
  }

  const sourceSeason = toNumber(sourceFeature?.seasonHint, 0);
  const targetSeason = toNumber(targetFeature?.seasonHint, 0);
  if (sourceSeason > 0 && targetSeason > 0) {
    if (sourceSeason === targetSeason) {
      score += 0.04;
    } else {
      score -= 0.18;
    }
  }

  return Math.max(0, Math.min(1, score));
}

function resolveFuzzyMapping(sourceCandidates, matcherIndex, threshold) {
  const sourceFeatures = sourceCandidates.map((candidate) => toCandidateFeature(candidate)).filter(Boolean);
  if (sourceFeatures.length < 1) {
    return null;
  }

  let best = null;
  for (const matcher of matcherIndex) {
    if (!matcher?.entry || !Array.isArray(matcher.candidates) || matcher.candidates.length < 1) {
      continue;
    }

    let bestScoreForEntry = 0;
    for (const sourceFeature of sourceFeatures) {
      for (const targetFeature of matcher.candidates) {
        const score = scoreCandidatePair(sourceFeature, targetFeature);
        if (score > bestScoreForEntry) {
          bestScoreForEntry = score;
        }
      }
    }

    if (bestScoreForEntry < threshold) {
      continue;
    }

    best = pickHigherPriorityMatch(best, {
      entry: matcher.entry,
      score: bestScoreForEntry,
    });
  }

  if (!best) return null;
  return {
    entry: best.entry,
    method: 'fuzzy',
    confidence: Number(best.score.toFixed(4)),
  };
}

export function buildDesiFallbackId(source) {
  const postId = toNumber(source?.postId, 0);
  const slugCandidate = toSafeString(source?.slug) || toSafeString(source?.title) || String(postId || 'item');
  const safeSlug = slugify(decodeHtmlEntities(slugCandidate)) || 'item';
  return `${DESIDUB_ID_PREFIX}-${postId || 'unknown'}-${safeSlug}`;
}

function findExactMatchFromIndex(sourceCandidates, matcherIndex) {
  const exactLookup = matcherIndex?.exactLookup instanceof Map ? matcherIndex.exactLookup : null;
  if (!exactLookup || exactLookup.size < 1) {
    return null;
  }

  for (const candidate of sourceCandidates) {
    const keys = dedupeStrings([canonicalizeCandidate(candidate), stripSeasonMarkers(candidate)]);
    for (const key of keys) {
      const entry = exactLookup.get(key);
      if (entry) {
        return entry;
      }
    }
  }

  return null;
}

export function resolveDesiDubMapping(source, catalog, matcherIndex, options = {}) {
  const rows = Array.isArray(catalog) ? catalog : [];
  const index = Array.isArray(matcherIndex) ? matcherIndex : getCatalogMatcherIndex(rows);
  const overrides = options.overrides || desiDubMapOverrides;
  const threshold = Number(options.threshold);
  const safeThreshold = Number.isFinite(threshold) ? threshold : DESIDUB_FUZZY_THRESHOLD;

  const overrideHit = resolveOverrideMapping(source, rows, overrides);
  if (overrideHit?.entry) {
    return {
      entry: overrideHit.entry,
      daniId: toSafeString(overrideHit.entry.__id),
      method: overrideHit.method,
      confidence: overrideHit.confidence,
      mapped: true,
    };
  }

  const sourceCandidates = buildDesiSourceCandidates(source);

  const exactFromLookup = findExactMatchFromIndex(sourceCandidates, index);
  if (exactFromLookup) {
    return {
      entry: exactFromLookup,
      daniId: toSafeString(exactFromLookup.__id),
      method: 'exact',
      confidence: 1,
      mapped: true,
    };
  }

  for (const candidate of sourceCandidates) {
    const exact =
      pickAnimeByInput(rows, candidate) ||
      pickAnimeByInput(rows, canonicalizeCandidate(candidate, { keepNoiseWords: true }));
    if (exact) {
      return {
        entry: exact,
        daniId: toSafeString(exact.__id),
        method: 'exact',
        confidence: 1,
        mapped: true,
      };
    }
  }

  const fuzzyHit = resolveFuzzyMapping(sourceCandidates, index, safeThreshold);
  if (fuzzyHit?.entry) {
    return {
      entry: fuzzyHit.entry,
      daniId: toSafeString(fuzzyHit.entry.__id),
      method: fuzzyHit.method,
      confidence: fuzzyHit.confidence,
      mapped: true,
    };
  }

  return {
    entry: null,
    daniId: null,
    method: 'none',
    confidence: 0,
    mapped: false,
  };
}
