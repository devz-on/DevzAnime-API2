import { commonAnimeObj, episodeObj } from '../../utils/commonAnimeObj.js';
import { load } from 'cheerio';

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toCount(value) {
  const match = String(value || '').match(/\d+/);
  return match ? Number(match[0]) : 0;
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

export default function exploreExtract(html) {
  const $ = load(html);

  const response = [];
  const cards = $('.flw-item');
  if (cards.length < 1) {
    return {
      pageInfo: {
        currentPage: 1,
        hasNextPage: false,
        totalPages: 1,
      },
      response: [],
    };
  }

  cards.each((_, el) => {
    const obj = {
      ...commonAnimeObj(),
      ...episodeObj(),
      type: null,
      duration: null,
    };

    obj.poster =
      $(el).find('.film-poster .film-poster-img').attr('data-src') ||
      $(el).find('.film-poster .film-poster-img').attr('src');

    const ticks = $(el).find('.film-poster .tick').first();
    obj.episodes.sub = toCount(ticks.find('.tick-sub, .tick-item.tick-sub').first().text());
    obj.episodes.dub = toCount(ticks.find('.tick-dub, .tick-item.tick-dub').first().text());
    obj.episodes.eps = toCount(ticks.find('.tick-eps, .tick-item.tick-eps').first().text());
    if (!obj.episodes.eps) {
      obj.episodes.eps = Math.max(obj.episodes.sub || 0, obj.episodes.dub || 0);
    }

    const titleEL = $(el)
      .find(
        '.film-detail .film-name a.d-title, .film-detail .film-name a, .film-name a.d-title, .film-name a'
      )
      .first();
    obj.title = normalizeText(titleEL.text()) || normalizeText(titleEL.attr('title'));
    obj.alternativeTitle =
      normalizeText(titleEL.attr('data-jname') || titleEL.attr('data-jp')) || obj.title;

    obj.id =
      animeIdFromHref(titleEL.attr('href')) ||
      animeIdFromHref(
        $(el).find('.film-poster a, .film-poster .film-poster-ahref').first().attr('href')
      );
    if (!obj.id || !obj.title) {
      return;
    }

    obj.type = normalizeText($(el).find('.fd-infor .fdi-item').first().text()) || null;
    obj.duration =
      normalizeText($(el).find('.fd-infor .fdi-duration').text()) ||
      normalizeText($(el).find('.fd-infor .fdi-item').eq(1).text()) ||
      null;

    response.push(obj);
  });

  const paginationEl = $('.pre-pagination .pagination .page-item');
  const currentPage =
    Number(normalizeText(paginationEl.find('.active .page-link').first().text())) || 1;
  const numberedPages = paginationEl
    .find('.page-link[href*="page="]')
    .map((_, link) => {
      const href = String($(link).attr('href') || '');
      const match = href.match(/[?&]page=(\d+)/i);
      return match ? Number(match[1]) : 0;
    })
    .get()
    .filter((value) => Number.isFinite(value) && value > 0);

  const totalPages = Math.max(currentPage, numberedPages.length ? Math.max(...numberedPages) : 1);
  const pageInfo = {
    totalPages,
    currentPage,
    hasNextPage: currentPage < totalPages,
  };

  return { pageInfo, response };
}
