# Local Arabic font mirrors

These WOFF2 files are official Google Fonts webfont assets downloaded from the
Google Fonts CSS API on 2026-09-22. The API's Arabic unicode subset is used so
the public app keeps the existing English font behavior while Arabic glyphs no
longer depend on a successful Google Fonts request.

## Source and license

The source projects are maintained in the official Google Fonts repository:

- Cairo: https://github.com/google/fonts/tree/main/ofl/cairo
- Tajawal: https://github.com/google/fonts/tree/main/ofl/tajawal
- Almarai: https://github.com/google/fonts/tree/main/ofl/almarai

All three font families are licensed under the SIL Open Font License, Version
1.1. The corresponding license texts are kept beside these assets:

- `cairo-app-local-OFL.txt`
- `tajawal-app-local-OFL.txt`
- `almarai-app-local-OFL.txt`

The webfont files were resolved from the Google Fonts CSS API using the same
family/weight ranges already imported by the app:

- Cairo: `https://fonts.googleapis.com/css2?family=Cairo:wght@200;300;400;500;600;700;800&display=swap`
- Tajawal: `https://fonts.googleapis.com/css2?family=Tajawal:wght@200;300;400;500;700;800;900&display=swap`
- Almarai: `https://fonts.googleapis.com/css2?family=Almarai:wght@300;400;700;800&display=swap`

Only the Arabic WOFF2 subset files needed by the local faces are retained.

## Files, weights, and SHA-256

| Family | Local weight | File | SHA-256 |
| --- | ---: | --- | --- |
| Cairo | 200–800 variable | `cairo-app-local/Cairo-Arabic.woff2` | `748022f50c427456ad66031e855349be3448ee1f05a5f1eb59574ebe0c686749` |
| Tajawal | 300 | `tajawal-app-local/Tajawal-Arabic-300.woff2` | `5d193428e0bb76ca068ded1de74c6365adf14390d69dba944061ff6969a72977` |
| Tajawal | 400 | `tajawal-app-local/Tajawal-Arabic-400.woff2` | `6c9081fd00db08800850fa7d214593aa94992be5159e97557aa60197252cb95a` |
| Tajawal | 500 | `tajawal-app-local/Tajawal-Arabic-500.woff2` | `4255019c1cd986f7cda7869df69baf72730d61304ae14baba4acfeb13085da54` |
| Tajawal | 700 | `tajawal-app-local/Tajawal-Arabic-700.woff2` | `fa5e72326681abee3a4952be582e1c2c2abb27932ef262610c078ce89541f919` |
| Tajawal | 800 | `tajawal-app-local/Tajawal-Arabic-800.woff2` | `5fa525682b4805d95c59943bc4405b993dc9e028fd93cb96f4b50911f3b428b7` |
| Tajawal | 900 | `tajawal-app-local/Tajawal-Arabic-900.woff2` | `4d7f3fca4a75b2bd4291bf1b8c2fddfd86170993938a8a9b436fc0d7ec9ae3ae` |
| Almarai | 300 | `almarai-app-local/Almarai-Arabic-300.woff2` | `1b7794f88e09f36029717dd5ac89214c02a0bdfef74f5ca7ebdf0cf6a837794b` |
| Almarai | 400 | `almarai-app-local/Almarai-Arabic-400.woff2` | `530903c9168cfc13d3ef363b71c042d5c887476c4454a91223309465ae89c87f` |
| Almarai | 700 | `almarai-app-local/Almarai-Arabic-700.woff2` | `006fba6fe32a900c60f154cc9e2e142bf075078dc97a94715dd9f1f5d4e4421e` |
| Almarai | 800 | `almarai-app-local/Almarai-Arabic-800.woff2` | `7acac6ae3ea4d4eeb7c9b636856c46274f5904e02caff83a545d75ebb9754faf` |

The existing `Tajawal Local` assets and CSS remain scoped to the WhatsApp
monitoring page and are not reused by these public-page font faces.