const variant = process.env.PERF_ARTIFACT ?? 'current';
if (!['current', 'before', 'after'].includes(variant)) throw new Error('PERF_ARTIFACT must be current, before or after');
// Fixed paths let a comparison alternate frozen builds without rebuilding between runs.
export const artifactDirectory = variant === 'current' ? 'dist' : `test-results/performance-${variant}`;
