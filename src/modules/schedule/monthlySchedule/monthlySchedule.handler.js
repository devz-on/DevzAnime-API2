import { getScheduleData } from '../../../services/providerContent.js';
import { validationError } from '../../../utils/errors.js';

export default async function monthyScheduleHandler(c) {
  try {
    return await getScheduleData(c.req.query('date'), c);
  } catch (error) {
    throw new validationError(error?.message || 'page not found');
  }
}
