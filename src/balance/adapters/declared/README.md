# Declared

Provider name: `declared`.

For agents that do not expose usage. Set `declared.weekly_reset` (for example `"sun 09:00"`)
and `declared.timezone` (for example `Asia/Jerusalem`) in `contributor.yml`. The check then
only knows the time to reset, not how much is used, and returns `contribute-until-limited`
inside the lead window.

## In a routine

Nothing reports what a run spent, so there is no daily cap. Stop at the first limit message
from the provider.
