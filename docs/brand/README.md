# Ultra Mod brand kit

The Ultra Mod mark is a status card with three lines of text and a teal status dot. The logo pairs it with the wordmark `Ultra Mod` set in Newsreader.

## Files

| Use | File |
|---|---|
| Logo on a light background | `svg/ultramod-logo-on-light.svg`, `png/ultramod-logo-on-light-1600.png` |
| Logo on a dark background | `svg/ultramod-logo-on-dark.svg`, `png/ultramod-logo-on-dark-1600.png` |
| Mark alone on a light background | `svg/ultramod-mark.svg`, `png/ultramod-mark-1024.png` |
| Mark alone on a dark background | `svg/ultramod-mark-on-dark.svg` |
| App icon (512 px tile, corner radius 112) | `svg/ultramod-appicon.svg`, `png/ultramod-appicon-1024.png` |
| Favicon, the app icon tile at small size (reads on light and dark tabs) | `favicon/favicon.svg` |
| The same favicon for older browsers (16, 32 and 48 px in one file) | `favicon/favicon.ico` |
| The same favicon as a 32 px PNG | `favicon/favicon-32.png` |
| Home screen icon (180 px, opaque) | `favicon/apple-touch-icon.png` |

The logo and mark PNGs have transparent backgrounds. The app icon PNG and the favicons have transparent rounded corners. The home screen icon is a full opaque square, because iOS rounds the corners itself.

## Colour

| Role | Light surfaces | Contrast on #FFFFFF / #FDF8F1 | Dark surfaces | Contrast on #0D1117 / #12171D |
|---|---|---|---|---|
| Ink | `#1E2A38` | 14.55 / 13.77 | `#EEE7DB` | 15.40 / 14.66 |
| Accent | `#0F6B66` | 6.33 / 5.99 | `#5FC2BA` | 8.93 / 8.50 |

| App icon | Colour | Contrast on the tile |
|---|---|---|
| Tile | `#FDF8F1` | |
| Ink | `#1E2A38` | 13.77 |
| Accent | `#0F6B66` | 5.99 |

README icon colour: `#348580`, 4.36 on #FFFFFF and 4.34 on #0D1117.

## Usage

- Pick the file that matches the background: on-light files for white or paper, on-dark files for dark surfaces. In a README, use a `<picture>` element with the dark logo as the `prefers-color-scheme: dark` source.
- Keep clear space around the logo of at least half the height of the mark.
- Smallest sizes: 16 px for the mark, 120 px wide for the logo.
- The wordmark is drawn as outlined paths, so it looks the same everywhere. Use the supplied files and leave the letters as they are.
- Do not recolour, rotate, stretch, outline or add effects to the mark.

## Font

Newsreader, wght 600, opsz 48. Source: `Newsreader[opsz,wght].ttf` from [google/fonts](https://github.com/google/fonts/tree/86aced91de05cd4f96a06838124cca45be337b2b/ofl/newsreader) at commit `86aced91de05`. Licence: SIL Open Font License 1.1. The letters are converted to paths, so the font is not needed to display the logo.
