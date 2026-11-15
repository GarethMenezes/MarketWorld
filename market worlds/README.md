# Market Worlds — legacy demo

This is the old version. Further development happened on [sota](https://github.com/GarethMenezes/MarketWorld/tree/sota), which was merged into [main](https://github.com/GarethMenezes/MarketWorld/tree/main). Use `main` for the latest project.

## About the demo

An interactive DurHack 2026 journey through market history, shown as a changing 3D planet. Explore seven dated chapters with good/bad explanations, enter a date, or play the timeline automatically. Drag to rotate and use +/− to zoom.

The planet's terrain, ocean, clouds and atmosphere change with each chapter. Volcano and Storm modes let you preview lava, ash and gloomy skies. These visuals illustrate market conditions; they are not measured financial data or historical eruption records.

## Run it yourself

Install Git and Python 3, then run:

```sh
git clone --branch gareth https://github.com/GarethMenezes/MarketWorld.git
cd "MarketWorld/market worlds"
python3 -m http.server 4173 --directory dist
```

Open [localhost:4173](http://localhost:4173) in a modern browser with WebGL 2 support. This runs on your own computer; keep the terminal open while using it. No API key or build step is needed.

## How it was built

The demo adapts [Julien Sulpis' realtime planet shader](https://github.com/jsulpis/realtime-planet-shader) for the surface, ocean, clouds and atmosphere, uses [Planet3D](https://github.com/Ishanoshada/Planet3D) for satellite motion, and draws on [TerraForge3D](https://github.com/Jaysmito101/TerraForge3D) for volcano shapes. JavaScript connects the visuals to the dated timeline. Original source snapshots and version details are kept in `vendor/`.

The project includes a downloadable source archive and tests. Licensed under [GPL-3.0](LICENSE), with the original Planet3D MIT notice retained. See [third-party notices](NOTICES.md) for credits and licences.
