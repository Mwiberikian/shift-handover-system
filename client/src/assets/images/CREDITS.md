# Image credits

All photos are from [Unsplash](https://unsplash.com) and used under the
[Unsplash License](https://unsplash.com/license) (free to use, no attribution
required; credited here anyway). Each file was downloaded once from the
`images.unsplash.com` URL below, resized and re-encoded as WebP, and is served
locally so the app never depends on Unsplash at runtime.

| File | Subject | Source page | Downloaded from |
| --- | --- | --- | --- |
| `runway-dusk.webp` | Aerial view of a runway at sunset (Skellefteå Airport), by Niklas Jonasson | https://unsplash.com/photos/3p3HtGKvGLM | `https://images.unsplash.com/photo-1683971336619-d445cbec0276` |
| `control-tower.webp` | Airport control tower under a cloudy sky | https://unsplash.com/photos/4CsZ1u4F1b4 | `https://images.unsplash.com/photo-1770531233543-295228efa818` |
| `departure-board.webp` | Split-flap departures board | https://unsplash.com/photos/mqvE1ctiW6Y | `https://images.unsplash.com/photo-1750941416707-4dff777c67b1` |
| `aircraft-gate.webp` | Aircraft on a jet bridge at night with ground crew, by Sean Wang | https://unsplash.com/photos/UzFwyYIB84Q | `https://images.unsplash.com/photo-1761398352790-fa2278c2e1e9` |
| `terminal.webp` | Terminal seating with floor-to-ceiling windows | https://unsplash.com/photos/wQ1nctYvfLM | `https://images.unsplash.com/photo-1757206637677-330df0d7dfe8` |

## Page-background variants (`bg/`)

`bg/*.webp` are the same five photos re-fetched from the URLs above at
1600×1000 with lower quality (`q=45–55`) for use as full-page backgrounds behind
an overlay on the supervisor and admin screens, each kept under 200 KB (NFR-01).
`bg/departure-board.webp` is additionally softened (`blur=12`), since the
split-flap detail otherwise does not compress below 500 KB.
