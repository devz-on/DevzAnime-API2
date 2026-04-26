import { NotFoundError } from '../utils/errors.js';
import { fetchApi } from './upstream.js';
import {
  DEFAULT_PAGE_SIZE,
  getAlternativeTitle,
  getAnimeSlug,
  getBestAnimeTitle,
  normalizeText,
  toNumber,
  toSafeString,
} from './normalizers.js';
import { getProviderConfig } from './upstream.js';

const sharedCache = {
  catalog: null,
  catalogAt: 0,
  catalogPromise: null,
  animeDetails: new Map(),
};

function now() {
  return Date.now();
}

function safeNormalizeText(value) {
  try {
    return normalizeText(value);
  } catch {
    return toSafeString(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
}

function toNormalizedCatalogEntry(anime) {
  const title = getBestAnimeTitle(anime);
  const id = getAnimeSlug(anime);
  const titleNorm = normalizeText(title);
  const altNorm = normalizeText(getAlternativeTitle(anime));
  const slugCandidates = [
    ...(Array.isArray(anime?.slugs) ? anime.slugs : []),
    toSafeString(anime?.slug),
  ]
    .filter(Boolean)
    .map((slug) => safeNormalizeText(slug));
  const searchCandidates = [...new Set([titleNorm, altNorm, ...slugCandidates].filter(Boolean))];
  return {
    ...anime,
    __id: id,
    __title: title,
    __titleNorm: titleNorm,
    __altNorm: altNorm,
    __searchCandidates: searchCandidates,
    __producerNorm: normalizeText(toSafeString(anime?.Producers)),
    __genresNorm: Array.isArray(anime?.genres) ? anime.genres.map((g) => normalizeText(g)) : [],
    __favorites: toNumber(anime?.Favorites),
    __score: toNumber(anime?.Score || anime?.score),
    __popularity: toNumber(anime?.Popularity),
    __members: toNumber(anime?.Members),
    __createdAt: (() => {
      const date = new Date(anime?.createdAt || 0);
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    })(),
  };
}

export async function loadCatalog(c) {
  const config = getProviderConfig(c);
  const cacheValid =
    sharedCache.catalog && now() - sharedCache.catalogAt < config.catalogCacheTtlSeconds * 1000;
  if (cacheValid) {
    return sharedCache.catalog;
  }

  if (sharedCache.catalogPromise) {
    return sharedCache.catalogPromise;
  }

  const inFlightPromise = (async () => {
    const all = [];
    let cursor = null;
    let pages = 0;

    while (pages < config.maxCatalogPages) {
      const payload = await fetchApi('/anime', c, {
        limit: 1000,
        cursor: cursor || undefined,
      });
      const rows = Array.isArray(payload?.animes) ? payload.animes : [];
      all.push(...rows.map(toNormalizedCatalogEntry));
      pages += 1;
      if (!payload?.hasNextPage || !payload?.nextCursor) {
        break;
      }
      cursor = payload.nextCursor;
    }

    if (all.length < 1) {
      throw new NotFoundError('catalog not available');
    }

    sharedCache.catalog = all;
    sharedCache.catalogAt = now();
    return all;
  })();

  sharedCache.catalogPromise = inFlightPromise;
  try {
    return await inFlightPromise;
  } finally {
    if (sharedCache.catalogPromise === inFlightPromise) {
      sharedCache.catalogPromise = null;
    }
  }
}

export function getCachedCatalog(c) {
  const config = getProviderConfig(c);
  const cacheValid =
    sharedCache.catalog && now() - sharedCache.catalogAt < config.catalogCacheTtlSeconds * 1000;
  return cacheValid ? sharedCache.catalog : null;
}

export async function warmCatalog(c) {
  try {
    await loadCatalog(c);
  } catch {
    // Best-effort background warmup only.
  }
}

export function createSearchCandidates(entry) {
  if (Array.isArray(entry?.__searchCandidates) && entry.__searchCandidates.length > 0) {
    return entry.__searchCandidates;
  }
  const candidates = [entry.__titleNorm, entry.__altNorm, safeNormalizeText(entry?.slug)];
  if (Array.isArray(entry?.slugs)) {
    entry.slugs.forEach((slug) => candidates.push(safeNormalizeText(slug)));
  }
  return [...new Set(candidates.filter(Boolean))];
}

export function pickAnimeByInput(catalog, rawId) {
  const input = toSafeString(rawId);
  if (!input) {
    return null;
  }

  const decoded = decodeURIComponent(input);
  const normalized = normalizeText(decoded);
  const withoutTrailingNumeric = decoded.replace(/-\d+$/, '');
  const normalizedWithoutNumeric = normalizeText(withoutTrailingNumeric);

  const exact = catalog.find((entry) => entry.__id === decoded);
  if (exact) return exact;

  const exactWithoutNumeric = catalog.find((entry) => entry.__id === withoutTrailingNumeric);
  if (exactWithoutNumeric) return exactWithoutNumeric;

  const trailingNumericMatch = decoded.match(/-(\d+)$/);
  const trailingNumeric = toNumber(trailingNumericMatch?.[1], 0);
  if (trailingNumeric > 0) {
    const byMalId = catalog.find((entry) => toNumber(entry?.mal_id, 0) === trailingNumeric);
    if (byMalId) {
      return byMalId;
    }
  }

  const fuzzy = catalog.find((entry) => {
    if (entry.__titleNorm === normalized || entry.__altNorm === normalized) return true;
    if (
      entry.__titleNorm === normalizedWithoutNumeric ||
      entry.__altNorm === normalizedWithoutNumeric
    )
      return true;
    if (safeNormalizeText(entry?.slug) === normalized) return true;
    if (
      Array.isArray(entry?.slugs) &&
      entry.slugs.some((slug) => normalizeText(slug) === normalized)
    )
      return true;
    return false;
  });

  return fuzzy || null;
}

export function toLegacyEpisodeId(animeId, episode) {
  const episodeRef = toSafeString(episode?._id || episode?.episodeNumber || '');
  return `${animeId}::ep=${episodeRef}`;
}

export function parseLegacyEpisodeId(rawEpisodeId) {
  const decoded = decodeURIComponent(toSafeString(rawEpisodeId));
  const match = decoded.match(/^(.*)::ep=(.*)$/);
  if (!match) {
    return {
      animeId: decoded,
      episodeRef: '',
    };
  }
  return {
    animeId: toSafeString(match[1]),
    episodeRef: toSafeString(match[2]),
  };
}

export async function loadAnimeDetails(inputId, c) {
  const config = getProviderConfig(c);
  const cacheKey = normalizeText(inputId);
  const cached = sharedCache.animeDetails.get(cacheKey);
  if (cached && now() - cached.cachedAt < config.detailCacheTtlSeconds * 1000) {
    return cached.value;
  }

  const catalog = await loadCatalog(c);
  let catalogEntry = pickAnimeByInput(catalog, inputId);
  if (!catalogEntry) {
    catalogEntry = await findCatalogEntryByDeepScan(inputId, c, config);
    if (catalogEntry && Array.isArray(sharedCache.catalog)) {
      const exists = sharedCache.catalog.some(
        (entry) => entry.__id === catalogEntry.__id || entry._id === catalogEntry._id
      );
      if (!exists) {
        sharedCache.catalog.push(catalogEntry);
      }
    }
  }
  if (!catalogEntry) {
    throw new NotFoundError('anime not found');
  }

  const detailPayload = await fetchApi(`/anime/${encodeURIComponent(catalogEntry.__id)}`, c);
  const anime = detailPayload?.anime || {};
  const animeObjectId = toSafeString(anime?._id || catalogEntry?._id);
  if (!animeObjectId) {
    throw new NotFoundError('anime id mapping missing');
  }

  const totalEpisodes = Math.max(
    toNumber(anime?.totalEpisodes, 0),
    toNumber(catalogEntry?.totalEpisodes, 0)
  );
  const episodesPayload = await fetchApi(`/episodes/${encodeURIComponent(animeObjectId)}`, c, {
    start: 0,
    end: totalEpisodes > 0 ? totalEpisodes : 2000,
  });
  const episodes = Array.isArray(episodesPayload?.episodes) ? episodesPayload.episodes : [];

  const result = {
    catalogEntry,
    anime: {
      ...catalogEntry,
      ...anime,
      __id: catalogEntry.__id,
    },
    episodes,
    total: toNumber(episodesPayload?.total, episodes.length),
  };

  sharedCache.animeDetails.set(cacheKey, {
    cachedAt: now(),
    value: result,
  });

  return result;
}

export async function resolveEpisode(rawEpisodeId, c) {
  const { animeId, episodeRef } = parseLegacyEpisodeId(rawEpisodeId);
  const { anime, episodes } = await loadAnimeDetails(animeId, c);

  if (!episodeRef) {
    const firstEpisode = episodes[0];
    if (!firstEpisode) {
      throw new NotFoundError('episode not found');
    }
    return { anime, episode: firstEpisode };
  }

  const numericEpisodeRef = toNumber(episodeRef, -1);
  const found =
    episodes.find((ep) => toSafeString(ep?._id) === episodeRef) ||
    episodes.find((ep) => toNumber(ep?.episodeNumber, -2) === numericEpisodeRef);

  if (!found) {
    throw new NotFoundError('episode not found');
  }

  return { anime, episode: found };
}

async function findCatalogEntryByDeepScan(inputId, c, config) {
  const maxPages = Math.max(config?.maxCatalogPages || 0, 30);
  let cursor = null;
  let pages = 0;

  while (pages < maxPages) {
    const payload = await fetchApi('/anime', c, {
      limit: 1000,
      cursor: cursor || undefined,
    });
    const rows = Array.isArray(payload?.animes) ? payload.animes : [];
    if (rows.length < 1) {
      break;
    }

    const normalizedRows = rows.map(toNormalizedCatalogEntry);
    const match = pickAnimeByInput(normalizedRows, inputId);
    if (match) {
      return match;
    }

    pages += 1;
    if (!payload?.hasNextPage || !payload?.nextCursor) {
      break;
    }
    cursor = payload.nextCursor;
  }

  return null;
}

export function paginateExplore(animes, page, toExploreAnime) {
  const pageNum = Math.max(1, toNumber(page, 1));
  const totalPages = Math.max(1, Math.ceil(animes.length / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(pageNum, totalPages);
  const start = (currentPage - 1) * DEFAULT_PAGE_SIZE;
  const rows = animes.slice(start, start + DEFAULT_PAGE_SIZE).map((entry) => toExploreAnime(entry));
  return {
    pageInfo: {
      currentPage,
      totalPages,
      hasNextPage: currentPage < totalPages,
    },
    response: rows,
  };
}
