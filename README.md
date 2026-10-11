# Raccoglitore

App web per telefono che fotografa una carta collezionabile, la riconosce e la aggiunge a un inventario personale.

- Il riconoscimento avviene sul telefono: la foto non viene inviata a nessun server.
- La collezione resta nella memoria del browser del telefono.
- Funziona da browser e si può aggiungere alla schermata Home.

## Componenti di terze parti

| Componente | Uso | Licenza |
|---|---|---|
| [TCGdex cards-database](https://github.com/tcgdex/cards-database) | elenco delle carte (`data/cards.json`) | MIT |
| [onnxruntime-web](https://github.com/microsoft/onnxruntime) | esecuzione dei modelli di lettura | MIT |
| [eSearch-OCR](https://github.com/xushengfeng/eSearch-OCR) | lettura del testo | Apache-2.0 |
| Modelli [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) | rilevamento e lettura del testo | Apache-2.0 |
| [Archivo](https://fonts.google.com/specimen/Archivo) | carattere tipografico | OFL-1.1 |

Progetto amatoriale, non affiliato né approvato da Nintendo, Creatures, GAME FREAK o The Pokémon Company. I nomi delle carte appartengono ai rispettivi titolari.
