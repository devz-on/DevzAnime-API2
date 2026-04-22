import { axiosInstance } from '../../../services/axiosInstance.js';
import { validationError } from '../../../utils/errors.js';
import infoExtract from '../info.extract.js';

export default async function animeInfo(c) {
  const { id } = c.req.valid('param');

  const result = await axiosInstance(`/${id}`);
  if (!result.success) {
    throw new validationError(result.message, 'maybe id is incorrect : ' + id);
  }
  return infoExtract(result.data);
}
