---
name: weather
description: "Get current weather, rain, temperature, and forecasts for locations or travel planning."
argument-hint: "[city-name]"
allowed-tools: Bash
---

Get the weather for $ARGUMENTS. Run the appropriate curl command below and present the results.

## Current Weather

```bash
curl -s "wttr.in/$ARGUMENTS?format=%l:+%c+%t+(feels+like+%f),+%w+wind,+%h+humidity"
```

## 3-Day Forecast

```bash
curl -s "wttr.in/$ARGUMENTS"
```

## Week Forecast

```bash
curl -s "wttr.in/$ARGUMENTS?format=v2"
```

## Format Codes Reference

| Code | Meaning |
|------|---------|
| `%c` | Weather condition emoji |
| `%t` | Temperature |
| `%f` | "Feels like" |
| `%w` | Wind |
| `%h` | Humidity |
| `%p` | Precipitation |
| `%l` | Location |
