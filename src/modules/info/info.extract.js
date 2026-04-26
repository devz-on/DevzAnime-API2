import { commonAnimeObj, episodeObj } from '../../utils/commonAnimeObj.js';
import { load } from 'cheerio';

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function animeIdFromHref(href) {
  const value = String(href || '').trim();
  if (!value) {
    return null;
  }

  const cleanValue = value.split('?').at(0).split('#').at(0);
  const segments = cleanValue.split('/').filter(Boolean);
  const watchIndex = segments.findIndex((segment) => segment.toLowerCase() === 'watch');
  if (watchIndex > -1 && segments.length > watchIndex + 1) {
    return segments[watchIndex + 1] || null;
  }

  const withoutEpisodeTail = segments.filter((segment) => !/^ep-\d+$/i.test(segment));
  return withoutEpisodeTail.at(-1) || segments.at(-1) || null;
}

function toCount(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function applyAiredRange(value, target) {
  const airedRaw = normalizeText(value);
  if (!airedRaw) {
    return;
  }

  const parts = airedRaw.split(/\s+to\s+/i);
  target.from = parts[0] || target.from;
  if (parts.length > 1) {
    const second = normalizeText(parts[1]);
    target.to = second === '?' ? null : second;
  } else {
    target.to = null;
  }
}

export default function infoExtract(html) {
  const $ = load(html);

  const obj = {
    ...commonAnimeObj(),
    ...episodeObj(),
    rating: null,
    type: null,
    is18Plus: null,
    synopsis: null,
    synonyms: null,
    aired: {
      from: null,
      to: null,
    },
    premiered: null,
    duration: null,
    status: null,
    MAL_score: null,
    genres: [],
    studios: [],
    producers: [],
    moreSeasons: [],
    related: [],
    mostPopular: [],
    recommended: [],
  };

  // all information elements
  const main = $('#ani_detail .anis-content');
  const moreSeasons = $('#main-content .block_area-seasons');
  const relatedAndMostPopular = $('.block_area.block_area_sidebar.block_area-realtime');
  const recommended = $(
    '.block_area.block_area_category .tab-content .block_area-content .film_list-wrap .flw-item'
  );

  // extract base info
  obj.poster =
    main.find('.film-poster .film-poster-img').attr('src') ||
    main.find('.film-poster .film-poster-img').attr('data-src') ||
    null;
  obj.is18Plus = Boolean(
    main.find('.film-poster .tick-rate').length > 0 ||
    /uncensored/i.test(normalizeText(main.text()))
  );

  const titleEl = main.find('.anisc-detail .film-name a, .anisc-detail .film-name').first();
  obj.title = normalizeText(titleEl.text()) || null;
  obj.alternativeTitle =
    normalizeText(titleEl.attr('data-jname') || titleEl.attr('data-jp')) || obj.title;

  obj.id =
    animeIdFromHref(titleEl.attr('href')) ||
    animeIdFromHref(main.find('.film-buttons .btn').first().attr('href')) ||
    null;

  const stats = main.find('.film-stats').first();
  obj.rating = normalizeText(stats.find('.tick-pg').text()) || null;
  obj.episodes.sub = toCount(stats.find('.tick-sub').text());
  obj.episodes.dub = toCount(stats.find('.tick-dub').text());
  obj.episodes.eps = Math.max(
    obj.episodes.sub,
    obj.episodes.dub,
    toCount(stats.find('.tick-eps').text())
  );

  const statTexts = stats
    .find('.item')
    .map((_, el) => normalizeText($(el).text()))
    .get()
    .filter(Boolean);
  if (!obj.type) {
    obj.type =
      statTexts.find((value) =>
        ['tv', 'ona', 'ova', 'movie', 'special'].includes(value.toLowerCase())
      ) || null;
  }
  if (!obj.duration) {
    obj.duration =
      statTexts.find((value) => /\d+\s*m/i.test(value) || /\d+\s*min/i.test(value)) || null;
  }

  obj.synopsis =
    normalizeText(main.find('.film-description .text.content').text()) ||
    normalizeText(main.find('.film-description .text').text()) ||
    null;

  // New hianime layout metadata.
  main.find('.film-meta .meta > div').each((_, el) => {
    const row = normalizeText($(el).text());
    if (!row.includes(':')) {
      return;
    }

    const [rawLabel, ...rest] = row.split(':');
    const label = normalizeText(rawLabel).toLowerCase();
    const value = normalizeText(rest.join(':'));

    switch (label) {
      case 'type':
        obj.type = value || obj.type;
        break;
      case 'date aired':
      case 'aired':
        applyAiredRange(value, obj.aired);
        break;
      case 'status':
        obj.status = value || obj.status;
        break;
      case 'genres':
        obj.genres = $(el)
          .find('a')
          .map((__, genre) => normalizeText($(genre).text()))
          .get()
          .filter(Boolean);
        break;
      case 'scores':
      case 'mal score':
        obj.MAL_score = value && value !== '?' ? value : null;
        break;
      case 'premiered':
        obj.premiered = value || obj.premiered;
        break;
      case 'duration':
        obj.duration = value || obj.duration;
        break;
      case 'episodes': {
        const totalEpisodes = toCount(value);
        if (totalEpisodes > 0) {
          obj.episodes.eps = Math.max(obj.episodes.eps || 0, totalEpisodes);
          obj.episodes.sub = Math.max(obj.episodes.sub || 0, totalEpisodes);
        }
        break;
      }
      case 'studios':
        obj.studios = $(el)
          .find('a')
          .map((__, studio) => animeIdFromHref($(studio).attr('href')))
          .get()
          .filter(Boolean);
        break;
      case 'producers':
        obj.producers = $(el)
          .find('a')
          .map((__, producer) => animeIdFromHref($(producer).attr('href')))
          .get()
          .filter(Boolean);
        break;
      case 'synonyms':
        obj.synonyms = value || null;
        break;
      default:
        break;
    }
  });

  // Legacy imbalance info fallback.
  const moreInfo = main.find('.anisc-info-wrap .anisc-info .item');
  moreInfo.each((_, el) => {
    const name = normalizeText($(el).find('.item-head').text()).toLowerCase();
    const textValue = normalizeText($(el).find('.name').text());

    switch (name) {
      case 'overview:':
        obj.synopsis = normalizeText($(el).find('.text').text()) || obj.synopsis;
        break;
      case 'japanese:':
        obj.japanese = textValue || obj.japanese;
        break;
      case 'synonyms:':
        obj.synonyms = textValue || obj.synonyms;
        break;
      case 'aired:':
        applyAiredRange(textValue, obj.aired);
        break;
      case 'premiered:':
        obj.premiered = textValue || obj.premiered;
        break;
      case 'duration:':
        obj.duration = textValue || obj.duration;
        break;
      case 'status:':
        obj.status = textValue || obj.status;
        break;
      case 'mal score:':
        obj.MAL_score = textValue || obj.MAL_score;
        break;
      case 'genres:':
        if (obj.genres.length < 1) {
          obj.genres = $(el)
            .find('a')
            .map((__, genre) => normalizeText($(genre).text()))
            .get()
            .filter(Boolean);
        }
        break;
      case 'studios:':
        if (obj.studios.length < 1) {
          obj.studios = $(el)
            .find('a')
            .map((__, studio) => animeIdFromHref($(studio).attr('href')))
            .get()
            .filter(Boolean);
        }
        break;
      case 'producers:':
        if (obj.producers.length < 1) {
          obj.producers = $(el)
            .find('a')
            .map((__, producer) => animeIdFromHref($(producer).attr('href')))
            .get()
            .filter(Boolean);
        }
        break;
      default:
        break;
    }
  });

  // extract more seasons
  if (moreSeasons.length) {
    $(moreSeasons)
      .find('.os-list .os-item')
      .each((_, el) => {
        const innerObj = {
          title: null,
          alternativeTitle: null,
          id: null,
          poster: null,
          isActive: false,
        };

        innerObj.title =
          normalizeText($(el).attr('title')) || normalizeText($(el).find('.title').text()) || null;
        innerObj.alternativeTitle = normalizeText($(el).find('.title').text()) || innerObj.title;
        innerObj.id = animeIdFromHref($(el).attr('href'));

        const posterStyle = String($(el).find('.season-poster').attr('style') || '');
        const match = posterStyle.match(/url\((['"])?(.*?)\1\)/);
        innerObj.poster =
          (match ? match[2] : null) ||
          $(el).find('.season-poster img').attr('data-src') ||
          $(el).find('.season-poster img').attr('src') ||
          null;

        innerObj.isActive = $(el).hasClass('active');
        obj.moreSeasons.push(innerObj);
      });
  }

  // extract related and most popular
  const extractSidebarRows = (index, output) => {
    const block = relatedAndMostPopular.eq(index);
    if (!block.length) {
      return;
    }

    block.find('li').each((_, el) => {
      const titleAnchor = $(el)
        .find('.film-name a.d-title, .film-name a, .film-name .dynamic-name')
        .first();
      const title = normalizeText(titleAnchor.text()) || null;
      const id = animeIdFromHref(titleAnchor.attr('href'));
      if (!title && !id) {
        return;
      }

      const infor = $(el).find('.fd-infor');
      const episodes = {
        sub: toCount(infor.find('.tick-sub').text()),
        dub: toCount(infor.find('.tick-dub').text()),
        eps: toCount(infor.find('.tick-eps').text()),
      };

      const fdiItems = infor
        .find('.fdi-item')
        .map((__, item) => normalizeText($(item).text()))
        .get()
        .filter(Boolean);
      const epsFromInfo = fdiItems.find((item) => /eps/i.test(item));
      if (episodes.eps < 1 && epsFromInfo) {
        episodes.eps = toCount(epsFromInfo);
      }

      output.push({
        title,
        alternativeTitle:
          normalizeText(titleAnchor.attr('data-jname') || titleAnchor.attr('data-jp')) || title,
        id,
        poster:
          $(el).find('.film-poster .film-poster-img').attr('data-src') ||
          $(el).find('.film-poster .film-poster-img').attr('src') ||
          null,
        type: fdiItems.find((item) => !/eps|m$/i.test(item)) || null,
        episodes,
      });
    });
  };

  if (relatedAndMostPopular.length > 1) {
    extractSidebarRows(0, obj.related);
    extractSidebarRows(1, obj.mostPopular);
  } else {
    extractSidebarRows(0, obj.mostPopular);
  }

  recommended.each((_, el) => {
    const titleAnchor = $(el)
      .find(
        '.film-detail .film-name a.d-title, .film-detail .film-name a, .film-detail .film-name .dynamic-name'
      )
      .first();
    const title = normalizeText(titleAnchor.text()) || null;
    const id = animeIdFromHref(titleAnchor.attr('href'));
    if (!title && !id) {
      return;
    }

    const episodes = {
      sub: toCount($(el).find('.film-poster .tick .tick-sub').text()),
      dub: toCount($(el).find('.film-poster .tick .tick-dub').text()),
      eps: toCount($(el).find('.film-poster .tick .tick-eps').text()),
    };

    const epsFromInfo = normalizeText(
      $(el)
        .find('.fd-infor .fdi-item')
        .filter((__, item) => /eps/i.test($(item).text()))
        .first()
        .text()
    );
    if (episodes.eps < 1 && epsFromInfo) {
      episodes.eps = toCount(epsFromInfo);
    }

    obj.recommended.push({
      title,
      alternativeTitle:
        normalizeText(titleAnchor.attr('data-jname') || titleAnchor.attr('data-jp')) || title,
      id,
      poster:
        $(el).find('.film-poster .film-poster-img').attr('data-src') ||
        $(el).find('.film-poster .film-poster-img').attr('src') ||
        null,
      type: normalizeText($(el).find('.fd-infor .fdi-item').first().text()) || null,
      duration: normalizeText($(el).find('.fd-infor .fdi-duration').text()) || null,
      episodes,
      is18Plus: $(el).find('.film-poster').has('.tick-rate').length > 0,
    });
  });

  return obj;
}
