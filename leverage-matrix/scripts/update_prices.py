#!/usr/bin/env python3
"""Refresh end-of-day stock/ETP chart history for the static leverage matrix.

No API key needed. Yahoo Finance chart endpoints are unofficial and may rate-limit
or become unavailable. Never manufacture prices or approximate leveraged returns.
"""
from __future__ import annotations

import datetime as dt
import json
import math
import os
import pathlib
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

BASE = pathlib.Path(__file__).resolve().parents[1]
DEST = BASE / "data" / "prices.json"

US = {
    "MSTR", "MSTW", "MST", "MSTU", "MSTX", "MSTP", "MSTC", "MSTZ", "SMST",
    "COIN", "COIW", "CONL", "CONX", "COIA", "COIG", "COIX", "CONI",
    "GOOGL", "GOOG", "GOOW", "GGLL", "GOOX", "GOU", "GOOL", "GOGL", "GGLS",
    "NVDA", "NVDW", "NVDL", "NVDU", "NVDX", "NVDG", "NVDB", "NVC",
    "NVDD", "NVDS", "NVD", "NVDQ",
}
EU = {
    # Symbols are user-facing exchange tickers; data requests specify exchange suffixes.
    # A different currency/exchange variant must NOT be mislabeled as the USD listing.
    "3LMI": ["3LMI.L", "3LMI.MI"],
    "MST3": ["MST3.L", "MST3.DE", "MST3.F"],
    "MSTS": ["MSTS.L", "MSTS.DE", "MSTS.F"],
    "3SMI": ["3SMI.L", "3SMI.MI"],
    "CON3": ["CON3.L", "CON3.DE", "CON3.F"],
    "3LCO": ["3LCO.L", "3LCO.MI"],
    "CO3S": ["CO3S.L", "CO3S.DE"],
    "GOO3": ["GOO3.L", "GOO3.DE", "GOO3.F"],
    "3LAL": ["3LAL.L", "3LAL.MI"],
    "GG3S": ["GG3S.L", "GG3S.DE"],
    "3SAL": ["3SAL.L", "3SAL.MI"],
    "NVD3": ["NVD3.L", "NVD3.DE", "NVD3.F"],
    "3LNV": ["3LNV.L", "3LNV.MI"],
    "NV3S": ["NV3S.L", "NV3S.DE"],
    "3SNV": ["3SNV.L", "3SNV.MI"],
}
TICKERS = sorted(US | EU.keys())


def fetch_chart(symbol: str) -> dict:
    encoded = urllib.parse.quote(symbol, safe="")
    path = "/v8/finance/chart/" + encoded
    query = "?range=10y&interval=1d&includeAdjustedClose=true&events=div%2Csplits"
    errors = []
    for host in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
        url = "https://" + host + path + query
        req = urllib.request.Request(
            url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; MarketHistoryDashboard/1.0)",
                "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9",
            })
        try:
            with urllib.request.urlopen(req, timeout=22) as response:
                payload = json.load(response)
            chart = payload.get("chart") or {}
            result = (chart.get("result") or [None])[0]
            if not result:
                raise ValueError(str(chart.get("error") or "No chart result"))
            timestamps = result.get("timestamp") or []
            quote = (result.get("indicators", {}).get("quote") or [{}])[0]
            adj_quotes = result.get("indicators", {}).get("adjclose") or []
            close = quote.get("close") or []
            adjusted = adj_quotes[0].get("adjclose") if adj_quotes else []
            metadata = result.get("meta") or {}
            timezone_name = metadata.get("exchangeTimezoneName") or "UTC"
            try:
                tz = ZoneInfo(timezone_name)
            except Exception:
                tz = dt.timezone.utc
            daily = {}
            for i, t in enumerate(timestamps):
                c = close[i] if i < len(close) else None
                if not isinstance(c, (int, float)) or not math.isfinite(c) or c <= 0:
                    continue
                a = adjusted[i] if i < len(adjusted) else None
                if not isinstance(a, (int, float)) or not math.isfinite(a) or a <= 0:
                    a = c
                day = dt.datetime.fromtimestamp(int(t), tz).date().isoformat()
                daily[day] = [day, round(c, 8), round(a, 8)]
            bars = sorted(daily.values())
            if len(bars) < 2:
                raise ValueError("Too few valid history rows")
            return {
                "source_ticker": symbol,
                "exchange": metadata.get("exchangeName") or metadata.get("fullExchangeName") or "",
                "currency": metadata.get("currency") or "",
                "first_date": bars[0][0],
                "last_date": bars[-1][0],
                "bars": bars,
            }
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            errors.append(type(exc).__name__ + ": " + str(exc)[:100])
        time.sleep(0.25)
    raise RuntimeError("; ".join(errors)[:240])


def main():
    prev = {}
    if DEST.exists():
        try:
            with DEST.open(encoding="utf-8") as file:
                prev = json.load(file)
        except Exception:
            prev = {}
    symbols = dict(prev.get("symbols") or {})
    errors = {}
    new_count = 0
    for idx, ticker in enumerate(TICKERS, 1):
        candidates = EU.get(ticker, [ticker])
        why = []
        for candidate in candidates:
            try:
                rec = fetch_chart(candidate)
                symbols[ticker] = rec
                new_count += 1
                print(f"{idx:02d}/{len(TICKERS)} {ticker:<6} {candidate:<11} {len(rec['bars'])} daily bars through {rec['last_date']}", flush=True)
                break
            except Exception as exc:
                why.append(candidate + ": " + str(exc)[:110])
        else:
            errors[ticker] = "; ".join(why)[:240]
            print(f"{idx:02d}/{len(TICKERS)} {ticker:<6} unavailable (old data retained if present)", flush=True)
        time.sleep(0.7 + random.random() * 0.2)
    if new_count == 0:
        if symbols:
            print("No fresh data received; keeping previous file unchanged.", flush=True)
            return
        raise SystemExit("Could not load any real prices; will not publish fake results.")
    document = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "source": "Yahoo Finance chart API (unofficial, delayed)",
        "coverage_note": "Up to 10 years per symbol; not all symbols have usable quotes; European listings vary.",
        "successfully_refreshed": new_count,
        "symbols": symbols,
        "errors": errors,
    }
    DEST.parent.mkdir(parents=True, exist_ok=True)
    temp = DEST.with_suffix(".tmp")
    with temp.open("w", encoding="utf-8") as file:
        json.dump(document, file, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp, DEST)
    print(f"Saved {len(symbols)} histories ({new_count} fetched now, {len(errors)} errors).", flush=True)


if __name__ == "__main__":
    main()
