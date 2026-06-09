# Card Art Catalog

The app looks for card illustrations at these paths:

- `oros-1.webp` through `oros-12.webp`
- `copas-1.webp` through `copas-12.webp`
- `espadas-1.webp` through `espadas-12.webp`
- `bastos-1.webp` through `bastos-12.webp`
- `joker-spirit-1.webp` and `joker-spirit-2.webp`

Use vertical `512x768` WebP images. The React UI renders only the numeric value on top of the art, so generated art should contain no words, numbers, or letters.

Current premium reference assets:

- `concepts/bastos-druid-reference.png`: target quality for character cards.
- `concepts/card-back-reference.png`: target quality for deck backs.
- `card-back.webp`: active deck back.
- `bastos-1.webp` through `bastos-12.webp`: completed premium Living Wand / druid family.
- `oros-1.webp` through `oros-12.webp`: completed premium Solar Alchemist family.
- `copas-1.webp` through `copas-12.webp`: completed premium Moon Chalice Oracle family.
- `espadas-1.webp` through `espadas-12.webp`: completed Steel Arcanist family. Some images are derived variants from valid AI outputs because generation was intermittent.
- `legacy/`: older geometric placeholders kept only as fallback references.

Prompt base:

```text
arcane engraved playing card illustration, old mystical tarot style, [suit theme], [rank variation], centered composition, ornate border space, parchment texture, high contrast ink, no words, no numbers, no letters, vertical card art
```

Suit themes:

- Bastos: druids of the living wand, branch staffs, roots, moss robes, enchanted forest magic.
- Espadas: arcanists of steel, duelists, royal arcane guard, runic blades, ritual armor.
- Copas: oracles of the chalice, healers, mystic vessels, water temples, spiritual relics.
- Oros: alchemists of the sun, coins, contracts, transmutation, laboratories, gold dust.
- Jokers: spiritual and mystical figures, more abstract.

Premium character prompt:

```text
premium collectible fantasy playing card illustration, [school theme], one wizard character, ornate school-specific border, centered vertical composition, readable silhouette, painterly magical realism, dramatic lighting, rich material texture, no words, no numbers, no letters, no watermark
```

Card back prompt:

```text
premium fantasy playing card back, symmetrical ornate arcane design, deep crimson leather, golden filigree, central glowing magic circle, parchment edge wear, readable at small size, no words, no numbers, no letters, no watermark
```
