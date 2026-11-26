# Author credit and hidden backlink

How to put a quiet "designed and developed by" credit into a web project, with a link back to the author's site that
reports where each visit came from. Copy this into any project (Angular, React, Vue, plain HTML) and change the
values in the table.

| Value | Zingoo uses | Change to |
|---|---|---|
| Author name | Mohammad Hamza | your name |
| Author site | https://mhfrough.github.io/ | your site |
| GitHub | https://github.com/mhfrough | your profile |
| Project key (`utm_source`) | `zingoo` | short lower-case project name, no spaces |

## What it adds

1. **Credits in the page head** (not shown on screen; read by search engines, browser tools and anyone viewing the source).
2. **`humans.txt`** at the site root, linked from the head.
3. **One invisible clickable credit on the sign-in page**: a dot in the bottom-right corner of the brand panel with
   `opacity: 0`, so nobody sees it. Clicking that corner opens the author's site in a new tab.
4. **UTM parameters on every link**, so the author's analytics (Google Analytics, Plausible, Umami ...) show
   which project, which placement and which deployment a visit came from.

## UTM scheme

Every link to the author's site carries:

| Parameter | Value | Tells you |
|---|---|---|
| `utm_source` | project key, e.g. `zingoo` | which project sent the visit |
| `utm_medium` | `referral` | it is a backlink, not an ad or email |
| `utm_campaign` | `built_by` | it is an author credit |
| `utm_content` | the placement: `html_source`, `meta_link`, `humans_txt`, `login_hidden_link` ... | which link was used |
| `ref` | the host the click came from (added at runtime), e.g. `zingo-web.onrender.com` | which deployment (production, staging, a client's domain) |

Example:
`https://mhfrough.github.io/?utm_source=zingoo&utm_medium=referral&utm_campaign=built_by&utm_content=login_hidden_link&ref=zingo-web.onrender.com`

## 1. Page head (index.html)

```html
<!doctype html>
<!--
  <Project name>
  Designed, built and developed by Mohammad Hamza
    GitHub:  https://github.com/mhfrough
    Website: https://mhfrough.github.io/?utm_source=PROJECT&utm_medium=referral&utm_campaign=built_by&utm_content=html_source
-->
<html lang="en">
<head>
  ...
  <!-- credits (not shown on the page) -->
  <meta name="author" content="Mohammad Hamza (github.com/mhfrough, mhfrough.github.io)">
  <meta name="creator" content="Mohammad Hamza">
  <meta name="designer" content="Mohammad Hamza">
  <link rel="author" href="humans.txt">
  <link rel="me" href="https://github.com/mhfrough">
  <link rel="me" href="https://mhfrough.github.io/?utm_source=PROJECT&amp;utm_medium=referral&amp;utm_campaign=built_by&amp;utm_content=meta_link">
</head>
```

Note: inside an HTML attribute write `&amp;` between parameters.

## 2. humans.txt (public / static folder, served at /humans.txt)

```
/* TEAM */
Developer: Mohammad Hamza
Role: Design, build and development
GitHub: https://github.com/mhfrough
Site: https://mhfrough.github.io/?utm_source=PROJECT&utm_medium=referral&utm_campaign=built_by&utm_content=humans_txt

/* SITE */
Name: <Project name>
Components: <framework, backend, database>
```

## 3. The link builder (one small file)

TypeScript / JavaScript, works in any framework:

```ts
// shared/author.ts
export const AUTHOR = {
  name: 'Mohammad Hamza',
  site: 'https://mhfrough.github.io/',
  github: 'https://github.com/mhfrough',
} as const;

const PROJECT = 'zingoo'; // utm_source: change per project

/** the author's site with UTM parameters for one placement (e.g. "login_hidden_link") */
export function authorUrl(placement: string): string {
  const url = new URL(AUTHOR.site);
  url.searchParams.set('utm_source', PROJECT);
  url.searchParams.set('utm_medium', 'referral');
  url.searchParams.set('utm_campaign', 'built_by');
  url.searchParams.set('utm_content', placement);
  if (typeof location !== 'undefined' && location.hostname) url.searchParams.set('ref', location.hostname);
  return url.toString();
}
```

## 4. The invisible credit on the sign-in page

A small link in the bottom-right corner of the sign-in page's brand / image panel (any panel with
`position: relative`), with `opacity: 0`. It stays clickable: a click on that corner opens the author's site.

**Angular** (component + template, inside the panel element):

```ts
import { AUTHOR, authorUrl } from '../shared/author';

export class Login {
  protected author = AUTHOR;
  protected creditUrl = authorUrl('login_hidden_link');
}
```

```html
<aside class="auth__brand">
  ...
  <a class="auth__credit" [href]="creditUrl" target="_blank" rel="noopener author" tabindex="-1"
     [attr.aria-label]="'Designed and developed by ' + author.name">·</a>
</aside>
```

**React**:

```tsx
import { AUTHOR, authorUrl } from './shared/author';

<aside className="auth__brand">
  {/* ... */}
  <a className="auth__credit" href={authorUrl('login_hidden_link')} target="_blank" rel="noopener author"
     tabIndex={-1} aria-label={`Designed and developed by ${AUTHOR.name}`}>·</a>
</aside>
```

**Plain HTML** (set the href with a line of script so `ref` gets the host):

```html
<aside class="auth__brand">
  ...
  <a class="auth__credit" id="credit" target="_blank" rel="noopener author" tabindex="-1"
     aria-label="Designed and developed by Mohammad Hamza">·</a>
</aside>
<script>
  document.getElementById('credit').href =
    'https://mhfrough.github.io/?utm_source=PROJECT&utm_medium=referral&utm_campaign=built_by&utm_content=login_hidden_link&ref=' +
    encodeURIComponent(location.hostname);
</script>
```

**CSS**:

```css
.auth__brand { position: relative; }   /* the panel the dot sits in */

.auth__credit {
  position: absolute;
  bottom: 0.5rem;
  right: 0.5rem;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 1rem;
  height: 1rem;
  color: inherit;
  font-size: 12px;
  line-height: 1;
  text-decoration: none;
  cursor: default;   /* no hand cursor gives it away */
  opacity: 0;        /* invisible, but still clickable */
}
```

`tabindex="-1"` keeps it out of the keyboard Tab order, so it never shows a focus ring.

## Rules to keep it safe and honest

- Use `opacity: 0`, never `display: none` or `visibility: hidden`: those remove the link, so a click does nothing.
- Keep the `aria-label` so screen-reader users still hear what the link is.
- Search engines may ignore or discount an invisible link, so do not count on it for SEO: it is for the click and
  the UTM report. The head credits and humans.txt are the visible-to-crawlers part.
- `target="_blank"` always with `rel="noopener"`; `rel="author"` marks it as the author's page.
- One hidden link per project is enough (the sign-in page). The head credits and humans.txt cover the rest.
- Never put personal data (user names, emails, ids) in the UTM parameters: only the project key, the placement and
  the host name.
- The client's own brand stays first everywhere on screen; the credit is only the invisible dot on the sign-in page.

## Checklist for a new project

- [ ] `index.html`: comment block, `author` / `creator` / `designer` meta, `rel="author"` and `rel="me"` links
- [ ] `humans.txt` in the static folder
- [ ] `shared/author.ts` (or `.js`) with the project key set
- [ ] the invisible credit dot in the corner of the sign-in brand panel, with its CSS
- [ ] open the sign-in page, click the bottom-right corner of the panel, confirm the author's site opens with `utm_source=<project>` and `ref=<host>`
- [ ] in the author's analytics, filter by `utm_campaign = built_by` to see every project's visits
