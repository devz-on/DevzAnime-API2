import { getScheduleData } from '../../../services/providerContent.js';

export default async function monthyScheduleHandler(c) {
  const date = c.req.query('date');
  return getScheduleData(date, c);
}
