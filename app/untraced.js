// Run background work (pollers, room seeding) with tracing suppressed.
// Dash0 showed ~4,300 spans in 30 minutes with almost no visitors: nearly all came
// from these loops calling the seat cluster every few seconds, burying the spans of
// real attendee requests. Metrics are unaffected.
const { context } = require('@opentelemetry/api');
const { suppressTracing } = require('@opentelemetry/core');

const untraced = (fn) => context.with(suppressTracing(context.active()), fn);

module.exports = { untraced };
