type Metric = { count: number; totalMs: number; errors: number; statuses: Map<number, number> };
const metrics = new Map<string, Metric>();
const startedAt = Date.now();

function metricKey(method: string, path: string) {
  const normalized = path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,36}/gi, ":id").replace(/\b\d{2,}\b/g, ":id");
  return `${method.toUpperCase()} ${normalized}`;
}

export function recordRequest(method: string, path: string, statusCode: number, durationMs: number) {
  const key = metricKey(method, path);
  const current = metrics.get(key) ?? { count: 0, totalMs: 0, errors: 0, statuses: new Map<number, number>() };
  current.count += 1;
  current.totalMs += durationMs;
  if (statusCode >= 400) current.errors += 1;
  current.statuses.set(statusCode, (current.statuses.get(statusCode) ?? 0) + 1);
  metrics.set(key, current);
}

export function prometheusMetrics() {
  const lines = [
    "# HELP neuralbazaar_uptime_seconds API process uptime in seconds",
    "# TYPE neuralbazaar_uptime_seconds gauge",
    `neuralbazaar_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(3)}`,
    "# HELP neuralbazaar_http_requests_total HTTP requests by normalized route",
    "# TYPE neuralbazaar_http_requests_total counter",
    "# HELP neuralbazaar_http_request_duration_ms_total Sum of request durations by normalized route",
    "# TYPE neuralbazaar_http_request_duration_ms_total counter",
    "# HELP neuralbazaar_http_errors_total HTTP responses with status >= 400",
    "# TYPE neuralbazaar_http_errors_total counter"
  ];
  for (const [key, value] of metrics) {
    const [method, ...pathParts] = key.split(" ");
    const path = pathParts.join(" ").replace(/[^a-zA-Z0-9_:/.\-]/g, "_");
    const labels = `method="${method}",route="${path}"`;
    lines.push(`neuralbazaar_http_requests_total{${labels}} ${value.count}`);
    lines.push(`neuralbazaar_http_request_duration_ms_total{${labels}} ${value.totalMs.toFixed(3)}`);
    lines.push(`neuralbazaar_http_errors_total{${labels}} ${value.errors}`);
  }
  return `${lines.join("\n")}\n`;
}

