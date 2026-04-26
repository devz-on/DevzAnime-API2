import { filterOptions } from '../config/meta.js';
import { validationError } from '../utils/errors.js';
import {
  createSearchCandidates,
  getCachedCatalog,
  loadCatalog,
  paginateExplore,
  warmCatalog,
} from './catalog.js';
import {
  DEFAULT_PAGE_SIZE,
  formatDateYYYYMMDD,
  formatTimeHHMM,
  getAnimeSlug,
  normalizeText,
  parseDateFromCreatedAt,
  toBasicAnime,
  toExploreAnime,
  toNumber,
  toNumericScoreBucket,
  toSafeString,
  toSpotlightAnime,
  unwrapAnimeEntry,
} from './normalizers.js';
import { fetchApi, getProviderConfig } from './upstream.js';
import {
  getHianimeWebExploreData,
  getHianimeWebHomeData,
  getHianimeWebSearchData,
  getHianimeWebSuggestionData,
} from './hianimeWeb.js';

const sharedCache = {
  homeData: null,
  homeAt: 0,
  homePromise: null,
  latestEpisodes: null,
  latestEpisodesAt: 0,
};

function now() {
  return Date.now();
}

function toExplorePageResponse(animes, page) {
  return paginateExplore(animes, page, toExploreAnime);
}

function entryMatchesKeyword(entry, normalizedKeyword) {
  return createSearchCandidates(entry).some((candidate) => candidate.includes(normalizedKeyword));
}

function getCatalogSearchPage(catalog, normalizedKeyword, page) {
  const requestedPage = Math.max(1, toNumber(page, 1));
  let totalMatches = 0;

  for (const entry of catalog) {
    if (entryMatchesKeyword(entry, normalizedKeyword)) {
      totalMatches += 1;
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalMatches / DEFAULT_PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);
  const start = (currentPage - 1) * DEFAULT_PAGE_SIZE;
  const end = start + DEFAULT_PAGE_SIZE;
  const response = [];
  let seenMatches = 0;

  for (const entry of catalog) {
    if (!entryMatchesKeyword(entry, normalizedKeyword)) {
      continue;
    }

    if (seenMatches >= start && seenMatches < end) {
      response.push(toExploreAnime(entry));
    }

    seenMatches += 1;
    if (seenMatches >= end) {
      break;
    }
  }

  return {
    pageInfo: {
      currentPage,
      totalPages,
      hasNextPage: currentPage < totalPages,
    },
    response,
  };
}

function pickCollection(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
    if (candidate && typeof candidate === 'object') {
      if (Array.isArray(candidate.animes)) {
        return candidate.animes;
      }
      if (Array.isArray(candidate.episodes)) {
        return candidate.episodes;
      }
    }
  }
  return [];
}

function mapBasicRows(rows, limit = 20) {
  return rows
    .map((entry) => unwrapAnimeEntry(entry))
    .filter(Boolean)
    .slice(0, limit)
    .map((entry) => toBasicAnime(entry));
}

function mapTypedRows(rows, limit = 20) {
  return rows
    .map((entry) => unwrapAnimeEntry(entry))
    .filter(Boolean)
    .slice(0, limit)
    .map((entry) => ({
      ...toBasicAnime(entry),
      type: toSafeString(entry?.Type || entry?.type || 'TV'),
    }));
}

function mapRankedRows(rows, limit = 20) {
  return rows
    .map((entry) => unwrapAnimeEntry(entry))
    .filter(Boolean)
    .slice(0, limit)
    .map((entry, index) => ({ ...toBasicAnime(entry), rank: index + 1 }));
}

function normalizeGenresFromHome(homePayload) {
  const rows = Array.isArray(homePayload?.genres) ? homePayload.genres : [];
  const mapped = rows
    .map((genre) => {
      if (typeof genre === 'string') {
        return toSafeString(genre);
      }
      if (genre && typeof genre === 'object') {
        return toSafeString(genre?.name || genre?.title || genre?.genre);
      }
      return '';
    })
    .filter(Boolean);

  return [...new Set(mapped)].slice(0, 80).map((name) => ({ name }));
}

function runInBackground(c, task) {
  const promise = Promise.resolve()
    .then(task)
    .catch(() => null);
  let executionCtx = null;
  try {
    executionCtx = c?.executionCtx || null;
  } catch {
    executionCtx = null;
  }
  const waitUntil = executionCtx?.waitUntil;
  if (typeof waitUntil === 'function') {
    waitUntil.call(executionCtx, promise);
    return;
  }
  void promise;
}

