type RequestOutcome = "success" | "client_error" | "server_error";

const durationBucketsMs = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000] as const;

type RequestMetricSeries = {
  count: number;
  sumMs: number;
  buckets: number[];
};

const requestCounts = new Map<string, number>();
const requestDurations = new Map<string, RequestMetricSeries>();

function statusClass(statusCode: number): string {
  if (statusCode >= 500) {
    return "5xx";
  }

  if (statusCode >= 400) {
    return "4xx";
  }

  return "2xx";
}

function outcomeFromStatus(statusCode: number): RequestOutcome {
  if (statusCode >= 500) {
    return "server_error";
  }

  if (statusCode >= 400) {
    return "client_error";
  }

  return "success";
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"');
}

function seriesKey(method: string, route: string): string {
  return `${method}|${route}`;
}

function countKey(method: string, route: string, statusClassValue: string, outcome: RequestOutcome): string {
  return `${method}|${route}|${statusClassValue}|${outcome}`;
}

export function recordRequestMetrics(input: {
  method: string;
  route: string;
  statusCode: number;
  durationMs: number;
}): void {
  const normalizedMethod = input.method.toUpperCase();
  const normalizedRoute = input.route;
  const statusClassValue = statusClass(input.statusCode);
  const outcome = outcomeFromStatus(input.statusCode);

  const countKeyValue = countKey(normalizedMethod, normalizedRoute, statusClassValue, outcome);
  requestCounts.set(countKeyValue, (requestCounts.get(countKeyValue) ?? 0) + 1);

  const key = seriesKey(normalizedMethod, normalizedRoute);
  const current = requestDurations.get(key) ?? {
    count: 0,
    sumMs: 0,
    buckets: new Array(durationBucketsMs.length + 1).fill(0)
  };

  current.count += 1;
  current.sumMs += input.durationMs;

  let bucketIndex = durationBucketsMs.findIndex((bucket) => input.durationMs <= bucket);
  if (bucketIndex === -1) {
    bucketIndex = durationBucketsMs.length;
  }

  for (let index = bucketIndex; index < current.buckets.length; index += 1) {
    current.buckets[index] += 1;
  }

  requestDurations.set(key, current);
}

export function renderRequestMetrics(): string {
  const lines: string[] = [];

  lines.push("# HELP streamforge_http_requests_total Total HTTP requests by status class and outcome");
  lines.push("# TYPE streamforge_http_requests_total counter");
  for (const [key, value] of requestCounts.entries()) {
    const [method = "", route = "", statusClassValue = "", outcome = "success"] = key.split("|");
    lines.push(`streamforge_http_requests_total{method="${escapeLabel(method)}",route="${escapeLabel(route)}",status_class="${escapeLabel(statusClassValue)}",outcome="${escapeLabel(outcome)}"} ${value}`);
  }

  lines.push("# HELP streamforge_http_request_duration_ms HTTP request duration in milliseconds");
  lines.push("# TYPE streamforge_http_request_duration_ms histogram");
  for (const [key, series] of requestDurations.entries()) {
    const [method = "", route = ""] = key.split("|");
    for (let index = 0; index < durationBucketsMs.length; index += 1) {
      lines.push(`streamforge_http_request_duration_ms_bucket{method="${escapeLabel(method)}",route="${escapeLabel(route)}",le="${durationBucketsMs[index]}"} ${series.buckets[index]}`);
    }

    lines.push(`streamforge_http_request_duration_ms_bucket{method="${escapeLabel(method)}",route="${escapeLabel(route)}",le="+Inf"} ${series.count}`);
    lines.push(`streamforge_http_request_duration_ms_sum{method="${escapeLabel(method)}",route="${escapeLabel(route)}"} ${series.sumMs.toFixed(3)}`);
    lines.push(`streamforge_http_request_duration_ms_count{method="${escapeLabel(method)}",route="${escapeLabel(route)}"} ${series.count}`);
  }

  return `${lines.join("\n")}\n`;
}
