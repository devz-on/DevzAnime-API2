import { getScheduleData } from '../../../services/providerContent.js';

export default async function monthyScheduleHandler(c) {
  const { date } = c.req.valid('query');
  return getScheduleData(date, c);
}
