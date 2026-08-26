# Charts & summary statistics

Draw a histogram of one numeric variable, or compute summary statistics for
boxplots, scatterplots, bubble charts, and parallel coordinates plots. Works
on any kepler dataset **or** DuckDB table.

## When to use

Use this skill when the user wants to understand the distribution of, or
relationship between, numeric variables — without necessarily building a map
layer. Examples:
- "Show the distribution of income"
- "Are income and education correlated?"
- "Give me a boxplot of prices by category"
- "Plot population vs area, sized by density"
- "Compare these five variables at once"

Do NOT use this skill for:
- Map layer creation / styling → use the `kepler` skill.
- LISA clustering → use the `geoda-analysis` skill.
- Spatial filtering → use the `spatial-filter` skill.

## Commands at a glance

All five are called through `executeApi` with `apiName: "executeCommand"` —
the same dispatcher every other skill uses. See the `executeApi` tool
description for the envelope shape.

| commandId           | what it produces                                   | chart? |
| ------------------- | -------------------------------------------------- | :----: |
| `chart.histogram`   | frequency distribution of one numeric variable     |  yes   |
| `chart.boxplot`     | box-and-whisker plot for several variables         |  yes   |
| `chart.scatterplot` | correlation + min/max/mean for two variables       |  no   |
| `chart.bubble`      | x/y/size stats for three variables                 |  no   |
| `chart.pcp`         | min/max/mean/std per variable, many at once        |  no   |

## Picking a chart

- Distribution of **one** numeric variable → `chart.histogram`.
- Spread / outliers across **several** variables → `chart.boxplot`.
- Relationship between **two** variables → `chart.scatterplot`.
- Relationship between **three** variables → `chart.bubble`.
- **Many** variables compared at once → `chart.pcp`.

## Data source

Any kepler dataset or DuckDB table works. The commands read kepler first, then
fall back to DuckDB under both naming conventions (the verbatim name and
`tbl_<sanitized>`). If a variable isn't found, **confirm the name** via
`executeApi` `data.query` / `SHOW TABLES` (or `data.create-table` results)
rather than guessing.

## Honesty rule

- `chart.histogram` and `chart.boxplot` **draw a chart**, so do NOT restate the
  chart's contents in prose — a short summary of the shape is enough (for the
  boxplot, describe skew/spread/outliers, don't re-list every quartile).
- The other three (`chart.scatterplot`, `chart.bubble`, `chart.pcp`) return
  **numbers only, no chart**. Their statistics MUST appear in your reply, and
  you MUST NOT claim a chart was drawn. If you only see numbers back from a
  command, the user sees only your text.

## Workflow

1. Identify the dataset name and the numeric variable(s) the user is asking
   about. If unsure of a name, confirm it before calling.
2. Pick the command using the guide above.
3. Call it through `executeApi` with `commandId` and `input` containing
   `datasetName` and the variable name(s).
4. Report the results in prose:
   - For `chart.histogram`, describe the distribution shape (skew, modes,
     range) — the chart itself shows the bin counts.
   - For `chart.boxplot`, describe the shape (skew, spread, outliers) — the
     chart shows the boxes, whiskers, raw points, and means.
   - For the three stats-only commands (`chart.scatterplot`, `chart.bubble`,
     `chart.pcp`), restate the returned numbers (correlation, means, etc.)
     since no chart is rendered.

### Example: histogram

```json
{
  "call": {
    "apiName": "executeCommand",
    "args": {
      "commandId": "chart.histogram",
      "input": {
        "datasetName": "county_unemployment",
        "variableName": "unemployment_rate",
        "numberOfBins": 10
      }
    }
  },
  "reasoning": "Drawing a histogram of unemployment rate."
}
```

### Example: scatterplot

```json
{
  "call": {
    "apiName": "executeCommand",
    "args": {
      "commandId": "chart.scatterplot",
      "input": {
        "datasetName": "county_unemployment",
        "xVariableName": "income",
        "yVariableName": "unemployment_rate"
      }
    }
  },
  "reasoning": "Checking correlation between income and unemployment."
}
```

## Self-check (before your final message)

- If you called `chart.scatterplot`, `chart.bubble`, or `chart.pcp`, your reply
  must contain their numeric results. If it doesn't, add them.
- If you called `chart.histogram` or `chart.boxplot`, do not re-state the
  chart's contents in prose; a short shape summary is enough.
- Never claim a chart was drawn for `chart.scatterplot`, `chart.bubble`, or
  `chart.pcp` — they return numbers only.