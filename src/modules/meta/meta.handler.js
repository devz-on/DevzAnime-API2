import { genres, azList, exploreRoutes, filterOptions } from '../../config/meta.js';

export default async function metaHandler() {
  return {
    genres,
    azList,
    exploreRoutes,
    filterOptions: { ...filterOptions, genres },
  };
}
