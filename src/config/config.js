const runtimeEnv = typeof process !== 'undefined' && process?.env ? process.env : {};

const config = {
  baseurl: runtimeEnv.HIANIMES_REFERER || 'https://hianimes.se/',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
};
export default config;
