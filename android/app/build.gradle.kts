import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// La parte web dell'app sta nella radice del repository (la stessa pubblicata su GitHub Pages).
// A ogni compilazione viene copiata tra le risorse dell'app, nella cartella "web".
val radiceWeb: File = rootProject.projectDir.parentFile
val risorseWeb: File = layout.buildDirectory.dir("generated/risorseWeb").get().asFile

val copiaAppWeb = tasks.register<Sync>("copiaAppWeb") {
    from(radiceWeb) {
        include("index.html", "manifest.webmanifest", "css/**", "js/**", "data/**", "vendor/**", "icons/**")
    }
    into(File(risorseWeb, "web"))
}

android {
    namespace = "io.github.claudleddanetizen.raccoglitore"
    compileSdk = 34

    defaultConfig {
        applicationId = "io.github.claudleddanetizen.raccoglitore"
        minSdk = 29
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    // Chiave di prova fissa, tenuta nel progetto: così ogni compilazione produce un'app
    // che si può installare sopra la precedente senza perdere la collezione.
    signingConfigs {
        getByName("debug") {
            storeFile = rootProject.file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    androidResources {
        // modelli e motore di lettura: già compatti, inutile comprimerli di nuovo
        noCompress += listOf("onnx", "wasm")
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(risorseWeb)
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

tasks.named("preBuild") {
    dependsOn(copiaAppWeb)
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
}