async function getLatestEpisodes(c) {
  const config = getProviderConfig(c);
  const cacheValid =
    sharedCache.latestEpisodes &&
    now() - sharedCache.latestEpisodesAt < Math.min(180, config.catalogCacheTtlSeconds) * 1000;
  if (cacheValid) {
    return sharedCache.latestEpisodes;
  }
  const payload = await fetchApi('/latest/episode', c, { page: 1, limit: 1000 });
  const episodes = Array.isArray(payload?.episodes) ? payload.episodes : [];
  sharedCache.latestEpisodes = episodes;
  sharedCache.latestEpisodesAt = now();
  return episodes;
}

export async function getHomeData(c) {
  const config = getProviderConfig(c);
  const homeCacheTtlMs = Math.min(300, config.catalogCacheTtlSeconds) * 1000;
  const cacheValid = sharedCache.homeData && now() - sharedCache.homeAt < homeCacheTtlMs;
  if (cacheValid) {
    return sharedCache.homeData;
  }

  if (sharedCache.homePromise) {
    return sharedCache.homePromise;
  }

  sharedCache.homePromise = (async () => {
    try {
      const homePayload = await fetchApi('/home', c, { slugNth: 12, includeSlugs: false });

      const featured = pickCollection(homePayload?.featured, homePayload?.spotlight);
      const currentlyAiring = pickCollection(homePayload?.currentlyAiring, homePayload?.topAiring);
      const finishedAiring = pickCollection(
        homePayload?.finishedAiring,
        homePayload?.latestCompleted
      );
      const latestAnime = pickCollection(homePayload?.latestAnime, homePayload?.newAdded);
      const latestEpisodesRows = pickCollection(
        homePayload?.latestEpisodes,
        homePayload?.latestEpisode
      );

      let trending = pickCollection(homePayload?.trending);
      let popular = pickCollection(homePayload?.mostPopular);
      if (!trending.length || !popular.length) {
        const [trendingResult, popularResult] = await Promise.allSettled([
          trending.length
            ? Promise.resolve({ animes: trending })
            : fetchApi('/anime/trending', c, { page: 1, limit: 20 }),
          popular.length
            ? Promise.resolve({ animes: popular })
            : fetchApi('/anime/popular', c, { page: 1, limit: 20 }),
        ]);
        if (!trending.length && trendingResult.status === 'fulfilled') {
          trending = pickCollection(trendingResult.value?.animes);
        }
        if (!popular.length && popularResult.status === 'fulfilled') {
          popular = pickCollection(popularResult.value?.animes);
        }
      }

      const cachedCatalog = getCachedCatalog(c);
      if (!cachedCatalog) {
        runInBackground(c, () => warmCatalog(c));
      }
      const catalog = cachedCatalog || [];

      const upcomingFromHome = pickCollection(homePayload?.topUpcoming);
      const favoriteFromHome = pickCollection(homePayload?.mostFavorite);
      const upcoming = upcomingFromHome.length
        ? upcomingFromHome.slice(0, 20)
        : catalog
            .filter(
              (entry) =>
                normalizeText(entry.Status).includes('not yet') ||
                normalizeText(entry.Status).includes('upcoming')
            )
            .slice(0, 20);
      const mostFavorite = favoriteFromHome.length
        ? favoriteFromHome.slice(0, 20)
        : catalog.length
          ? [...catalog].sort((a, b) => b.__favorites - a.__favorites).slice(0, 20)
          : popular.slice(0, 20);

      let genres = normalizeGenresFromHome(homePayload);
      if (!genres.length && catalog.length) {
        genres = [...new Set(catalog.flatMap((entry) => entry.genres || []).filter(Boolean))]
          .slice(0, 80)
          .map((genre) => ({ name: genre }));
      }
      if (!genres.length) {
        genres = [...new Set((filterOptions?.genres || []).filter(Boolean))]
          .slice(0, 80)
          .map((genre) => ({ name: genre }));
      }

      const response = {
        spotlight: featured
          .map((entry) => unwrapAnimeEntry(entry))
          .filter(Boolean)
          .map((entry, index) => toSpotlightAnime(entry, index + 1)),
        trending: mapRankedRows(trending),
        topAiring: mapTypedRows(currentlyAiring),
        mostPopular: mapTypedRows(popular),
        mostFavorite: mapTypedRows(mostFavorite),
        latestCompleted: mapTypedRows(finishedAiring),
        latestEpisode: mapBasicRows(latestEpisodesRows),
        newAdded: mapBasicRows(latestAnime),
        topUpcoming: mapBasicRows(upcoming),
        topTen: {
          today: (() => {
            const rows = pickCollection(homePayload?.topTen?.today);
            return mapBasicRows(rows.length ? rows : trending.slice(0, 10), 10);
          })(),
          week: (() => {
            const rows = pickCollection(homePayload?.topTen?.week);
            return mapBasicRows(rows.length ? rows : popular.slice(0, 10), 10);
          })(),
          month: (() => {
            const rows = pickCollection(homePayload?.topTen?.month);
            return mapBasicRows(rows.length ? rows : popular.slice(10, 20), 10);
          })(),
        },
        genres,
      };

      sharedCache.homeData = response;
      sharedCache.homeAt = now();
      return response;
    } catch {
      if (sharedCache.homeData) {
        return sharedCache.homeData;
      }
      const fallbackHome = await getHianimeWebHomeData(c);
      sharedCache.homeData = fallbackHome;
      sharedCache.homeAt = now();
      return fallbackHome;
    } finally {
      sharedCache.homePromise = null;
    }
  })();

  return sharedCache.homePromise;
}

