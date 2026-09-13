# The inference engine goes here

Empty in a fresh clone, and that is correct: the engine binary is 100-400MB
depending on the acceleration build and is not committed.

    node scripts/fetch-engine.mjs --list
    node scripts/fetch-engine.mjs --build cuda12 --accept-unverified

The app builds and runs without it. With no engine installed it says so and
offers the command above, and an external OpenAI-compatible server can be used
instead. That is why this is a bundle *resource* rather than Tauri's
externalBin: externalBin is a hard build requirement, so declaring it there
would mean nobody could compile ForgeLocal at all until they had downloaded
several hundred megabytes.

Model weights are NOT here and are in no installer. They live in the user's
own model folder and are downloaded from the app.
