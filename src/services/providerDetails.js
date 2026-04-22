import { NotFoundError, validationError } from '../utils/errors.js';
import {
  loadAnimeDetails,
  loadCatalog,
  resolveEpisode,
  toLegacyEpisodeId,
} from './catalog.js';
import {
  extractNumericSuffix,
  isLikelyDirectMediaUrl,
  mediaTypeForUrl,
  parseAired,
  SERVER_NAMES,
  slugify,
  toBasicAnime,
  toExploreAnime,
  toNumber,
  toSafeString,
} from './normalizers.js';
import {
  buildProxyUrl,
  fetchJikan,
  fetchJsonWithFallback,
  fetchTextWithFallback,
  getProviderConfig,
  probeUrl,
} from './upstream.js';

function buildServerItems(urls, type) {
  const list = Array.isArray(urls) ? urls : [];
  return list.slice(0, SERVER_NAMES.length).map((url, index) => {
    const numericId = toNumber(String(url).match(/\/(\d+)(?:\/|$)/)?.[1], index + 1);
    return {
      index: index + 1,
      type,
      id: numericId,
      name: SERVER_NAMES[index],
      _url: String(url),
    };
  });
}

async function pickStreamUrlWithFallback(url, c) {
  const config = getProviderConfig(c);
  const candidates = [
    url,
    buildProxyUrl(config.m3u8ProxyUrl, url, config.hianimesReferer),
    buildProxyUrl(config.daniProxyUrl, url, config.hianimesReferer),
  ].filter(Boolean);

  for (const candidate of candidates) {
    // HEAD succeeds for many direct urls, and 405 usually still means URL is valid for GET.
    const ok = await probeUrl(candidate);
    if (ok) {
      return candidate;
    }
  }

  return candidates[0] || url;
}

function pickSynopsis(anime) {
  return toSafeString(
    anime?.synopsis ||
      anime?.description ||
      anime?.plot_summary ||
      anime?.storyline ||
      anime?.summary ||
      anime?.about ||
      ''
  );
}

