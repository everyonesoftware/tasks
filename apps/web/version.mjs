// Public build metadata only. Never send account credentials or cache a guessed version.
export async function fetchBuildVersion(fetcher = fetch) {
  try {
    const response = await fetcher('/health', {credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(5000)});
    if (!response.ok) return 'Unavailable';
    const health = await response.json();
    if (health.status !== 'ok' || typeof health.version !== 'string') return 'Unavailable';
    return /^(?:dev|[1-9][0-9]*)$/.test(health.version) ? health.version : 'Unavailable';
  } catch {
    return 'Unavailable';
  }
}
