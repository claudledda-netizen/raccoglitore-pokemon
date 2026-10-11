// Costruisce l'indice compatto delle carte a partire dal database pubblico tcgdex/cards-database.
// Uso: npx tsx build-index.ts <cartella data> <file di uscita>
import { readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

const root = process.argv[2]
const out = process.argv[3]
const LANGS = ['en', 'it', 'fr', 'de', 'es', 'pt']
const SKIP_SERIES = new Set(['Pokémon TCG Pocket'])

const sets: any[] = []
const setIdx = new Map<string, number>()
const cards: any[] = []

function variantsOf(c: any, set: any): string[] {
	const v = c.variants
	const res = new Set<string>()
	if (Array.isArray(v)) {
		for (const x of v) if (x && x.type) res.add(x.type)
	} else if (v && typeof v === 'object') {
		for (const k of ['normal', 'holo', 'reverse']) if (v[k]) res.add(k)
		if (v.firstEdition) res.add('1ed')
	}
	return [...res]
}

async function main() {
	for (const serieName of readdirSync(root)) {
		const sp = join(root, serieName)
		if (!statSync(sp).isDirectory() || SKIP_SERIES.has(serieName)) continue
		for (const setName of readdirSync(sp)) {
			const dp = join(sp, setName)
			if (!statSync(dp).isDirectory()) continue
			let set: any
			try {
				set = (await import(pathToFileURL(dp + '.ts').href)).default
			} catch (e) {
				console.error('set non letto', dp, String(e).slice(0, 120))
				continue
			}
			const si = sets.length
			setIdx.set(set.id, si)
			const ab = new Set<string>()
			if (set.abbreviations) for (const k of Object.keys(set.abbreviations)) if (set.abbreviations[k]) ab.add(String(set.abbreviations[k]).toUpperCase())
			if (set.tcgOnline) ab.add(String(set.tcgOnline).toUpperCase())
			sets.push({
				id: set.id,
				s: set.serie?.id,
				n: { en: set.name?.en, it: set.name?.it },
				o: set.cardCount?.official ?? null,
				d: set.releaseDate ?? null,
				a: [...ab],
				c: 0
			})
			for (const f of readdirSync(dp)) {
				if (!f.endsWith('.ts')) continue
				let c: any
				try {
					c = (await import(pathToFileURL(join(dp, f)).href)).default
				} catch (e) {
					console.error('carta non letta', join(dp, f), String(e).slice(0, 120))
					continue
				}
				const localId = f.slice(0, -3)
				const names: Record<string, string> = {}
				for (const l of LANGS) if (c.name?.[l]) names[l] = c.name[l]
				if (!Object.keys(names).length) continue
				// nomi: tengo solo le lingue che differiscono dall'inglese
				const n: Record<string, string> = {}
				for (const l of LANGS) {
					if (!names[l]) continue
					if (l !== 'en' && names[l] === names.en) continue
					n[l] = names[l]
				}
				const atk: string[] = []
				for (const a of c.attacks ?? []) for (const l of ['it', 'en']) if (a?.name?.[l]) atk.push(a.name[l])
				for (const a of c.abilities ?? []) for (const l of ['it', 'en']) if (a?.name?.[l]) atk.push(a.name[l])
				cards.push({
					s: si,
					l: localId,
					n,
					L: Object.keys(names),
					h: c.hp ?? undefined,
					r: c.rarity ?? undefined,
					v: variantsOf(c, set),
					i: c.illustrator ?? undefined,
					k: [...new Set(atk)]
				})
				sets[si].c++
			}
		}
	}
	// tabella delle rarità e delle varianti per ridurre la dimensione
	const rar: string[] = []
	const ill: string[] = []
	const packed = cards.map(c => {
		let ri = c.r ? rar.indexOf(c.r) : -1
		if (c.r && ri < 0) { rar.push(c.r); ri = rar.length - 1 }
		let ii = c.i ? ill.indexOf(c.i) : -1
		if (c.i && ii < 0) { ill.push(c.i); ii = ill.length - 1 }
		// lingue in cui la carta esiste, come maschera di bit nell'ordine di LANGS
		let lm = 0
		LANGS.forEach((l, bi) => { if (c.L.includes(l)) lm |= 1 << bi })
		return [c.s, c.l, c.n, c.h ?? 0, ri, c.v.join(','), ii, c.k, lm]
	})
	const data = { v: 1, built: new Date().toISOString().slice(0, 10), sets, rar, ill, cards: packed }
	writeFileSync(out, JSON.stringify(data))
	console.log('espansioni', sets.length, 'carte', cards.length)
}
main()