export async function getSpotlightData(c) {
  const home = await getHomeData(c);
  return home.spotlight;
}

export async function getTopTenData(c) {
  const home = await getHomeData(c);
  return home.topTen;
}

export async function getSearchData(keyword, page, c) {
  try {
    const catalog = await loadCatalog(c);
    const normalizedKeyword = normalizeText(keyword);
    return getCatalogSearchPage(catalog, normalizedKeyword, page);
  } catch {
    return getHianimeWebSearchData(keyword, page, c);
  }
}

export async function getSuggestionData(keyword, c) {
  try {
    const search = await getSearchData(keyword, 1, c);
    return search.response.slice(0, 12).map((entry) => ({
      title: entry.title,
      alternativeTitle: entry.alternativeTitle,
      id: entry.id,
      poster: entry.poster,
      aired: '',
      type: entry.type,
      duration: entry.duration,
    }));
  } catch {
    return getHianimeWebSuggestionData(keyword, c);
  }
}

export async function getExploreData(query, page, c) {
  const normalized = toSafeString(query).toLowerCase();
  const pageNum = Math.max(1, toNumber(page, 1));
  try {
    if (['movie', 'tv', 'ova', 'ona', 'special'].includes(normalized)) {
      const payload = await fetchApi('/category', c, {
        type: normalized,
        page: pageNum,
        limit: 20,
      });
      return {
        pageInfo: {
          currentPage: toNumber(payload?.meta?.page, pageNum),
          totalPages: Math.max(1, toNumber(payload?.meta?.totalPages, 1)),
          hasNextPage:
            toNumber(payload?.meta?.page, pageNum) < toNumber(payload?.meta?.totalPages, 1),
        },
        response: (payload?.animes || []).map((anime) => toExploreAnime(anime)),
      };
    }

    if (normalized === 'top-airing') {
      const payload = await fetchApi('/anime/trending', c, { page: pageNum, limit: 100 });
      const list = payload?.animes || [];
      return toExplorePageResponse(list, 1);
    }

    if (normalized === 'most-popular') {
      const payload = await fetchApi('/anime/popular', c, { page: pageNum, limit: 20 });
      return {
        pageInfo: {
          currentPage: toNumber(payload?.meta?.page, pageNum),
          totalPages: Math.max(1, toNumber(payload?.meta?.totalPages, 1)),
          hasNextPage:
            toNumber(payload?.meta?.page, pageNum) < toNumber(payload?.meta?.totalPages, 1),
        },
        response: (payload?.animes || []).map((anime) => toExploreAnime(anime)),
      };
    }

    if (normalized === 'recently-added') {
      const payload = await fetchApi('/latest/anime', c, { page: pageNum, limit: 20 });
      const totalPages = Math.max(1, toNumber(payload?.totalPages, 1));
      const currentPage = Math.max(1, toNumber(payload?.page, pageNum));
      return {
        pageInfo: {
          currentPage,
          totalPages,
          hasNextPage: currentPage < totalPages,
        },
        response: (payload?.animes || []).map((anime) => toExploreAnime(anime)),
      };
    }

    if (normalized === 'recently-updated') {
      const payload = await fetchApi('/latest/episode', c, { page: pageNum, limit: 100 });
      const seen = new Set();
      const mapped = [];
      for (const episode of payload?.episodes || []) {
        const anime = unwrapAnimeEntry(episode?.anime_info);
        const animeId = getAnimeSlug(anime || {});
        if (!anime || seen.has(animeId)) {
          continue;
        }
        seen.add(animeId);
        mapped.push(toExploreAnime(anime));
        if (mapped.length >= 20) {
          break;
        }
      }
      return {
        pageInfo: {
          currentPage: toNumber(payload?.currentPage, pageNum),
          totalPages: Math.max(1, toNumber(payload?.totalPages, pageNum)),
          hasNextPage:
            toNumber(payload?.currentPage, pageNum) < toNumber(payload?.totalPages, pageNum),
        },
        response: mapped,
      };
    }

    const catalog = await loadCatalog(c);
    let list = catalog;

    if (normalized === 'most-favorite') {
      list = [...catalog].sort((a, b) => b.__favorites - a.__favorites);
    } else if (normalized === 'completed') {
      list = catalog.filter((entry) => normalizeText(entry.Status).includes('finished'));
    } else if (normalized === 'top-upcoming') {
      list = catalog.filter(
        (entry) =>
          normalizeText(entry.Status).includes('not yet') ||
          normalizeText(entry.Status).includes('upcoming')
      );
    } else if (normalized === 'subbed-anime') {
      list = catalog.filter((entry) => toNumber(entry.totalSubbed || entry.totalSub) > 0);
    } else if (normalized === 'dubbed-anime') {
      list = catalog.filter((entry) => toNumber(entry.totalDubbed || entry.totalDub) > 0);
    }

    return toExplorePageResponse(list, pageNum);
  } catch {
    return getHianimeWebExploreData(normalized, pageNum, c);
  }
}

