const runtimeEnv = typeof process !== 'undefined' && process?.env ? process.env : {};

function normalizeBaseUrl(raw) {
  const fallback = 'https://hianime.dk';
  const value = String(raw || '').trim();
  if (!value) {
    return fallback;
  }

  try {
    const parsed = new URL(value);
    const host = String(parsed.hostname || '').toLowerCase();

    // Legacy HiAnime hosts now serve a shutdown page; force a working fallback.
    if (
      host === 'hianime.to' ||
      host === 'hianimes.se' ||
      host === 'hianime.sx' ||
      host.endsWith('.hianime.to') ||
      host.endsWith('.hianimes.se') ||
      host.endsWith('.hianime.sx')
    ) {
      return fallback;
    }

    return `${parsed.origin}`.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

const config = {
  baseurl: normalizeBaseUrl(runtimeEnv.HIANIMES_REFERER),
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  },
};

export default config;
