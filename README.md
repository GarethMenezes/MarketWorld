# Market Worlds

DurHack 2026: 20 years of the US stock market as an explorable 3D planet. Sectors are continents, companies are mountains, fear is the weather, crashes are earthquakes, and correlation drives continental drift.

```bash
npm install
npm run dev          # open the printed localhost link, e.g. ?week=2008-10-10
```

AI explanations (optional; without a key a summary built from the data is shown):

```bash
pip install -r requirements.txt
set ANTHROPIC_API_KEY=...          # PowerShell: $env:ANTHROPIC_API_KEY="..."
uvicorn server.app:app --reload --port 8000
```

Rebuild data: `python build_world.py && python check_world.py`

For exploration and education, not financial advice. See CLAUDE.md for details.