export async function getGenreData(genre, page, c) {
  const normalizedGenre = normalizeText(genre.replace(/_/g, ' '));
  const catalog = await loadCatalog(c);
  const filtered = catalog.filter((entry) => entry.__genresNorm.includes(normalizedGenre));
  return toExplorePageResponse(filtered, page);
}

export async function getProducerData(producerId, page, c) {
  const normalizedProducer = normalizeText(producerId.replace(/-/g, ' '));
  const catalog = await loadCatalog(c);
  const filtered = catalog.filter((entry) => entry.__producerNorm.includes(normalizedProducer));
  return toExplorePageResponse(filtered, page);
}

export async function getAzListData(letter, page, c) {
  const normalizedLetter = toSafeString(letter).toLowerCase();
  const catalog = await loadCatalog(c);
  const filtered = catalog.filter((entry) => {
    const first = entry.__titleNorm.charAt(0);
    if (normalizedLetter === 'all') return true;
    if (normalizedLetter === 'other') return !/^[a-z0-9]$/.test(first);
    if (normalizedLetter === '0-9') return /^[0-9]$/.test(first);
    return first === normalizedLetter;
  });
  return toExplorePageResponse(filtered, page);
}

export function validateFilterQuery(query) {
  if (!query) return;
  if (query.type && !filterOptions.type.includes(query.type)) {
    throw new validationError('invalid type');
  }
  if (query.status && !filterOptions.status.includes(query.status)) {
    throw new validationError('invalid status');
  }
  if (query.rated && !filterOptions.rated.includes(query.rated)) {
    throw new validationError('invalid rated');
  }
  if (query.score && !filterOptions.score.includes(query.score)) {
    throw new validationError('invalid score');
  }
  if (query.season && !filterOptions.season.includes(query.season)) {
    throw new validationError('invalid season');
  }
  if (query.language && !filterOptions.language.includes(query.language)) {
    throw new validationError('invalid language');
  }
  if (query.sort && !filterOptions.sort.includes(query.sort)) {
    throw new validationError('invalid sort');
  }
}

