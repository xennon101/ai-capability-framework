let snapshot;
let selectedCapabilityId;

const views = document.querySelectorAll(".view");
const navButtons = document.querySelectorAll(".nav");
const notice = document.querySelector("#notice");

navButtons.forEach((button) => {
  button.addEventListener("click", () => {
    navButtons.forEach((entry) => entry.classList.remove("active"));
    views.forEach((entry) => entry.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(`#${button.dataset.view}`).classList.add("active");
  });
});

document
  .querySelector("#capabilityFilter")
  .addEventListener("input", () => renderCatalogue());
document.querySelector("#exportEvidence").addEventListener("click", exportEvidence);
document
  .querySelector("#createGlobalKillSwitch")
  .addEventListener("click", createGlobalKillSwitch);

await refresh();

async function refresh() {
  snapshot = await api("/api/aicf/evidence/export", {
    includeConformance: true,
    includeReplayIndex: true
  });
  const capabilities = await api("/api/aicf/capabilities");
  snapshot.capabilities = capabilities;
  selectedCapabilityId ??= capabilities[0]?.id;
  render();
}

function render() {
  renderCatalogue();
  renderStatus();
  renderLedger();
  renderApprovals();
  renderControls();
  renderReplay();
}

function renderCatalogue() {
  const filter = document.querySelector("#capabilityFilter").value.toLowerCase();
  const rows = document.querySelector("#capabilityRows");
  rows.innerHTML = "";
  for (const capability of snapshot.capabilities.filter((entry) =>
    entry.id.toLowerCase().includes(filter)
  )) {
    const row = document.createElement("tr");
    row.dataset.capabilityId = capability.id;
    row.innerHTML = `
      <td>${escapeHtml(capability.id)}</td>
      <td>${escapeHtml(capability.capabilityType)}</td>
      <td class="risk-${escapeHtml(capability.riskTier)}">${escapeHtml(capability.riskTier)}</td>
      <td>${escapeHtml(capability.status)}</td>
    `;
    row.addEventListener("click", async () => {
      selectedCapabilityId = capability.id;
      await renderCapabilityDetail();
    });
    rows.append(row);
  }
  void renderCapabilityDetail();
}

async function renderCapabilityDetail() {
  const detailPanel = document.querySelector("#capabilityDetail");
  if (!selectedCapabilityId) {
    detailPanel.textContent = "No capability selected.";
    return;
  }
  const detail = await api(
    `/api/aicf/capabilities/${encodeURIComponent(selectedCapabilityId)}`
  );
  detailPanel.innerHTML = `
    <h3>${escapeHtml(detail.id)}</h3>
    <p>${escapeHtml(detail.description)}</p>
    <p><strong>Lifecycle:</strong> ${Object.entries(detail.lifecycle)
      .filter(([, value]) => value === true || typeof value === "string")
      .map(([key, value]) => `${escapeHtml(key)}=${escapeHtml(String(value))}`)
      .join(", ")}</p>
    <p><strong>Risk:</strong> declared ${escapeHtml(detail.risk.declaredRiskTier)}, inferred ${escapeHtml(detail.risk.inferredMinimumRiskTier)}</p>
    <p><strong>Input fields:</strong> ${detail.inputProperties.map((name) => `<span class="pill">${escapeHtml(name)}</span>`).join("") || "none"}</p>
    <p><strong>Related evals:</strong> ${detail.relatedEvalIds.map((id) => `<span class="pill">${escapeHtml(id)}</span>`).join("") || "none"}</p>
    <p><strong>Controls:</strong> <span class="status-${escapeHtml(detail.controls.status)}">${escapeHtml(detail.controls.status)}</span></p>
    <p><strong>Impact gaps:</strong> ${detail.impact.missingCoverage.length}</p>
  `;
}

function renderStatus() {
  document.querySelector("#evalStatus").innerHTML = `
    <h3>Eval Coverage</h3>
    <p>${snapshot.evals.summary.capabilitiesWithEvalCoverage}/${snapshot.evals.summary.totalCapabilities} capabilities have manifest-linked evals.</p>
    <p>${snapshot.evals.summary.evals} eval manifests loaded.</p>
  `;
  document.querySelector("#conformanceStatus").innerHTML = `
    <h3>Provider Conformance</h3>
    <p>${escapeHtml(snapshot.conformance.status)}</p>
    <p>${snapshot.conformance.summary.passed} passed, ${snapshot.conformance.summary.failed} failed across ${snapshot.conformance.summary.providers} provider target(s).</p>
  `;
  const highRisk = snapshot.capabilities.filter((capability) =>
    ["high", "critical"].includes(capability.riskTier)
  );
  document.querySelector("#riskStatus").innerHTML = `
    <h3>Risk Posture</h3>
    <p>${highRisk.length} high or critical capability(ies).</p>
    <p>Commit capabilities are summarized but not model-exposed by AICF provider exports.</p>
  `;
}

function renderLedger() {
  const rows = document.querySelector("#decisionRows");
  rows.innerHTML = "";
  for (const decision of snapshot.decisions) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${escapeHtml(decision.decisionId)}</td>
      <td>${escapeHtml(decision.capabilityId)}</td>
      <td>${escapeHtml(decision.operation)}</td>
      <td class="status-${escapeHtml(decision.decision)}">${escapeHtml(decision.decision)}</td>
    `;
    rows.append(row);
  }
}

function renderApprovals() {
  document.querySelector("#actionsList").innerHTML =
    snapshot.actions
      .map(
        (action) => `
    <div class="queue-item">
      <strong>${escapeHtml(action.actionId)}</strong><br>
      ${escapeHtml(action.capabilityId)} · <span class="status-${escapeHtml(action.actionState)}">${escapeHtml(action.actionState)}</span>
    </div>
  `
      )
      .join("") || "No actions.";

  document.querySelector("#approvalsList").innerHTML =
    snapshot.approvals
      .map(
        (approval) => `
    <div class="queue-item">
      <strong>${escapeHtml(approval.approvalRecordId)}</strong><br>
      ${escapeHtml(approval.capabilityId)} · <span class="status-${escapeHtml(approval.status)}">${escapeHtml(approval.status)}</span><br>
      <button data-approve="${escapeHtml(approval.approvalRecordId)}" type="button">Approve</button>
      <button data-reject="${escapeHtml(approval.approvalRecordId)}" type="button">Reject</button>
    </div>
  `
      )
      .join("") || "No approvals.";

  document.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () =>
      mutateApproval(button.dataset.approve, "approve")
    );
  });
  document.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () =>
      mutateApproval(button.dataset.reject, "reject")
    );
  });
}

function renderControls() {
  document.querySelector("#killSwitches").innerHTML = `
    <h3>Kill Switches</h3>
    ${snapshot.controls.killSwitches.map((killSwitch) => `<div class="queue-item">${escapeHtml(killSwitch.id)} · ${escapeHtml(killSwitch.mode)}<br>${escapeHtml(killSwitch.reason)}</div>`).join("") || "No kill switches."}
  `;
  document.querySelector("#budgets").innerHTML = `
    <h3>Budgets</h3>
    ${snapshot.controls.budgetPolicies.map((budget) => `<div class="queue-item">${escapeHtml(budget.id)} · tool calls ${budget.maxToolCallsPerRun ?? "unset"}</div>`).join("") || "No budget policies."}
  `;
  document.querySelector("#circuitBreakers").innerHTML = `
    <h3>Circuit Breakers</h3>
    ${snapshot.controls.circuitBreakerStates.map((state) => `<div class="queue-item">${escapeHtml(state.policyId)} · ${escapeHtml(state.status)}</div>`).join("") || "No circuit breaker state."}
  `;
}

function renderReplay() {
  document.querySelector("#replayList").innerHTML =
    (snapshot.replays ?? [])
      .map(
        (trace) => `
    <div>
      <strong>${escapeHtml(trace.traceId)}</strong><br>
      ${escapeHtml(trace.provider ?? "unknown provider")} · ${escapeHtml(trace.redactionMode)} · ${trace.capabilityIds.map((id) => `<span class="pill">${escapeHtml(id)}</span>`).join("")}
    </div>
  `
      )
      .join("") || "No replay metadata.";
}

async function mutateApproval(id, action) {
  await api(`/api/aicf/approvals/${encodeURIComponent(id)}/${action}`, {
    reason: `Synthetic ${action} from local reference UI.`
  });
  showNotice(`Approval ${action} recorded.`);
  await refresh();
}

async function createGlobalKillSwitch() {
  await api("/api/aicf/controls/kill-switches", {
    mode: "read_only",
    reason: "Synthetic local read-only pause.",
    scope: {
      type: "global"
    }
  });
  showNotice("Global read-only kill switch created.");
  await refresh();
}

async function exportEvidence() {
  const evidence = await api("/api/aicf/evidence/export", {
    includeConformance: true,
    includeReplayIndex: true
  });
  document.querySelector("#evidenceOutput").textContent = JSON.stringify(
    evidence,
    null,
    2
  );
  document.querySelector('[data-view="evidence"]').click();
}

async function api(path, body) {
  const response = await fetch(path, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers:
      body === undefined
        ? undefined
        : {
            "content-type": "application/json"
          },
    method: body === undefined ? "GET" : "POST"
  });
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error?.message ?? "AICF API request failed.");
  }
  return json;
}

function showNotice(message) {
  notice.textContent = message;
  notice.hidden = false;
  setTimeout(() => {
    notice.hidden = true;
  }, 3000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
