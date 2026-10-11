# Strumenti

`build-index.ts` rigenera `data/cards.json`, l'elenco delle carte usato per il riconoscimento,
a partire dal database pubblico [tcgdex/cards-database](https://github.com/tcgdex/cards-database).
Va rilanciato quando escono nuove espansioni.

```
git clone --depth 1 https://github.com/tcgdex/cards-database.git
npm install tsx
npx tsx build-index.ts cards-database/data ../data/cards.json
```
