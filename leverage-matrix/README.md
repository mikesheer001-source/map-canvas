# Leverage Matrix

**Public dashboard:** https://mikesheer001-source.github.io/map-canvas/leverage-matrix/

The stock/leveraged-product matrix for Strategy (MSTR), Coinbase (COIN), Alphabet (GOOGL/GOOG) and NVIDIA (NVDA), across 1×, 1.2× weekly, variable 1.5–2× income, +2×, +3×, −1×, −1.5×, −2×, −3× exposure.

## How the site works

- Choose a time window: 1D, 5D, 1M, 3M, 6M, YTD, 1Y, 3Y, 5Y, MAX (up to 10 years of loaded data), or custom dates.
- Each fund displays its *actual historical* percentage return, **not** its stated leverage factor multiplied by the underlying stock's return.
- Choose **Adjusted return** (Yahoo adjusted closes, generally reflecting dividends/distributions and splits) or **Price return** (closing market prices, not cash distributions).
- Click any ticker for its actual sample dates, source listing, exchange, currency and price-history graph.
- A dash means missing data or inadequate history. The app never fabricates or proxies a return using another product.
- WeeklyPay funds distribute income and target 1.2× weekly performance, unlike conventional daily-reset funds. MST is an income strategy targeting variable 150–200% exposure, not fixed 1.5×.
- **3× products are European ETPs**, not U.S. exchange-traded funds. Percent returns use the listed instrument's currency; ETP trading denomination and trading dates can differ from the U.S. underlying.
- Price feed is unofficial Yahoo Finance daily history, and can be delayed, rate-limited, stale or unavailable. Adjusted closes are a *proxy* for distributions-reinvested total return, not guaranteed transaction-accurate total return. Check exchange/issuer price data before making investment decisions.

## Data generation

The [refresh workflow](../../.github/workflows/refresh-leverage-matrix.yml) runs several times daily and can be manually started in GitHub Actions. It executes [\`scripts/update_prices.py\`](scripts/update_prices.py) to fetch up to 10 years of closing and adjusted-closing prices for the listed tickers, then writes \`data/prices.json\` to the main branch.

- Data refresh is independent of page view; the site itself has no third-party API keys or sign-in.
- Failed symbols do not destroy their previously saved history.
- When the provider is unavailable, the site shows missing or stale data rather than guessed prices.
- To add a ticker, update both the HTML \`ROWS\` array and the Python data collector's \`US\` or \`EU\` map.
- The repo's existing Map Canvas site is unchanged. The dashboard is a self-contained folder within the already-published Pages repository.

**Not investment advice.** Daily-reset products and options-income ETFs have meaningful structural and distribution risks.
