# Card Art Catalog

The app looks for card illustrations at these paths:

- `oros-1.webp` through `oros-12.webp`
- `copas-1.webp` through `copas-12.webp`
- `espadas-1.webp` through `espadas-12.webp`
- `bastos-1.webp` through `bastos-12.webp`
- `joker-spirit-1.webp` and `joker-spirit-2.webp`

Use vertical `512x768` WebP images. The React UI renders rank, suit, and court labels on top, so generated art should contain no words, numbers, or letters.

Prompt base:

```text
arcane engraved playing card illustration, old mystical tarot style, [suit theme], [rank variation], centered composition, ornate border space, parchment texture, high contrast ink, no words, no numbers, no letters, vertical card art
```

Suit themes:

- Copas: magicians, clerics, mystic orders, ritual vessels.
- Oros: alchemists, magical merchants, coins, ingredients, laboratories.
- Espadas: arcane royal guard, magical warriors, military nobility.
- Bastos: apprentices, familiars, druids, forest servants.
- Jokers: spiritual and mystical figures, more abstract.