export async function getFilterData(query, c) {
  validateFilterQuery(query);
  const catalog = await loadCatalog(c);
  let filtered = [...catalog];

  const keyword = toSafeString(query?.keyword);
  if (keyword) {
    const normalizedKeyword = normalizeText(keyword);
    filtered = filtered.filter((entry) =>
      createSearchCandidates(entry).some((candidate) => candidate.includes(normalizedKeyword))
    );
  }

  if (query?.type && query.type !== 'all') {
    const typeNorm = normalizeText(query.type);
    filtered = filtered.filter((entry) => normalizeText(entry.Type).includes(typeNorm));
  }

  if (query?.status && query.status !== 'all') {
    const statusNorm = normalizeText(query.status.replace(/_/g, ' '));
    filtered = filtered.filter((entry) => normalizeText(entry.Status).includes(statusNorm));
  }

  if (query?.language && query.language !== 'all') {
    if (query.language === 'sub') {
      filtered = filtered.filter((entry) => toNumber(entry.totalSubbed || entry.totalSub) > 0);
    } else if (query.language === 'dub') {
      filtered = filtered.filter((entry) => toNumber(entry.totalDubbed || entry.totalDub) > 0);
    } else if (query.language === 'sub_dub') {
      filtered = filtered.filter(
        (entry) =>
          toNumber(entry.totalDubbed || entry.totalDub) > 0 &&
          toNumber(entry.totalSubbed || entry.totalSub) > 0
      );
    }
  }

  if (query?.genres) {
    const normalizedGenre = normalizeText(String(query.genres).replace(/_/g, ' '));
    filtered = filtered.filter((entry) => entry.__genresNorm.includes(normalizedGenre));
  }

  if (query?.score && query.score !== 'all') {
    filtered = filtered.filter((entry) => toNumericScoreBucket(entry.__score) === query.score);
  }

  const sort = toSafeString(query?.sort || 'default');
  if (sort === 'score') {
    filtered.sort((a, b) => b.__score - a.__score);
  } else if (sort === 'name_az') {
    filtered.sort((a, b) => a.__title.localeCompare(b.__title));
  } else if (sort === 'recently_added' || sort === 'recently_updated' || sort === 'release_date') {
    filtered.sort((a, b) => b.__createdAt - a.__createdAt);
  } else if (sort === 'most_watched') {
    filtered.sort((a, b) => b.__members - a.__members);
  }

  const page = Math.max(1, toNumber(query?.page, 1));
  return toExplorePageResponse(filtered, page);
}

export async function getScheduleData(dateQuery, c) {
  const today = new Date();
  const queryDay = toNumber(dateQuery, today.getDate());
  const safeDay = Math.min(31, Math.max(1, queryDay));

  const episodes = await getLatestEpisodes(c);
  const scheduleItems = episodes
    .map((entry) => {
      const created = parseDateFromCreatedAt(entry?.createdAt);
      if (!created || created.getDate() !== safeDay) {
        return null;
      }
      const anime = unwrapAnimeEntry(entry?.anime_info);
      if (!anime) {
        return null;
      }
      return {
        title: toSafeString(anime?.title || anime?.English || anime?.Japanese),
        alternativeTitle: toSafeString(anime?.Japanese || anime?.title || anime?.English),
        id: getAnimeSlug(anime),
        time: formatTimeHHMM(created),
        episode: toNumber(entry?.episodeNumber, 0),
      };
    })
    .filter(Boolean);

  const currentDate = formatDateYYYYMMDD(today);
  const targetDate = new Date(today.getFullYear(), today.getMonth(), safeDay);
  const lastDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return {
    meta: {
      date: formatDateYYYYMMDD(targetDate),
      currentDate,
      lastDate: formatDateYYYYMMDD(lastDate),
    },
    response: scheduleItems,
  };
}

export async function getNextScheduleData(id, c, loadAnimeDetails) {
  const { anime, episodes } = await loadAnimeDetails(id, c);
  const latestEpisodes = await getLatestEpisodes(c);
  const animeObjectId = toSafeString(anime?._id || anime?.anime_id || '');

  const latestSeen = latestEpisodes
    .filter((entry) => toSafeString(entry?.anime_id) === animeObjectId)
    .reduce((max, entry) => Math.max(max, toNumber(entry?.episodeNumber, 0)), 0);

  const totalEpisodes = Math.max(toNumber(anime?.totalEpisodes, 0), episodes.length);
  if (latestSeen >= totalEpisodes && totalEpisodes > 0) {
    return { time: null };
  }

  return { time: toSafeString(anime?.Aired || '') || null };
}
