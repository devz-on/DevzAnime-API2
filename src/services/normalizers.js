export const SERVER_NAMES = ['hd-1', 'hd-2', 'hd-3', 'megaplay', 'vidwish'];
export const DEFAULT_PAGE_SIZE = 20;

export function toSafeString(value) {
  return String(value ?? '').trim();
}

export function toNumber(value, fallback = 0) {
  const numeric = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function normalizeText(value) {
  return toSafeString(decodeURIComponent(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function slugify(value) {
  return toSafeString(value)
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseAired(airedText) {
  const raw = toSafeString(airedText);
  if (!raw) {
    return { from: null, to: null };
  }
  const split = raw.split('to');
  const from = toSafeString(split[0]) || null;
  const toRaw = toSafeString(split[1] || '');
  const to = !toRaw || toRaw === '?' ? null : toRaw;
  return { from, to };
}

export function parseDateFromCreatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function formatDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatTimeHHMM(date) {
  const hours = String(date.getHours()).padStart(2, '0');
  const mins = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${mins}`;
}

export function unwrapAnimeEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }
  return entry.anime || entry.anime_info || entry;
}

export function getBestAnimeTitle(anime) {
  return (
    toSafeString(anime?.title) ||
    toSafeString(anime?.English) ||
    toSafeString(anime?.Japanese) ||
    'Unknown'
  );
}

export function getAlternativeTitle(anime) {
  return (
    toSafeString(anime?.alternateTitle) ||
    toSafeString(anime?.other_title) ||
    toSafeString(anime?.Japanese) ||
    getBestAnimeTitle(anime)
  );
}

export function getAnimeSlug(anime) {
  const explicitSlug = toSafeString(anime?.slug);
  if (explicitSlug) {
    return explicitSlug;
  }
  if (Array.isArray(anime?.slugs) && anime.slugs.length > 0) {
    return toSafeString(anime.slugs[0]);
  }
  const titleSlug = slugify(getBestAnimeTitle(anime));
  const suffix = toSafeString(anime?.mal_id || anime?._id || '');
  return suffix ? `${titleSlug}-${suffix}` : titleSlug;
}

export function toEpisodeCount(anime) {
  const sub = toNumber(anime?.totalSub ?? anime?.totalSubbed ?? anime?.sub, 0);
  const dub = toNumber(anime?.totalDub ?? anime?.totalDubbed ?? anime?.dub, 0);
  const eps = toNumber(anime?.totalEpisodes ?? anime?.episodes, 0) || Math.max(sub, dub);
  return { sub, dub, eps };
}

export function toBasicAnime(anime) {
  const slug = getAnimeSlug(anime);
  return {
    title: getBestAnimeTitle(anime),
    alternativeTitle: getAlternativeTitle(anime),
    id: slug,
    poster: toSafeString(anime?.image || anime?.poster || anime?.sposter || anime?.bposter),
    episodes: toEpisodeCount(anime),
  };
}

export function toExploreAnime(anime) {
  return {
    ...toBasicAnime(anime),
    type: toSafeString(anime?.Type || anime?.type || 'TV'),
    duration: toSafeString(anime?.Duration || anime?.duration || 'N/A'),
  };
}

export function toSpotlightAnime(anime, rank = 1) {
  const synopsis = toSafeString(
    anime?.synopsis ||
      anime?.description ||
      anime?.plot_summary ||
      anime?.storyline ||
      anime?.summary ||
      anime?.about
  );
  return {
    ...toBasicAnime(anime),
    rank,
    type: toSafeString(anime?.Type || 'TV'),
    quality: toSafeString(anime?.Rating || 'HD'),
    duration: toSafeString(anime?.Duration || 'N/A'),
    aired: toSafeString(anime?.Aired || ''),
    synopsis,
  };
}

export function toNumericScoreBucket(score) {
  const numericScore = toNumber(score, 0);
  if (numericScore >= 9.5) return 'masterpiece';
  if (numericScore >= 8.5) return 'great';
  if (numericScore >= 7.5) return 'very_good';
  if (numericScore >= 6.5) return 'good';
  if (numericScore >= 5.5) return 'fine';
  if (numericScore >= 4.5) return 'average';
  if (numericScore >= 3.5) return 'bad';
  if (numericScore >= 2.5) return 'very_bad';
  if (numericScore >= 1.5) return 'horrible';
  return 'appalling';
}

export function toPageInfo(totalItems, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const boundedPage = Math.min(Math.max(1, page), totalPages);
  return {
    currentPage: boundedPage,
    hasNextPage: boundedPage < totalPages,
    totalPages,
  };
}

export function paginate(items, page, pageSize = DEFAULT_PAGE_SIZE) {
  const pageInfo = toPageInfo(items.length, page, pageSize);
  const start = (pageInfo.currentPage - 1) * pageSize;
  return {
    pageInfo,
    data: items.slice(start, start + pageSize),
  };
}

export function isLikelyDirectMediaUrl(url) {
  const lower = toSafeString(url).toLowerCase();
  if (!lower) {
    return false;
  }

  if (/\/stream\/s-\d+\//i.test(lower) || lower.includes('/embed-')) {
    return false;
  }

  return (
    lower.includes('.m3u8') ||
    lower.includes('.mp4') ||
    lower.includes('.mkv') ||
    lower.includes('.webm') ||
    lower.includes('.mpd') ||
    lower.includes('.ts') ||
    lower.includes('/manifest') ||
    lower.includes('/playlist/') ||
    lower.includes('/hls/') ||
    /[?&](playlist|manifest|m3u8)=/.test(lower)
  );
}

export function mediaTypeForUrl(url) {
  const lower = toSafeString(url).toLowerCase();
  if (
    lower.includes('.m3u8') ||
    lower.includes('/manifest') ||
    lower.includes('/playlist/') ||
    lower.includes('/hls/') ||
    /[?&](playlist|manifest|m3u8)=/.test(lower)
  )
    return 'application/x-mpegURL';
  if (lower.includes('.mpd')) return 'application/dash+xml';
  if (lower.includes('.mp4')) return 'video/mp4';
  if (lower.includes('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

export function extractNumericSuffix(value) {
  const match = String(value).match(/(\d+)\s*$/);
  return match ? Number(match[1]) : 0;
}
