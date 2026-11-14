🌍 Market Worlds

Twenty years of real stock market data, turned into a planet you can explore.

Built at DurHack 2026 for the Marshall Wace "New Worlds" challenge.

Market Worlds: a calm market in 2007 next to the 2008 crisis, when the sea drains away

The idea

Markets are one of the most data-rich worlds humans have ever built, yet most people only ever see them as a line on a chart.

Market Worlds turns real market data into a living planet. Each sector is a continent, and each company is a mountain that grows with its stock. Market fear becomes the weather, and crashes become earthquakes. When sectors start moving together, the sea level falls and the shores dry out into salt flats, because in a crisis everything starts moving together.

Press play and watch the 2008 financial crisis, the COVID crash and the AI boom reshape the world.

How the data becomes a world

Every visual is driven by a real number. Nothing is decoration.

Market data	World feature
Sector (Tech, Energy, Finance, Healthcare, Consumer, Industrials)	A continent with its own colour and terrain
A company	A mountain on its continent
Growth since 2007	Mountain height
This week's return	Mountain colour: green up, red down
Market fear (VIX index)	Sky, atmosphere glow, clouds and lightning
A crash week	An earthquake
Correlation between sectors	Sea level (falls as sectors move together)
The key insight

In calm markets, sectors move independently and the sea sits at its normal level. In a crisis, almost everything falls at once and correlation jumps towards 1. On the planet, the sea drains and salt flats ring every coast in late 2008 and March 2020, then the water returns as markets recover.

That's why spreading your money across sectors stops protecting you exactly when you need it most. Market Worlds makes that visible in one glance.

Why it matters

Most people can't see market risk until it costs them. Market Worlds is a tool for understanding markets, not trading them:

Education: teach how markets behave in crashes, booms and recoveries.
Explaining risk: show clients why diversification can fail in a crisis.
Spotting stressed markets: rising fear and rising correlation are visible at a glance.
Training: replay 20 years of market history in minutes.
Features
🌐 3D planet built entirely from real market data, 2007 to today
⏯️ Time machine: play through history one week at a time, or jump to any week
⛈️ Weather driven by market fear, with lightning in crisis weeks
🌋 Earthquakes and volcanic eruptions in crash weeks
☄️ Meteor strikes on single shock days, leaving craters that fade over 12 weeks (click a crater for the day's fall)
🌊 Sea level driven by sector correlation
🖱️ Click any mountain to see its numbers
🤖 AI explorer's log: an LLM explains what happened to the stock or sector that week, using only the real numbers (falls back to a summary from the data)
🔎 Ask the planet: type a question like "When did banks crash?" and the planet flies to the answer (AI with a keyword fallback; no investment advice)
🧪 What if? stress test: shock one sector and see how the others would likely react in calm vs crisis times (simple linear model, works offline)
🔊 Soundscape generated from the data: drone, wind, waves, thunder, earthquakes and meteors (muted until you turn it on)
🗺️ Guided tours of major market events
Tech stack
Part	Tools
Data	Python, pandas, NumPy, yfinance
3D world	Three.js, Vite, JavaScript
AI explanations	FastAPI backend + LLM API
Run it yourself

You need Python 3.10+ and Node.js 20+.

bash
git clone https://github.com/GarethMenezes/MarketWorld.git
cd MarketWorld

# 1. Build the data (optional: public/world.json is already included)
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install yfinance pandas numpy
python build_world.py

# 2. Start the 3D world
npm install
npm run dev

Open the link it prints. To jump to a moment in history, add ?week= to the link, for example:

?week=2008-10-10: the worst week of the 2008 financial crisis
?week=2020-03-20: the COVID crash

AI explanations (optional):

bash
pip install fastapi uvicorn anthropic
export ANTHROPIC_API_KEY=your-key        # Windows: set ANTHROPIC_API_KEY=your-key
uvicorn server.app:app --port 8000

Without a key, the app still works and shows explanations built from the numbers.

How it works
build_world.py downloads ~20 years of daily prices for 30 large US stocks (5 per sector) and the VIX.
It calculates weekly growth, returns, volatility and the rolling correlation between sectors, and saves it all to public/world.json (about 1 MB).
main.js builds the planet with Three.js. Each week of data reshapes the mountains, weather and sea level.
When you click a mountain, the backend looks up that week's numbers and asks an LLM to explain them in plain English.
Limitations
Not financial advice. Market Worlds is for exploration and education.
Survivorship bias: the 30 stocks are large companies today, so the world looks rosier than the real market did.
Mountain height uses price growth, not company size, because free data sources don't include historical company sizes.
AI explanations are grounded in the data shown and say when the reason for a move isn't clear from the numbers.
Team
Gareth Menezes
Sota
License

See LICENSE.
