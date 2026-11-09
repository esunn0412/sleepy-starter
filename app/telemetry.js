// OpenTelemetry for kubeseat, exported to Dash0 over OTLP/HTTP.
// Load before anything else: node --require ./telemetry.js server.js
//
// Configured by the standard env vars, set in deploy/deployment.yaml from the
// app-credentials Secret: OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS,
// OTEL_SERVICE_NAME. Without an endpoint, telemetry stays off and the
// @opentelemetry/api calls in the app are no-ops.

module.exports.shutdown = async () => {};

// An unresolved "$(DASH0_ENDPOINT)" means the Secret key is missing.
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || '';
if (endpoint.startsWith('http')) {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-proto');
  const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
  const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
  const { UndiciInstrumentation } = require('@opentelemetry/instrumentation-undici');

  const sdk = new NodeSDK({
    // Traces: OTLP/HTTP from the OTEL_* env (the SDK default).
    // Metrics every 10 s, so seat changes show up in Dash0 quickly. This SDK takes
    // `metricReaders` (plural); the old singular `metricReader` is silently ignored,
    // which left us on the 60 s default.
    metricReaders: [new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: 10000,
    })],
    instrumentations: [
      // Incoming requests; probes are noise.
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url === '/healthz' || req.url === '/readyz',
      }),
      // fetch() calls to the seat cluster's kube-apiserver.
      new UndiciInstrumentation(),
    ],
  });
  sdk.start();
  console.log('telemetry: exporting traces and metrics over OTLP');
  // server.js awaits this on SIGTERM before exiting, so the last batch is flushed.
  module.exports.shutdown = () => sdk.shutdown().catch(() => {});
} else {
  console.log('telemetry: off (no OTEL_EXPORTER_OTLP_ENDPOINT)');
}
