---
title: "kubeseat: telemetry"
description: "New endpoints and seat changes stay observable in Dash0, without noise or high cardinality"
type: check
when: "PRs that add or change HTTP endpoints, seat logic, or telemetry code under app/"
actions: "Comment on each gap and suggest the fix"
---

# Telemetry

- New HTTP endpoints get an OpenTelemetry server span named by route template (`GET /api/attendees/:id`), never by raw path.
- Seat changes keep the `kubeseat.seat.time_to_seat` histogram and the waiting/used/capacity gauges correct; each seat is recorded once across replicas.
- Background loops (pollers, room seeding) run with tracing suppressed, via `suppressTracing` from `@opentelemetry/core` (the app wraps this as `untraced()` in `app/untraced.js`, added in PR #10), so traces show real requests.
- Metric attributes are low-cardinality: room, pool, talk, booleans. No attendee ids.
