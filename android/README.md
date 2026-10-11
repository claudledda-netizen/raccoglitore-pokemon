# App Android

Progetto Android Studio che racchiude la stessa app web del repository dentro un'app installabile.
Il codice Kotlin (`MainActivity.kt`) fa solo da ponte con il telefono: serve i file dell'app dalle
risorse interne, apre la fotocamera e salva o condivide i file esportati.

## Scaricare l'app già compilata

A ogni modifica GitHub compila l'app e la pubblica qui:
<https://github.com/claudledda-netizen/raccoglitore-pokemon/releases/tag/android-ultima>

Scarica `raccoglitore.apk` sul telefono e aprilo. Android chiede di consentire l'installazione da
questa fonte: è normale per le app che non arrivano dal Play Store.

## Compilarla sul PC

1. Scarica tutto il repository (non solo questa cartella: la parte web sta nella radice).
2. In Android Studio scegli "Open" e apri la cartella `android`.
3. Aspetta la sincronizzazione di Gradle, collega il telefono e premi "Run".

Da riga di comando: `./gradlew assembleDebug` dentro `android`. L'APK finisce in
`app/build/outputs/apk/debug/`.

## Note

- Android minimo: 10 (API 29).
- La parte web viene copiata tra le risorse a ogni compilazione dal compito Gradle `copiaAppWeb`.
- `debug.keystore` è una chiave di prova con la password standard `android`, tenuta nel progetto
  perché ogni compilazione produca un'app aggiornabile sopra la precedente. Non è un segreto e
  non va usata per pubblicare l'app su uno store.
- La collezione dell'app Android è separata da quella dell'app aperta nel browser: per passare
  dall'una all'altra usa "Salva una copia dei dati" e "Ripristina da una copia".
