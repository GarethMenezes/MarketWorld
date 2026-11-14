# 🌍 Market Worlds

Twenty years of real stock market data, turned into planets you can explore.

Built at DurHack 2026 for the Marshall Wace "New Worlds" challenge.

## The idea

Financial markets are among the most data-rich systems people have ever built, yet most of us only ever see them as a line on a chart.

Market Worlds turns that data into a living planet. Each sector is a continent and each company is a mountain that grows with its share price. Market fear becomes the weather, crash weeks shake the ground and set off volcanoes, and the sharpest single-day falls arrive as meteor strikes. When sectors start moving in step, the sea drains away and the coastlines dry out into salt flats.

There is one planet each for the US, the UK and Asia-Pacific. Press play and watch the 2008 financial crisis, the COVID crash and the AI boom reshape each world.

## How the data becomes a world

Every visual effect is driven by a real number.

| Market data | What you see |
| --- | --- |
| Sector (Technology, Financials, Energy, Healthcare, Consumer, Industrials) | A continent with its own shape and colour |
| A company | A mountain on its sector's continent |
| Share price growth since 2007 | Mountain height (log scale) |
| This week's return | A glowing ring at the mountain's foot: green for up, red for down |
| Market fear | Storm clouds, a red atmosphere, a dimmer sun and lightning |
| How closely sectors move together | Sea level: the water falls as correlation rises |
| A week when the market fell more than 7% | An earthquake, with volcanoes erupting on the two hardest-hit sectors |
| A single day with an extreme fall | A meteor strike that leaves a fading crater |

Market fear is the VIX index for the US. The UK and Asia have no freely available fear index, so their planets use the market's own realised volatility instead, which sits on a similar scale.

## The key insight

In calm markets, sectors move fairly independently and the sea sits at its normal level. In a crisis, almost everything falls at once and the correlation between sectors jumps towards 1. On the planet, the sea drains and salt flats appear around every coast in late 2008 and March 2020, then the water returns as markets recover.

This is why spreading your money across sectors stops protecting you exactly when you need it most. Market Worlds makes that visible at a glance.

## Why it matters

Most people can't see market risk until it costs them. Market Worlds is a tool for understanding markets, not for trading them. It can be used for:

- **Education:** showing how markets behave in crashes, booms and recoveries.
- **Explaining risk:** showing clients why diversification can fail in a crisis.
- **Spotting stressed markets:** rising fear and rising correlation are visible straight away.
- **Training:** replaying twenty years of market history in a few minutes.

## Features

- 🌐 **A 3D planet built from real market data**, January 2007 to November 2026.
- 🪐 **One planet per market.** Switch between the US, UK and Asia-Pacific (the same six sectors and 30 large companies each). The other two markets float beside the planet as small live worlds for the same week; click one to travel there.
- ⏯️ **A time machine.** Play through history week by week, drag the timeline, or jump to any date.
- 🗺️ **Guided tours.** The US tour has twelve stops with sourced notes on each event. The UK and Asia tours are generated from each market's own data.
- 🔎 **Ask the planet.** Type a question such as "When did banks crash?", "Tell me about Apple", "What happened in 2016?" or "Brexit", and the planet flies to the answer. Example questions appear when you click the search box. With an API key an AI answers free-form questions; without one, a built-in matcher handles companies, sectors, years, dates and about fifteen named events. It does not give investment advice.
- 🤖 **Explanations.** Click a mountain or a continent to see its numbers for that week, with a short explanation written by an AI from those numbers only, or a summary built from the data when no AI is available.
- 🧪 **What if?** Shock one sector (for example, Energy −30%) and see how the others would probably react, in calm conditions and in a crisis. It uses a simple linear model from historical data and works offline.
- ☄️ **Meteor strikes** on shock days. Click a crater to see the date and the size of the fall.
- 🔊 **A soundscape generated from the data:** a drone, wind, waves, thunder, earthquakes and meteors. It is muted until you turn it on.

## Tech stack

