/**
 * Who designed and built the app, and the link back to them. The link carries UTM parameters, so the author's site
 * analytics show which project, which placement and which deployment (host) a visit came from.
 * See docs/author-credit-backlink.md for the pattern.
 */
export const AUTHOR = {
  name: 'Mohammad Hamza',
  role: 'Design, build and development',
  site: 'https://mhfrough.github.io/',
  github: 'https://github.com/mhfrough',
} as const;

/** the project name sent as utm_source (same value as the credits in index.html and humans.txt) */
const PROJECT = 'zingoo';

/** the author's site with UTM parameters for one placement (e.g. "login_hidden_link") */
export function authorUrl(placement: string): string {
  const url = new URL(AUTHOR.site);
  url.searchParams.set('utm_source', PROJECT);
  url.searchParams.set('utm_medium', 'referral');
  url.searchParams.set('utm_campaign', 'built_by');
  url.searchParams.set('utm_content', placement);
  // which deployment the click came from (production, staging, a client's own domain)
  if (typeof location !== 'undefined' && location.hostname) url.searchParams.set('ref', location.hostname);
  return url.toString();
}
