# deal-desk-switches

Public files Deal Desk reads from GitHub.

- **switches.json:** the remote on/off switches. `{"version": 1, "switches": {"<module>": false}}` turns a module off; a module missing from the file counts as on.
- **rates.json:** the last 12 months of the U.S. Treasury 10-year par yield, `{"version": 1, "source", "checkedAt", "tenYear": [["2026-11-17", 5.10], ...]}`, oldest first. Only the Treasury's official daily feed is used (home.treasury.gov, daily_treasury_yield_curve). The game's rate for a workday is the latest value dated before that day, plus 3.00 points.
- **The Update rates action** (`.github/workflows/rates.yml`, `scripts/update-rates.mjs`): runs on business days in the evening and early morning Eastern, and commits rates.json each time. If the feed can't be read it writes nothing and the run shows red; the app keeps its last good copy. Run it by hand from the Actions tab: Update rates → Run workflow.