| Part | Tools |
| --- | --- |
| Data | Python, pandas, NumPy, yfinance (Yahoo Finance) |
| 3D world | Three.js, a custom GLSL planet shader, Vite, plain JavaScript |
| Sound | Web Audio API (every sound is generated in code) |
| AI | FastAPI backend with the Anthropic Claude API (optional) |

## Run it yourself

You need Node.js 18 or later. Python 3.10 or later is only needed to rebuild the data or run the AI backend.

```bash
git clone https://github.com/GarethMenezes/MarketWorld.git
cd MarketWorld
npm install
npm run dev
```

Open the link it prints. All the market data is already in `public/`, so the planet works offline.

You can open a particular market and week by adding to the link:

- `?week=2008-10-10`: the worst week of the 2008 financial crisis
- `?week=2020-03-20`: the COVID crash
- `?market=uk` or `?market=asia`: the UK or Asia-Pacific planet (combine with `&week=`)

### AI explanations (optional)

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
export ANTHROPIC_API_KEY=your-key  # Windows PowerShell: $env:ANTHROPIC_API_KEY="your-key"
uvicorn server.app:app --port 8000
```

The key stays on the backend and is never sent to the browser. Without a key, everything still works and the explanations are built from the numbers.

### Rebuilding the data (optional)

```bash
python build_world.py --market all   # or --market us | uk | asia; add --cached to skip the download
npm test                             # checks the models and the generated data
```

## How it works

1. `build_world.py` downloads about twenty years of daily prices for 30 large companies per market (five per sector), plus the VIX for the US.
2. For each market it calculates weekly growth, returns, volatility, trading volume, the rolling correlation between sectors, the extreme-fall days used for meteors, the calm-versus-crisis figures used by "What if?", and (for the UK and Asia) a tour. These are saved as JSON files in `public/`, about 1 MB per market.
3. `main.js` builds the planet with Three.js. A ray-traced shader draws the oceans, terrain, clouds, atmosphere and volcanoes, and each week of data reshapes the mountains, the weather and the sea level.
4. When you click a mountain or ask a question, the backend looks up the real numbers for that week itself, asks the AI to explain them in plain English, and checks the answer against the data. If the AI is unavailable, the app answers from the data instead.

## Limitations

- **Not financial advice.** Market Worlds is for exploration and education.
- **These are hand-picked groups of companies, not official market indexes.** Each planet shows 30 large companies chosen because they have price history back to 2007.
- **Survivorship bias.** The companies are large today, so the planets look rosier than the real markets did. Firms that collapsed, such as Lehman Brothers, are not included.
- **Mountain height uses share price growth, not company size,** because free data sources don't include historical market capitalisation.
- **UK and Asia fear is realised volatility, not an index like the VIX.** Asian returns are in each stock's local currency.
- **The sea level is a visual scale for correlation,** not a physical height.
- **"What if?" is a simple linear model,** not a prediction.
- **AI explanations only use the numbers shown,** and they say so when the data doesn't explain why something moved.

## Credits

- The planet shader is adapted from Julien Sulpis's [realtime planet shader](https://github.com/jsulpis/realtime-planet-shader) (GPL-3.0), via Gareth Menezes's adaptation.
- The volcano shape comes from [TerraForge3D](https://github.com/Jaysmito101/TerraForge3D) (MIT).
- The ocean colours and reference coastline come from [Sea Level Explorer](https://github.com/archimedix/sea-level-explorer) (MIT).
- The atmosphere and water lighting are adapted from the [Three.js](https://github.com/mrdoob/three.js) Sky and Water examples (MIT).
- Market data comes from Yahoo Finance via yfinance.

Full details are in [NOTICES.md](NOTICES.md).

## Team

- Gareth Menezes
- Sota

## Licence

See [LICENSE](LICENSE). The planet shader (`shaders/planet.frag.glsl`) is GPL-3.0, so any distributed build that includes it is covered by GPL-3.0. See [NOTICES.md](NOTICES.md).
