import { commonAnimeObj, episodeObj } from '../../utils/commonAnimeObj.js';
import { load } from 'cheerio';

export default function homeExtract(html) {
  const $ = load(html);
  const animeIdFromHref = (href) => {
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
  };
  const titleFromAnchor = ($el) => {
    const textValue = String($el.text() || '')
      .replace(/\s+/g, ' ')
      .trim();
    return String($el.attr('title') || '').trim() || textValue || null;
  };
  const altTitleFromAnchor = ($el, fallback) => {
    return String($el.attr('data-jname') || $el.attr('data-jp') || '').trim() || fallback || null;
  };

  const response = {
    spotlight: [],
    trending: [],
    topAiring: [],
    mostPopular: [],
    mostFavorite: [],
    latestCompleted: [],
    latestEpisode: [],
    newAdded: [],
    topUpcoming: [],
    topTen: {
      today: null,
      week: null,
      month: null,
    },
    genres: [],
  };
  const $spotlight = $('.deslide-wrap .swiper-wrapper .swiper-slide');
  const $trending = $('#trending-home .swiper-container .swiper-slide');
  const $featured = $('#anime-featured .anif-blocks .row .anif-block');
  const $home = $('.block_area.block_area_home');
  const $topTen = $('.block_area .cbox');
  const $genres = $('.sb-genre-list');

  $($spotlight).each((i, el) => {
    const obj = {
      ...commonAnimeObj(),
      ...episodeObj(),
      rank: null,
      type: null,
      quality: null,
      duration: null,
      aired: null,
      synopsis: null,
    };
    obj.rank = i + 1;
    obj.id = animeIdFromHref($(el).find('.desi-buttons a').first().attr('href'));
    obj.poster =
      $(el).find('.deslide-cover .film-poster-img').attr('data-src') ||
      $(el).find('.deslide-cover .film-poster-img').attr('src');

    const titles = $(el).find('.desi-head-title');
    obj.title = titles.text();
    obj.alternativeTitle = titles.attr('data-jname');

    obj.synopsis = $(el).find('.desi-description').text().trim();

    const details = $(el).find('.sc-detail');
    obj.type = details.find('.scd-item').eq(0).text().trim();
    obj.duration = details.find('.scd-item').eq(1).text().trim();
    obj.aired = details.find('.scd-item.m-hide').text().trim();
    obj.quality = details.find('.scd-item .quality').text().trim();

    const epsEl = details.find('.tick');
    obj.episodes.sub = Number(epsEl.find('.tick-sub').text().trim());
    obj.episodes.dub = Number(epsEl.find('.tick-dub').text().trim());

    const isEps = Number(epsEl.find('.tick-eps').length);

    obj.episodes.eps = isEps
      ? Number(epsEl.find('.tick-eps').text().trim())
      : Number(epsEl.find('.tick-sub').text().trim());

    response.spotlight.push(obj);
  });

  $($trending).each((i, el) => {
    const obj = {
      title: null,
      alternativeTitle: null,
      rank: null,
      poster: null,
      id: null,
    };

    const titleEl = $(el).find('.item .film-title');
    obj.title = titleEl.text();
    obj.alternativeTitle = titleEl.attr('data-jname');

    obj.rank = i + 1;

    const imageEl = $(el).find('.film-poster');

    obj.poster = imageEl.find('img').attr('data-src') || imageEl.find('img').attr('src');
    obj.id = animeIdFromHref(imageEl.attr('href'));

    response.trending.push(obj);
  });

  $($featured).each((i, el) => {
    const data = $(el)
      .find('.anif-block-ul ul li')
      .map((index, item) => {
        const obj = {
          ...commonAnimeObj(),
          ...episodeObj(),
          type: null,
        };
        const titleEl = $(item).find('.film-detail .film-name a').first();
        obj.title = titleFromAnchor(titleEl);
        obj.alternativeTitle = altTitleFromAnchor(titleEl, obj.title);
        obj.id =
          animeIdFromHref(titleEl.attr('href')) ||
          animeIdFromHref($(item).find('.film-poster a').first().attr('href'));

        obj.poster =
          $(item).find('.film-poster .film-poster-img').attr('data-src') ||
          $(item).find('.film-poster .film-poster-img').attr('src');
        obj.type = String($(item).find('.fd-infor .fdi-item').first().text() || '')
          .replace(/\s+/g, ' ')
          .trim();

        obj.episodes.sub = Number($(item).find('.fd-infor .tick-sub').text());
        obj.episodes.dub = Number($(item).find('.fd-infor .tick-dub').text());

        const epsText = $(item).find('.fd-infor .tick-eps').length
          ? $(item).find('.fd-infor .tick-eps').text()
          : $(item).find('.fd-infor .tick-sub').text();

        obj.episodes.eps = Number(epsText);

        return obj;
      })
      .get();

    const dataType = $(el).find('.anif-block-header').text().replace(/\s+/g, '');
    const normalizedDataType = dataType.charAt(0).toLowerCase() + dataType.slice(1);
    if (normalizedDataType === 'completed') {
      response.latestCompleted = data;
    } else if (normalizedDataType === 'newAdded' || normalizedDataType === 'newOnHiAnime') {
      response.newAdded = data;
    } else {
      response[normalizedDataType] = data;
    }
  });

  $($home).each((i, el) => {
    const data = $(el)
      .find('.tab-content .film_list-wrap .flw-item')
      .map((index, item) => {
        const obj = {
          ...commonAnimeObj(),
          ...episodeObj(),
        };
        const titleEl = $(item)
          .find(
            '.film-detail .film-name a.d-title, .film-detail .film-name a, .film-detail .film-name .dynamic-name'
          )
          .first();
        obj.title = titleFromAnchor(titleEl);
        obj.alternativeTitle = altTitleFromAnchor(titleEl, obj.title);
        obj.id =
          animeIdFromHref(titleEl.attr('href')) ||
          animeIdFromHref(
            $(item).find('.film-poster a, .film-poster .film-poster-ahref').first().attr('href')
          );

        obj.poster =
          $(item).find('.film-poster img').attr('data-src') ||
          $(item).find('.film-poster img').attr('src');

        const episodesEl = $(item).find('.film-poster .tick');
        obj.episodes.sub = Number($(episodesEl).find('.tick-sub').text());
        obj.episodes.dub = Number($(episodesEl).find('.tick-dub').text());

        const epsText = $(episodesEl).find('.tick-eps').length
          ? $(episodesEl).find('.tick-eps').text()
          : $(episodesEl).find('.tick-sub').text();

        obj.episodes.eps = Number(epsText);

        return obj;
      })
      .get();

    const dataType = $(el).find('.cat-heading').text().replace(/\s+/g, '');
    const normalizedDataType = dataType.charAt(0).toLowerCase() + dataType.slice(1);

    if (normalizedDataType === 'newOnHiAnime' || normalizedDataType === 'newAdded') {
      response.newAdded = data;
    } else if (normalizedDataType === 'recentlyUpdated') {
      response.latestEpisode = data;
    } else {
      response[normalizedDataType] = data;
    }
  });

  const extractTopTen = (id) => {
    const res = $topTen
      .find(`${id} ul li`)
      .map((i, el) => {
        const obj = {
          title: String($(el).find('.film-name a').text() || '')
            .replace(/\s+/g, ' ')
            .trim(),
          rank: i + 1,
          alternativeTitle:
            $(el).find('.film-name a').attr('data-jname') ||
            $(el).find('.film-name a').attr('data-jp') ||
            null,
          id: animeIdFromHref($(el).find('.film-name a').attr('href')),
          poster:
            $(el).find('.film-poster img').attr('data-src') ||
            $(el).find('.film-poster img').attr('src') ||
            null,
          episodes: {
            sub: Number($(el).find('.tick-item.tick-sub').text()),
            dub: Number($(el).find('.tick-item.tick-dub').text()),
            eps: $(el).find('.tick-item.tick-eps').length
              ? Number($(el).find('.tick-item.tick-eps').text())
              : Number($(el).find('.tick-item.tick-sub').text()),
          },
        };
        return obj;
      })
      .get();
    return res;
  };

  response.topTen.today = extractTopTen('#top-viewed-day');
  response.topTen.week = extractTopTen('#top-viewed-week');
  response.topTen.month = extractTopTen('#top-viewed-month');
  $($genres)
    .find('li')
    .each((i, el) => {
      const genre = String($(el).find('a').attr('title') || '')
        .trim()
        .toLowerCase();
      if (genre) {
        response.genres.push(genre);
      }
    });
  return response;
}
