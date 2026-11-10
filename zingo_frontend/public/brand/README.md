# Zingoo brand assets

Source of the logo: the client prototype `Zingoo_v4_Distributor_Portal.html` (`.logo`, `.logomark`, `.logo-word`, `.logo-small`).
Every SVG here is outlined (no live text, no font needed). PNGs are rendered from the SVGs.

## Colours

| Name | Hex | Use |
|---|---|---|
| Navy | `#111f35` | dark background, "ZING" on light |
| Orange | `#f36a2d` | brand orange, "OO" on light |
| Yellow | `#ffb42e` | "OO" on dark |
| Tile gradient | `#ffad29` to `#ef562e`, 135deg | the Z tile |
| Tagline on dark | `#a4b3c8` | "ZEN FOODS OS" on navy |
| Tagline on light | `#5a6a80` | "ZEN FOODS OS" on white (4.5:1+) |

Contrast: white on navy 17:1, yellow on navy 9.3:1, tagline on navy 7.8:1, navy on white 16.5:1, tagline on white 5.5:1.
Orange "OO" on white is 3.04:1, which passes AA as large bold text (the wordmark is). Do not set it as small body text.
The white Z on the tile gradient is about 2.6:1 at its centre. It is the client's mark, not text, so it is left as drawn.

Wordmark font: Inter Black (900), tagline Inter Bold (700), letter-spacing as in the prototype. The Z is Inter Black.

## Files

Logo (transparent background)

| File | Use |
|---|---|
| `zingoo-logo-dark.svg` / `.png` | full lockup with "ZEN FOODS OS" line, for navy and other dark backgrounds |
| `zingoo-logo-dark-noline.svg` / `.png` | same without the line, for small sizes |
| `zingoo-logo-light.svg` / `.png` | full lockup for white and light backgrounds (navy ZING, orange OO) |
| `zingoo-logo-light-noline.svg` / `.png` | same without the line |
| `zingoo-mark.svg` / `.png` | tile only, tilted, soft shadow. Used in the sidebar and on the login card |

One colour (alpha shape, white fill, Z knocked out of the tile)

| File | Use |
|---|---|
| `zingoo-mark-mask-white.svg` | CSS `mask-image` or one-colour print/embroidery of the tile |
| `zingoo-logo-mask-white.svg` | same for the full lockup with line |
| `zingoo-logo-noline-mask-white.svg` | same without the line |
| `safari-pinned-tab.svg` | Safari pinned tab (`<link rel="mask-icon">`), black silhouette, 16 box |

```css
.logo { background: currentColor; mask: url(/brand/zingoo-logo-mask-white.svg) center / contain no-repeat; }
```

Badges, 512 x 512 (navy ring, orange tile, tilted Z), for avatars and stickers

| File | Use |
|---|---|
| `zingoo-badge-round.svg` / `.png` | round avatar (chat, social, marketplace) |
| `zingoo-badge-square.svg` / `.png` | rounded-square avatar |

Share cards

| File | Use |
|---|---|
| `og-image.svg` / `.png` | 1200 x 630, `og:image` (Facebook, WhatsApp, LinkedIn, Slack) |
| `twitter-image.svg` / `.png` | 1200 x 600, `twitter:image` |

Favicon set (in `public/`, not here)

| File | Use |
|---|---|
| `favicon.svg` | modern browsers, upright tile, bigger Z, no shadow |
| `favicon.ico` | 16, 32, 48 px, legacy and Windows |
| `apple-touch-icon.png` | 180 px, opaque square (iOS rounds it) |
| `icon-192.png`, `icon-512.png` | PWA icons |
| `icon-maskable-512.png` | PWA maskable icon, Z inside the 80% safe zone |
| `site.webmanifest` | PWA manifest, theme and background `#111f35` |

## Notes

- The drop shadow is the prototype's orange shadow, tightened so it fits inside the artboard without a clipped edge. Favicons have no shadow.
- Favicons use an upright tile with a larger Z (tilt kept on the Z only) so they stay legible at 16 px.
- `og:image` and `twitter:image` in `src/index.html` use the placeholder origin `https://app.zingoo.example`. Replace it with the real public URL before launch.
- Regenerate: the build script lives outside the repo (scratch). Edit the SVGs by hand only for tiny tweaks, and re-render PNG/ICO from them.
