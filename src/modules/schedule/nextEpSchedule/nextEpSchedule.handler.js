import { getNextScheduleData } from '../../../services/providerDetails.js';
import { validationError } from '../../../utils/errors.js';

export default async function nextEpScheduleHandler(c) {
  let id = null;

  try {
    const validatedParam = c.req.valid?.('param');
    id = validatedParam?.id || null;
  } catch {
    // When called from a non-openapi route alias, fallback to raw route params.
  }

  id = id || c.req.param?.('id');
  if (!id) {
    throw new validationError('make sure id is correct');
  }

  return getNextScheduleData(id, c);
}
