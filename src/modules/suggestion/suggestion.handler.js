import { getSuggestionData } from '../../services/providerContent.js';

export default async function suggestionHandler(c) {
  const { keyword } = c.req.valid('query');
  return getSuggestionData(keyword, c);
}
