import { axiosInstance } from '../../services/axiosInstance.js';
import { validationError } from '../../utils/errors.js';
import homeExtract from './home.extract.js';

export default async function homeHandler() {
  const result = await axiosInstance('/home');
  if (!result.success) {
    throw new validationError(result.message);
  }
  return homeExtract(result.data);
}
