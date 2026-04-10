import { axiosInstance } from '../../services/axiosInstance.js';
import { validationError } from '../../utils/errors.js';
import topTenExtract from './topTen.extract.js';

export default async function topTenHandler() {
  const result = await axiosInstance('/home');
  if (!result.success) {
    throw new validationError(result.message);
  }
  const response = topTenExtract(result.data);
  return response;
}
