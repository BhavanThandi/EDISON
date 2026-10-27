# Online op-amp photo set: sources and licences

Real breadboard photos of op-amp (and look-alike) builds for `npm run photo-eval -- --set online` (Part A, Task A5). They test how the photo reader handles DIP-8 dual op-amps next to resistors, capacitors, LEDs and wires, and the negative cases it must not build as a TL072 (NE555 timers, 14/16-pin logic chips). **Changes made:** like the eval and web sets, every image was turned upright (its EXIF orientation applied; `wm03_oscillator.jpg` was stored sideways) and scaled down to at most 2,048 px on its long edge, then re-saved as JPEG. Nothing was cropped or otherwise edited. Corner taps are in these files' pixels.

| File | Source | Author | Licence |
|---|---|---|---|
| `fl01_ne5532.jpg` | [Flickr 6875590428](https://www.flickr.com/photos/28622838@N00/6875590428) ("IMG_8647", 2-bit noise synth) | Kyle McDonald | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `fl02_lm358_top.jpg` | [Flickr 3381415529](https://www.flickr.com/photos/51753258@N00/3381415529) ("R0010555") | Sho Hashimoto (shokai) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `fl03_lm358_oblique.jpg` | [Flickr 3381415737](https://www.flickr.com/photos/51753258@N00/3381415737) ("R0010557") | Sho Hashimoto (shokai) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `fl06_ne555_neg.jpg` | [Flickr 5933950051](https://www.flickr.com/photos/45581782@N00/5933950051) ("Traffic Lights") | Paul Downey (psd) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| `wm03_oscillator.jpg` | [Final_product_Oscillator.JPG](https://commons.wikimedia.org/wiki/File:Final_product_Oscillator.JPG) | Mcyr1793 | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| `wm04_50hz_osc.jpg` | [50_Hz_Oscillator.jpg](https://commons.wikimedia.org/wiki/File:50_Hz_Oscillator.jpg) | Odoulorenzo | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |

The CC BY-SA images are adapted (turned upright and resized only) and are shared under the same licence as their originals; any further derived copy must be too.

Left out of the source folder's 12 photos: `fl04_lm358_mbed`, `fl07_mfos_vco` and `wm01_lm741_neg` (the four corner holes are not all in view), `fl05_cmoy_kitboard` (a "300 in ONE" kit board, rows A-V: no a-j grid to tap), `wm02_opamp_mini` (a 23-column mini board: the page offers 30 or 63 columns only), and `wm05_ultrasound_preamp` (the same photo as `../eval/e01_preamp.jpg`, already in the eval set).

## Files
- `photos.json`: per photo, `file`, the column count `cols` (30 or 63) the page is set to, the image's `width` and `height` as the browser shows it (EXIF applied), and `taps`: the four corner holes `a1`, `aN`, `jN`, `j1` (N = `cols`) → `[x, y]` photo pixels, in the order the page asks for them. Also `source`, `license`, and for `wm03` its `exif_orientation` and a `note`.
- `truth.json`: the hand-labelled truth per photo, in the app's hole names (as in `../eval/truth.json`: body `c14` in the board's printed labels, rails `rail:<aOuter|aInner|jInner|jOuter>:<col>`, `off` for an end that leaves the board, `?` for a leg that can't be seen):
  - `notes`: what the photo shows and every labelling choice (which end is column 1, unprinted boards, what is ignored).
  - `rails`: each rail strip's printed sign (`'+'`, `'-'` or `'?'` when not printed).
  - `parts`: every part with `type` (`resistor`, `led`, `capacitor`, `potentiometer`, `diode`, `button`, `ic`, `other`), `value` when readable, and its `leads` (`pin`, `hole`, `conf`, and a `note` when the leg is uncertain). Chips whose pin 1 (notch or dot) can be seen have `pin` `'1'`…`'N'`; the others have `orientation: "unknown"` and no pin names. Chips the app must not build as a TL072 (NE555, 14/16-pin logic) have `expect: "flagged"`.
  - `wires`: every jumper with its `color` and two `ends` (same shape as leads, no pin).
  - `conf`: `high`, `med` or `low` per leg; a `?` leg is always `low` with a `note`. Scoring is by node (column + half, or rail strip), so a `low` leg whose column is right still scores.
- Drafted from the images by an agent: the `low` and `med` legs listed in the A5 report are for a human spot-check before the A6 numbers are trusted.