async function pickSynopsisWithFallback(anime, c) {
  const fromProvider = pickSynopsis(anime);
  if (fromProvider) {
    return fromProvider;
  }

  const malId = toNumber(anime?.mal_id, 0);
  if (!malId) {
    return '';
  }

  try {
    const payload = await fetchJikan(`/anime/${malId}`, c);
    return toSafeString(payload?.data?.synopsis || payload?.data?.background || '');
  } catch {
    return '';
  }
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEmbeddedStreamUrl(url) {
  try {
    const parsed = new URL(url);
    const sourceMatch = parsed.pathname.match(/\/stream\/s-\d+\/([^/?#]+)(?:\/|$)/i);
    if (!sourceMatch?.[1]) {
      return null;
    }

    return {
      origin: parsed.origin,
      sourceId: sourceMatch[1],
      referer: `${parsed.origin}/`,
    };
  } catch {
    return null;
  }
}

const HIANIME_AJAX_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

function encodeBase64Binary(input) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let index = 0; index < input.length; index += 3) {
    const sextets = [undefined, undefined, undefined, undefined];
    sextets[0] = input.charCodeAt(index) >> 2;
    sextets[1] = (3 & input.charCodeAt(index)) << 4;
    if (input.length > index + 1) {
      sextets[1] |= input.charCodeAt(index + 1) >> 4;
      sextets[2] = (15 & input.charCodeAt(index + 1)) << 2;
    }
    if (input.length > index + 2) {
      sextets[2] |= input.charCodeAt(index + 2) >> 6;
      sextets[3] = 63 & input.charCodeAt(index + 2);
    }
    for (let cursor = 0; cursor < sextets.length; cursor += 1) {
      out += sextets[cursor] === undefined ? '=' : chars[sextets[cursor]];
    }
  }
  return out;
}

function toSafeBase64(value) {
  return encodeBase64Binary(value).replace(/\//g, '_').replace(/\+/g, '-');
}

function rc4Transform(key, input) {
  const box = [];
  for (let index = 0; index < 256; index += 1) {
    box[index] = index;
  }

  let keyIndex = 0;
  for (let index = 0; index < 256; index += 1) {
    keyIndex = (keyIndex + box[index] + key.charCodeAt(index % key.length)) % 256;
    const swap = box[index];
    box[index] = box[keyIndex];
    box[keyIndex] = swap;
  }

  let i = 0;
  let j = 0;
  let output = '';
  for (let cursor = 0; cursor < input.length; cursor += 1) {
    i = (i + 1) % 256;
    j = (j + box[i]) % 256;
    const swap = box[i];
    box[i] = box[j];
    box[j] = swap;
    const xorIndex = (box[i] + box[j]) % 256;
    output += String.fromCharCode(input.charCodeAt(cursor) ^ box[xorIndex]);
  }

  return output;
}

function encodeVrf(value) {
  const input = encodeURIComponent(toSafeString(value));
  const firstPass = toSafeBase64(rc4Transform('ysJhV6U27FVIjjuk', input));
  let shifted = '';
  for (let index = 0; index < firstPass.length; index += 1) {
    let code = firstPass.charCodeAt(index);
    if (index % 8 === 1) code += 3;
    else if (index % 8 === 7) code += 5;
    else if (index % 8 === 2) code -= 4;
    else if (index % 8 === 4) code -= 2;
    else if (index % 8 === 6) code += 4;
    else if (index % 8 === 0) code -= 3;
    else if (index % 8 === 3) code += 2;
    else if (index % 8 === 5) code += 5;
    shifted += String.fromCharCode(code);
  }

  return toSafeBase64(shifted).replace(/[a-zA-Z]/g, (char) => {
    const limit = char <= 'Z' ? 90 : 122;
    const rotated = char.charCodeAt(0) + 13;
    return String.fromCharCode(rotated <= limit ? rotated : rotated - 26);
  });
}

function getHianimeAjaxHeaders(referer) {
  const safeReferer = toSafeString(referer || 'https://hianime.dk/');
  return {
    referer: safeReferer,
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': HIANIME_AJAX_USER_AGENT,
    accept: 'application/json, text/javascript, */*; q=0.01',
    'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
  };
}

function toHianimeSiteOrigin(c) {
  const config = getProviderConfig(c);
  try {
    return new URL(toSafeString(config.hianimesReferer || 'https://hianime.dk/')).origin;
  } catch {
    return 'https://hianime.dk';
  }
}

function extractHtmlAttributeValue(tag, attribute) {
  const safeAttr = String(attribute).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(tag).match(new RegExp(`\\b${safeAttr}\\s*=\\s*(['"])(.*?)\\1`, 'i'));
  return toSafeString(match?.[2]);
}

function parseHianimeAjaxEpisodeItems(html) {
  const body = toSafeString(html);
  if (!body) {
    return [];
  }

  const rows = [];
  const itemRegex = /<a[^>]*class=["'][^"']*\bssl-item\b[^"']*["'][^>]*>/gi;
  let match = itemRegex.exec(body);
  while (match) {
    const tag = match[0];
    const ids = extractHtmlAttributeValue(tag, 'data-ids');
    if (ids) {
      rows.push({
        number: toNumber(extractHtmlAttributeValue(tag, 'data-num'), 0),
        slug: extractHtmlAttributeValue(tag, 'data-slug'),
        mal: extractHtmlAttributeValue(tag, 'data-mal'),
        ids,
        title: extractHtmlAttributeValue(tag, 'title'),
      });
    }
    match = itemRegex.exec(body);
  }

  return rows;
}

function parseServerItemsFromAjaxHtml(html) {
  const body = toSafeString(html);
  if (!body) {
    return [];
  }

  const rows = [];
  const itemRegex = /<a[^>]*class=["'][^"']*\bbtn\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi;
  let match = itemRegex.exec(body);
  while (match) {
    const block = match[0];
    const openTag = block.match(/^<a[^>]*>/i)?.[0] || '';
    const linkId = extractHtmlAttributeValue(openTag, 'data-link-id');
    const type = toSafeString(extractHtmlAttributeValue(openTag, 'data-type')).toLowerCase();
    const attributeName =
      extractHtmlAttributeValue(openTag, 'title') ||
      extractHtmlAttributeValue(openTag, 'data-server') ||
      extractHtmlAttributeValue(openTag, 'data-provider');
    const innerName = stripHtmlTags(block.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '');
    const rawName = toSafeString(attributeName || innerName);
    if (linkId && (type === 'sub' || type === 'dub')) {
      rows.push({
        type,
        name: rawName || type || 'server',
        linkId,
      });
    }
    match = itemRegex.exec(body);
  }

  return rows;
}

function normalizeServerType(rawType) {
  const normalized = toSafeString(rawType).toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized === 'dub' || normalized.includes('dub')) {
    return 'dub';
  }

  if (normalized === 'sub' || normalized.includes('sub')) {
    return 'sub';
  }

  return '';
}

function normalizeServerSlug(name) {
  return toSafeString(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fallbackServerName(type, index) {
  const known = toSafeString(SERVER_NAMES[index]).toLowerCase();
  if (known) {
    return known;
  }
  return `${type}-${index + 1}`;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(toSafeString(value));
}

function buildServerInternalRows(list, forcedType = '') {
  const rows = [];
  const seen = new Map();

  list.forEach((entry, index) => {
    const type = toSafeString(forcedType || entry?.type).toLowerCase() === 'dub' ? 'dub' : 'sub';
    const initialSlug = normalizeServerSlug(entry?.name);
    const genericSlug =
      !initialSlug ||
      initialSlug === type ||
      initialSlug === 'server' ||
      initialSlug === `${type}-server`;
    const baseName = genericSlug ? fallbackServerName(type, index) : initialSlug;
    const seenCount = seen.get(baseName) || 0;
    seen.set(baseName, seenCount + 1);
    const uniqueName = seenCount > 0 ? `${baseName}-${seenCount + 1}` : baseName;

    rows.push({
      index: index + 1,
      type,
      id: index + 1,
      name: uniqueName,
      _url: toSafeString(entry?.linkId || ''),
      _isAjaxToken: !isHttpUrl(entry?.linkId),
    });
  });

  return rows;
}

async function fetchJsonWithHeaders(url, headers) {
  const response = await fetch(url, { headers });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || typeof payload !== 'object') {
    throw new NotFoundError('hianime ajax request failed');
  }
  return payload;
}

async function loadHianimeAjaxEpisodes(anime, c) {
  const animeId = Math.max(toNumber(anime?.manga_id, 0), toNumber(anime?.id, 0));
  if (!animeId) {
    return [];
  }

  const origin = toHianimeSiteOrigin(c);
  const vrf = encodeVrf(String(animeId));
  const url = `${origin}/ajax/episode/list/${animeId}?vrf=${encodeURIComponent(vrf)}`;
  const payload = await fetchJsonWithHeaders(url, getHianimeAjaxHeaders(`${origin}/`));
  if (toNumber(payload?.status, 0) !== 200) {
    throw new NotFoundError('hianime ajax episodes unavailable');
  }

  return parseHianimeAjaxEpisodeItems(payload?.result);
}

async function loadHianimeAjaxServersForEpisode(anime, episode, c) {
  const origin = toHianimeSiteOrigin(c);
  const headers = getHianimeAjaxHeaders(`${origin}/`);
  const episodeNumber = Math.max(1, toNumber(episode?.episodeNumber, 1));
  const rows = await loadHianimeAjaxEpisodes(anime, c);
  const activeEpisode = rows.find((row) => toNumber(row?.number, -1) === episodeNumber) || rows[0];
  if (!activeEpisode?.ids) {
    return { sub: [], dub: [] };
  }

  let mergedRows = [];
  try {
    const listUrl = `${origin}/ajax/server/list?servers=${encodeURIComponent(activeEpisode.ids)}`;
    const listPayload = await fetchJsonWithHeaders(listUrl, headers);
    if (toNumber(listPayload?.status, 0) === 200) {
      mergedRows = parseServerItemsFromAjaxHtml(listPayload?.result);
    }
  } catch {
    // fall through to MAL fallback
  }

  if (mergedRows.length < 1 && activeEpisode.mal && activeEpisode.slug) {
    const ts = Math.floor(Date.now() / 1000);
    const malUrl = `${origin}/ajax/mal?mal=${encodeURIComponent(activeEpisode.mal)}&ep=${encodeURIComponent(
      activeEpisode.slug
    )}&ts=${ts}`;
    const malPayload = await fetchJsonWithHeaders(malUrl, headers);
    mergedRows = Object.entries(malPayload || {})
      .filter(([key]) => key !== 'status')
      .flatMap(([key, value]) => {
        if (!value || typeof value !== 'object') {
          return [];
        }
        const subUrl = toSafeString(value?.sub?.url);
        const dubUrl = toSafeString(value?.dub?.url);
        const name = toSafeString(key).toLowerCase();
        return [
          ...(subUrl ? [{ type: 'sub', name, linkId: subUrl }] : []),
          ...(dubUrl ? [{ type: 'dub', name, linkId: dubUrl }] : []),
        ];
      });
  }

  const sub = buildServerInternalRows(
    mergedRows.filter((entry) => entry.type === 'sub')
  );
  const dub = buildServerInternalRows(
    mergedRows.filter((entry) => entry.type === 'dub')
  );
  return { sub, dub };
}

async function resolveHianimeAjaxStreamByToken(linkToken, normalizedType, id, serverName, c) {
  const token = toSafeString(linkToken);
  if (!token) {
    throw new NotFoundError('stream source not found');
  }

  if (isHttpUrl(token)) {
    if (isLikelyDirectMediaUrl(token)) {
      const selectedUrl = await pickStreamUrlWithFallback(token, c);
      return [
        {
          id,
          type: normalizedType,
          link: {
            file: selectedUrl,
            type: mediaTypeForUrl(selectedUrl),
          },
          tracks: [],
          intro: { start: 0, end: 0 },
          outro: { start: 0, end: 0 },
          server: serverName,
          referer: `${new URL(token).origin}/`,
        },
      ];
    }

    const embedded = await resolveEmbeddedStreamData(token, serverName, normalizedType, id, c);
    if (embedded) {
      return embedded;
    }
  }

  const origin = toHianimeSiteOrigin(c);
  const headers = getHianimeAjaxHeaders(`${origin}/`);
  const url = `${origin}/ajax/server?get=${encodeURIComponent(token)}`;
  const payload = await fetchJsonWithHeaders(url, headers);
  if (toNumber(payload?.status, 0) !== 200) {
    throw new NotFoundError('stream source not found');
  }

  const resolvedUrl = toSafeString(payload?.result?.url);
  if (!resolvedUrl) {
    throw new NotFoundError('stream source not found');
  }

  if (isLikelyDirectMediaUrl(resolvedUrl)) {
    const selectedUrl = await pickStreamUrlWithFallback(resolvedUrl, c);
    return [
      {
        id,
        type: normalizedType,
        link: {
          file: selectedUrl,
          type: mediaTypeForUrl(selectedUrl),
        },
        tracks: [],
        intro: normalizeStreamWindow(payload?.result?.skip_data?.intro),
        outro: normalizeStreamWindow(payload?.result?.skip_data?.outro),
        server: serverName,
        referer: `${origin}/`,
      },
    ];
  }

  const embedded = await resolveEmbeddedStreamData(resolvedUrl, serverName, normalizedType, id, c);
  if (embedded) {
    return embedded;
  }

  throw new validationError('unable to resolve stream to direct media source', {
    id,
    server: serverName,
    type: normalizedType,
  });
}

function extractHtmlAttribute(tag, attribute) {
  const safeAttribute = String(attribute).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${safeAttribute}\\s*=\\s*(['"])(.*?)\\1`, 'i');
  return toSafeString(tag.match(regex)?.[2]);
}

function stripHtmlTags(value) {
  return toSafeString(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseServerItemsFromHtml(html) {
  const body = toSafeString(html);
  if (!body) {
    return [];
  }

  const items = [];
  const itemPattern = /<div[^>]*class=['"][^'"]*\bserver-item\b[^'"]*['"][^>]*>[\s\S]*?<\/div>/gi;
  let match = itemPattern.exec(body);
  while (match) {
    const block = match[0];
    const openTag = block.match(/^<div[^>]*>/i)?.[0] || '';
    const id = extractHtmlAttribute(openTag, 'data-id');
    const type = normalizeServerType(extractHtmlAttribute(openTag, 'data-type'));
    const serverNameRaw = block.match(/<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '';
    const name = stripHtmlTags(serverNameRaw).toLowerCase();
    if (id && type) {
      items.push({ id, type, name });
    }
    match = itemPattern.exec(body);
  }

  return items;
}

function sortServerItemsByPreference(serverItems, normalizedType) {
  const entries = Array.isArray(serverItems)
    ? serverItems.filter((item) => item?.type === normalizedType)
    : [];
  if (entries.length < 1) {
    return [];
  }

  const preferredOrder = ['vidcloud', 'vidstreaming', 'douvideo'];
  const getRank = (name) => {
    const index = preferredOrder.indexOf(name);
    return index < 0 ? preferredOrder.length + 1 : index;
  };

  return [...entries].sort((a, b) => getRank(a.name) - getRank(b.name));
}

function parseRapidCloudSourceRequestUrl(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const eSegmentIndex = segments.findIndex((segment) => /^e-\d+$/i.test(segment));
    if (eSegmentIndex < 0 || eSegmentIndex + 1 >= segments.length) {
      return null;
    }

    const sourceId = toSafeString(segments[eSegmentIndex + 1]);
    if (!sourceId) {
      return null;
    }

    const basePath = segments.slice(0, eSegmentIndex + 1).join('/');
    const getSourcesUrl = `${parsed.origin}/${basePath}/getSources?id=${encodeURIComponent(sourceId)}`;
    return {
      getSourcesUrl,
      referer: parsed.toString(),
      origin: `${parsed.origin}/`,
    };
  } catch {
    return null;
  }
}

function extractStreamFileFromSources(sources) {
  if (Array.isArray(sources)) {
    const first = sources.find((item) => item && typeof item.file === 'string');
    return first?.file || '';
  }

  if (sources && typeof sources === 'object' && typeof sources.file === 'string') {
    return sources.file;
  }

  if (typeof sources === 'string' && /^https?:\/\//i.test(sources)) {
    return sources;
  }

  return '';
}

function normalizeTracks(rawTracks) {
  if (!Array.isArray(rawTracks)) {
    return [];
  }

  return rawTracks
    .map((track) => {
      if (!track || typeof track !== 'object') {
        return null;
      }

      const file = toSafeString(track.file);
      if (!file) {
        return null;
      }

      return {
        file,
        label: toSafeString(track.label) || 'Subtitle',
        kind: toSafeString(track.kind) || 'captions',
        default: Boolean(track.default),
      };
    })
    .filter(Boolean);
}

function normalizeStreamWindow(rawWindow) {
  return {
    start: toFiniteNumber(rawWindow?.start, 0),
    end: toFiniteNumber(rawWindow?.end, 0),
  };
}

async function resolveEmbeddedStreamDataFromNineAjax(selectedUrl, selectedName, normalizedType, id, c) {
  const embedded = parseEmbeddedStreamUrl(selectedUrl);
  if (!embedded) {
    return null;
  }

  const config = getProviderConfig(c);
  const baseCandidates = Array.from(
    new Set(
      [toSafeString(config.hianimesAjaxBaseUrl), 'https://nine.mewcdn.online']
        .map((value) => value.replace(/\/+$/, ''))
        .filter(Boolean)
    )
  );

  for (const base of baseCandidates) {
    try {
      const serversUrl = `${base}/ajax/episode/servers?episodeId=${encodeURIComponent(
        embedded.sourceId
      )}&type=${encodeURIComponent(normalizedType)}`;
      const serversPayload = await fetchJsonWithFallback(serversUrl, c, embedded.referer);
      const serverItems = parseServerItemsFromHtml(serversPayload?.html);
      const preferredServers = sortServerItemsByPreference(serverItems, normalizedType);
      if (preferredServers.length < 1) {
        continue;
      }

      for (const preferredServer of preferredServers) {
        const sourcesUrl = `${base}/ajax/episode/sources?id=${encodeURIComponent(
          preferredServer.id
        )}&type=${encodeURIComponent(normalizedType)}`;
        const sourcesPayload = await fetchJsonWithFallback(sourcesUrl, c, embedded.referer);
        const rapidRequest = parseRapidCloudSourceRequestUrl(toSafeString(sourcesPayload?.link));
        if (!rapidRequest) {
          continue;
        }

        const rapidPayload = await fetchJsonWithFallback(rapidRequest.getSourcesUrl, c, rapidRequest.referer);
        const sourceFile = extractStreamFileFromSources(rapidPayload?.sources);
        if (!sourceFile) {
          continue;
        }

        const isDirectlyReachable = await probeUrl(sourceFile);
        if (!isDirectlyReachable && preferredServers.length > 1) {
          continue;
        }

        return [
          {
            id,
            type: normalizedType,
            link: {
              file: sourceFile,
              type: mediaTypeForUrl(sourceFile),
            },
            tracks: normalizeTracks(rapidPayload?.tracks),
            intro: normalizeStreamWindow(rapidPayload?.intro),
            outro: normalizeStreamWindow(rapidPayload?.outro),
            server: selectedName,
            referer: rapidRequest.origin,
          },
        ];
      }
    } catch {
      // Try next candidate base URL.
    }
  }

  return null;
}

async function resolveEmbeddedStreamDataFromLegacyGetSources(selectedUrl, selectedName, normalizedType, id, c) {
  const embedded = parseEmbeddedStreamUrl(selectedUrl);
  if (!embedded) {
    return null;
  }

  const getSourcesUrl = `${embedded.origin}/stream/getSources?id=${encodeURIComponent(embedded.sourceId)}`;

  try {
    const payload = await fetchJsonWithFallback(getSourcesUrl, c, embedded.referer);
    const sourceFile = extractStreamFileFromSources(payload?.sources);
    if (!sourceFile) {
      return null;
    }

    return [
      {
        id,
        type: normalizedType,
        link: {
          file: sourceFile,
          type: mediaTypeForUrl(sourceFile),
        },
        tracks: normalizeTracks(payload?.tracks),
        intro: normalizeStreamWindow(payload?.intro),
        outro: normalizeStreamWindow(payload?.outro),
        server: selectedName,
        referer: embedded.referer,
      },
    ];
  } catch {
    return null;
  }
}

function parseProviderStreamPath(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/stream\/s-\d+\/([^/?#]+)\/(sub|dub)(?:\/|$)/i);
    if (!match?.[1]) {
      return null;
    }

    return {
      sourceId: toSafeString(match[1]),
      type: toSafeString(match[2]).toLowerCase() === 'dub' ? 'dub' : 'sub',
    };
  } catch {
    return null;
  }
}

function extractProviderDataIdFromHtml(html) {
  return toSafeString(String(html).match(/data-id\s*=\s*['"](\d+)['"]/i)?.[1]);
}

async function resolveEmbeddedStreamDataFromProviderFallback(selectedUrl, selectedName, normalizedType, id, c) {
  const parsed = parseProviderStreamPath(selectedUrl);
  if (!parsed?.sourceId) {
    return null;
  }

  const streamType = parsed.type || normalizedType;
  const providerCandidates = [
    { origin: 'https://megaplay.buzz', referer: 'https://megaplay.buzz/' },
    { origin: 'https://vidwish.live', referer: 'https://vidwish.live/' },
  ];

  for (const provider of providerCandidates) {
    try {
      const streamPageUrl = `${provider.origin}/stream/s-2/${encodeURIComponent(
        parsed.sourceId
      )}/${encodeURIComponent(streamType)}`;
      const streamPageHtml = await fetchTextWithFallback(streamPageUrl, c, provider.referer);
      const dataId = extractProviderDataIdFromHtml(streamPageHtml);
      if (!dataId) {
        continue;
      }

      const sourcesUrl = `${provider.origin}/stream/getSources?id=${encodeURIComponent(dataId)}`;
      const sourcePayload = await fetchJsonWithFallback(sourcesUrl, c, provider.referer);
      const sourceFile = extractStreamFileFromSources(sourcePayload?.sources);
      if (!sourceFile) {
        continue;
      }

      const selectedFile = await pickStreamUrlWithFallback(sourceFile, c);
      return [
        {
          id,
          type: normalizedType,
          link: {
            file: selectedFile,
            type: mediaTypeForUrl(selectedFile),
          },
          tracks: normalizeTracks(sourcePayload?.tracks),
          intro: normalizeStreamWindow(sourcePayload?.intro),
          outro: normalizeStreamWindow(sourcePayload?.outro),
          server: selectedName,
          referer: provider.referer,
        },
      ];
    } catch {
      // Try the next provider mirror.
    }
  }

  return null;
}

async function resolveEmbeddedStreamData(selectedUrl, selectedName, normalizedType, id, c) {
  const resolvedFromProviderFallback = await resolveEmbeddedStreamDataFromProviderFallback(
    selectedUrl,
    selectedName,
    normalizedType,
    id,
    c
  );
  if (resolvedFromProviderFallback) {
    return resolvedFromProviderFallback;
  }

  const resolvedFromNineAjax = await resolveEmbeddedStreamDataFromNineAjax(
    selectedUrl,
    selectedName,
    normalizedType,
    id,
    c
  );
  if (resolvedFromNineAjax) {
    return resolvedFromNineAjax;
  }

  return resolveEmbeddedStreamDataFromLegacyGetSources(selectedUrl, selectedName, normalizedType, id, c);
}

export async function getAnimeInfoData(id, c) {
  const { anime, episodes } = await loadAnimeDetails(id, c);
  const catalog = await loadCatalog(c);
  const popular = [...catalog].sort((a, b) => a.__popularity - b.__popularity).slice(0, 12);
  const recommended = [...catalog]
    .filter((entry) => entry.__id !== anime.__id)
    .sort((a, b) => b.__score - a.__score)
    .slice(0, 12);

  const aired = parseAired(anime?.Aired);
  const synopsis = await pickSynopsisWithFallback(anime, c);
  const studiosSource = toSafeString(anime?.Licensors || anime?.studios);
  const producersSource = toSafeString(anime?.Producers || anime?.producers);
  return {
    ...toBasicAnime(anime),
    rating: toSafeString(anime?.Rating || anime?.rating || ''),
    type: toSafeString(anime?.Type || anime?.type || 'TV'),
    is18Plus: toSafeString(anime?.Rating || anime?.rating).toLowerCase().startsWith('r'),
    synopsis,
    synonyms: toSafeString(anime?.alternateTitle || ''),
    aired,
    premiered: toSafeString(anime?.Premiered || anime?.premiered || ''),
    duration: toSafeString(anime?.Duration || anime?.duration || ''),
    status: toSafeString(anime?.Status || anime?.status || ''),
    MAL_score: toSafeString(anime?.Score || anime?.score || ''),
    genres: Array.isArray(anime?.genres)
      ? anime.genres
      : toSafeString(anime?.genre)
          .split(',')
          .map((value) => toSafeString(value))
          .filter(Boolean),
    studios: studiosSource
      .split(',')
      .map((value) => toSafeString(value))
      .filter(Boolean),
    producers: producersSource
      .split(',')
      .map((value) => slugify(value))
      .filter(Boolean),
    related: [],
    mostPopular: popular.map((entry) => toBasicAnime(entry)),
    recommended: recommended.map((entry) => ({
      ...toExploreAnime(entry),
      is18Plus: toSafeString(entry?.Rating).toLowerCase().startsWith('r'),
    })),
    _episodesRaw: episodes,
  };
}

export async function getRandomAnimeInfoData(c) {
  const catalog = await loadCatalog(c);
  if (catalog.length < 1) {
    throw new NotFoundError('no anime found');
  }
  const randomEntry = catalog[Math.floor(Math.random() * catalog.length)];
  return getAnimeInfoData(randomEntry.__id, c);
}

export async function getEpisodesData(id, c) {
  const { anime, episodes } = await loadAnimeDetails(id, c);
  return episodes.map((episode, index) => ({
    title: toSafeString(episode?.title || `Episode ${episode?.episodeNumber || index + 1}`),
    alternativeTitle: toSafeString(episode?.title || `Episode ${episode?.episodeNumber || index + 1}`),
    id: toLegacyEpisodeId(anime.__id, episode),
    isFiller: false,
    episodeNumber: toNumber(episode?.episodeNumber, index + 1),
  }));
}

export async function getServersData(episodeId, c) {
  const { anime, episode } = await resolveEpisode(episodeId, c);
  let sub = buildServerItems(episode?.link?.sub, 'sub');
  let dub = buildServerItems(episode?.link?.dub, 'dub');

  if (sub.length < 1 && dub.length < 1) {
    try {
      const ajaxServers = await loadHianimeAjaxServersForEpisode(anime, episode, c);
      sub = ajaxServers.sub;
      dub = ajaxServers.dub;
    } catch {
      // leave default empty server sets
    }
  }

  if (sub.length < 1 && dub.length < 1) {
    const derivedToken = extractNumericSuffix(
      toSafeString(episode?._id || episode?.id || episode?.chapter_id || episode?.chapterId)
    );
    if (derivedToken > 0) {
      sub = [
        {
          index: 1,
          type: 'sub',
          id: 1,
          name: 'hd-1',
          _url: String(derivedToken),
          _isAjaxToken: true,
        },
      ];
    }
  }

  if (sub.length < 1 && dub.length > 0) {
    sub = dub.map((server, index) => ({
      ...server,
      index: index + 1,
      type: 'sub',
      id: index + 1,
      name: `${server.name}-sub-fallback`,
    }));
  }

  return {
    episode: toNumber(episode?.episodeNumber, 0),
    sub: sub.map((server) => ({
      index: server.index,
      type: server.type,
      id: server.id,
      name: server.name,
    })),
    dub: dub.map((server) => ({
      index: server.index,
      type: server.type,
      id: server.id,
      name: server.name,
    })),
    _subRaw: sub,
    _dubRaw: dub,
  };
}

export async function getStreamData(id, serverName, type, c) {
  const servers = await getServersData(id, c);
  const normalizedServerName = toSafeString(serverName || 'hd-1').toLowerCase();
  const normalizedType = toSafeString(type || 'sub').toLowerCase() === 'dub' ? 'dub' : 'sub';

  const sourceList = normalizedType === 'dub' ? servers._dubRaw : servers._subRaw;
  const selected = sourceList.find((entry) => entry.name === normalizedServerName) || sourceList[0];
  if (!selected) {
    throw new NotFoundError('stream source not found');
  }

  const selectedUrlRaw = toSafeString(selected._url);
  if (!selectedUrlRaw) {
    throw new validationError('invalid stream source url');
  }

  if (selected?._isAjaxToken) {
    return resolveHianimeAjaxStreamByToken(selectedUrlRaw, normalizedType, id, selected.name, c);
  }

  if (isLikelyDirectMediaUrl(selectedUrlRaw)) {
    const selectedUrl = await pickStreamUrlWithFallback(selectedUrlRaw, c);
    return [
      {
        id,
        type: normalizedType,
        link: {
          file: selectedUrl,
          type: mediaTypeForUrl(selectedUrl),
        },
        tracks: [],
        intro: { start: 0, end: 0 },
        outro: { start: 0, end: 0 },
        server: selected.name,
        referer: getProviderConfig(c).hianimesReferer,
      },
    ];
  }

  const resolvedStream = await resolveEmbeddedStreamData(
    selectedUrlRaw,
    selected.name,
    normalizedType,
    id,
    c
  );
  if (resolvedStream) {
    return resolvedStream;
  }

  throw new validationError('unable to resolve stream to direct media source', {
    id,
    server: selected.name,
    type: normalizedType,
  });
}

export async function getCharactersData(id, page, c) {
  const { anime } = await loadAnimeDetails(id, c);
  const malId = toNumber(anime?.mal_id, 0);
  if (!malId) {
    return {
      pageInfo: {
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
      },
      response: [],
    };
  }

  const payload = await fetchJikan(`/anime/${malId}/characters`, c, { page });
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const pagination = payload?.pagination || {};

  return {
    pageInfo: {
      currentPage: toNumber(pagination?.current_page, page),
      totalPages: Math.max(1, toNumber(pagination?.last_visible_page, 1)),
      hasNextPage: Boolean(pagination?.has_next_page),
    },
    response: data.map((entry) => {
      const character = entry?.character || {};
      const voiceActors = Array.isArray(entry?.voice_actors) ? entry.voice_actors : [];
      const charNameSlug = slugify(character?.name || 'character');
      return {
        name: toSafeString(character?.name),
        id: `character:${charNameSlug}-${toNumber(character?.mal_id, 0)}`,
        imageUrl:
          toSafeString(character?.images?.jpg?.image_url) ||
          toSafeString(character?.images?.webp?.image_url),
        role: toSafeString(entry?.role || ''),
        voiceActors: voiceActors.map((actor) => {
          const person = actor?.person || {};
          const personNameSlug = slugify(person?.name || 'person');
          return {
            name: toSafeString(person?.name),
            id: `people:${personNameSlug}-${toNumber(person?.mal_id, 0)}`,
            imageUrl:
              toSafeString(person?.images?.jpg?.image_url) ||
              toSafeString(person?.images?.webp?.image_url),
            cast: toSafeString(actor?.language) || null,
          };
        }),
      };
    }),
  };
}

export async function getCharacterData(id, c) {
  const charId = extractNumericSuffix(id);
  if (!charId) {
    throw new validationError('invalid character id');
  }
  const payload = await fetchJikan(`/characters/${charId}/full`, c);
  const character = payload?.data || {};
  const animeAppearances = Array.isArray(character?.anime) ? character.anime : [];

  return {
    name: toSafeString(character?.name),
    type: 'Character',
    japanese: toSafeString(character?.name_kanji),
    imageUrl:
      toSafeString(character?.images?.jpg?.image_url) || toSafeString(character?.images?.webp?.image_url),
    bio: toSafeString(character?.about),
    animeApearances: animeAppearances.map((entry) => {
      const anime = entry?.anime || {};
      const role = toSafeString(entry?.role);
      const animeId = `${slugify(anime?.title || 'anime')}-${toNumber(anime?.mal_id, 0)}`;
      return {
        title: toSafeString(anime?.title),
        alternativeTitle: toSafeString(anime?.title),
        id: animeId,
        poster: toSafeString(anime?.images?.jpg?.image_url),
        role,
        type: role || 'Unknown',
      };
    }),
  };
}

export async function getActorData(id, c) {
  const actorId = extractNumericSuffix(id);
  if (!actorId) {
    throw new validationError('invalid actor id');
  }
  const payload = await fetchJikan(`/people/${actorId}/full`, c);
  const person = payload?.data || {};
  const voices = Array.isArray(person?.voices) ? person.voices : [];

  return {
    name: toSafeString(person?.name),
    type: 'Person',
    japanese: toSafeString(person?.name_kanji),
    imageUrl: toSafeString(person?.images?.jpg?.image_url),
    bio: toSafeString(person?.about),
    voiceActingRoles: voices.map((entry) => {
      const anime = entry?.anime || {};
      const title = toSafeString(anime?.title);
      return {
        title,
        poster: toSafeString(anime?.images?.jpg?.image_url),
        id: `${slugify(title || 'anime')}-${toNumber(anime?.mal_id, 0)}`,
        typeAndYear: toSafeString(entry?.character?.name) || 'Voice Role',
      };
    }),
  };
}

export async function getNextScheduleData(id, c) {
  const { anime, episodes } = await loadAnimeDetails(id, c);
  const catalog = await loadCatalog(c);
  const match = catalog.find((entry) => entry.__id === anime.__id) || anime;
  const totalEpisodes = Math.max(toNumber(match?.totalEpisodes, 0), episodes.length);
  if (totalEpisodes <= episodes.length && totalEpisodes > 0) {
    return { time: null };
  }
  return { time: toSafeString(anime?.Aired || '') || null };
}

export function isValidExploreQuery(query) {
  const known = new Set([
    'top-airing',
    'most-popular',
    'most-favorite',
    'completed',
    'recently-added',
    'recently-updated',
    'top-upcoming',
    'subbed-anime',
    'dubbed-anime',
    'movie',
    'tv',
    'ova',
    'ona',
    'special',
  ]);
  return known.has(toSafeString(query).toLowerCase());
}
