/* global fetch */

const routes = {
  snapshot: "/api/staff-dashboard",
  reviewResponses: "/api/staff-dashboard/review-responses",
  evaluations: "/api/staff-dashboard/evaluations",
  replays: "/api/staff-dashboard/replays",
  reopens: "/api/staff-dashboard/reopens",
};

async function request(path, body) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `Staff dashboard request failed with ${response.status}`);
  }
  if (payload.adapterVersion !== "staff-dashboard-v1") {
    throw new Error("Staff dashboard adapter version is unsupported");
  }
  return payload;
}

export const staffDashboardAdapter = Object.freeze({
  loadDashboard: () => request(routes.snapshot),
  recordReviewResponse: (input) => request(routes.reviewResponses, input),
  recordEvaluation: (input) => request(routes.evaluations, input),
  createReplay: (input) => request(routes.replays, input),
  reopenAttempt: (input) => request(routes.reopens, input),
});
