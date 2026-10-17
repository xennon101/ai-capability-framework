import { createHash } from "node:crypto";
import { toOpenAIResponsesToolName } from "ai-capability-framework";
import { EXECUTION } from "./campaign.mjs";
import { createEvaluationClients } from "./clients.mjs";

// Deterministic integration doubles consume requests and exported tools, never evaluation labels.
function choose(text, ids) {
  if (
    /merge|consolidate|combine|reserve|allocate|hold|reschedule|rewrite|move|reassign|ownership reassignment|stock transfer|inter.warehouse|paired.*transfer|cancel|withdraw|overseas|chess|orchid|quasar/i.test(
      text
    )
  )
    return null;
  const intent = text.replace(
    /(?:do not|without|not a|rather than).*?(?:prepare|draft|refund|adjustment|invitation).*?(?:\.|$)/gi,
    ""
  );
  const domain = /ticket|refund|reimburse|support|acknowledge/i.test(intent)
    ? "support"
    : /stock|warehouse|sku|catalogue|product|freight|inventory|adjustment/i.test(intent)
      ? "inventory"
      : /usr|meeting|participant|calendar|availability|invite|invitation|appointment/i.test(
            intent
          )
        ? "scheduling"
        : null;
  if (!domain) return null;
  const prepare =
    /prepare|draft|proposal|preview|stage|quantity_delta|invitation/i.test(intent) &&
    !/^read|^inspect|^show|^retrieve/i.test(intent);
  const scope =
    domain === "support"
      ? prepare
        ? "refund"
        : /history|conversation|chronology|timeline|correspondence|exchanges|dated.*repl/i.test(
              intent
            )
          ? "activity"
          : "ticket"
      : domain === "inventory"
        ? prepare
          ? "adjustment"
          : /description|catalogue|dimension|measurement|carton/i.test(intent)
            ? "product"
            : "stock"
        : prepare
          ? "invite"
          : /booked|confirmed|appointments|collision|existing.*event/i.test(intent)
            ? "calendar"
            : "availability";
  return (
    ids.find(
      (id) =>
        id.includes(domain) &&
        id.includes(scope) &&
        (scope !== "ticket" || !id.includes("activity")) &&
        (prepare
          ? /prepare|preview|draft/.test(id)
          : !/prepare|preview|draft|commit|send/.test(id))
    ) ?? null
  );
}
const textOf = (input) =>
  typeof input === "string"
    ? input
    : (input ?? [])
        .map((item) =>
          typeof item.content === "string"
            ? item.content
            : (item.content ?? []).map((c) => c.text ?? "").join("\n")
        )
        .join("\n");
const output = (text, id) => ({
  id,
  model: EXECUTION.model,
  status: "completed",
  output_text: text,
  output: [
    { type: "message", role: "assistant", content: [{ type: "output_text", text }] }
  ],
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 0 }
  }
});

export function createMockHost({ ledger, responseOverride }) {
  let sequence = 0;
  const requests = [];
  const sdk = {
    responses: {
      inputTokens: {
        async count(body, options) {
          requests.push({ kind: "token_count", body, options });
          return { input_tokens: 500 };
        }
      },
      async create(body, options) {
        requests.push({ kind: "generation", body, options });
        const id = `response_mock_${++sequence}`;
        const overridden = await responseOverride?.(body, options);
        if (overridden) return overridden;
        if (body.text?.format?.name === "aicf_capability_selection_v1") {
          const user = body.input.find((message) => message.role === "user");
          const tasks = JSON.parse(user.content).tasks;
          return output(
            JSON.stringify({
              schema_version: "1.0",
              decisions: tasks.map((task) => {
                const selected = choose(
                  task.request,
                  task.candidates.map((card) => card.capabilityId)
                );
                return {
                  query_id: task.query_id,
                  decision: selected ? "select" : "abstain",
                  capability_id: selected,
                  reason_code: selected
                    ? "supported_candidate"
                    : "no_suitable_candidate"
                };
              })
            }),
            id
          );
        }
        if (body.text?.format?.name === "application_plan_v2") {
          const data = JSON.parse(textOf(body.input)),
            text = data.customerRequest;
          const split = text.match(/^(.*?)(?:,?\s+then|\s+and)\s+(prepare.*)$/i);
          const unsupported =
            /reassign|merge|consolidate|combine|reserve|allocate|hold|reschedule|rewrite|move|transfer|cancel|dispatch|delete/i.test(
              text
            );
          const task = (id, text, operation, dependsOn) => ({
            id,
            text,
            operation,
            requestedOutcome: text,
            dependsOn
          });
          return output(
            JSON.stringify({
              decision: unsupported ? "clarify" : "execute",
              requestedOutcome: text,
              tasks: unsupported
                ? []
                : split
                  ? [
                      task("read", split[1], "read", []),
                      task("prepare", split[2], "prepare", ["read"])
                    ]
                  : [
                      task(
                        "task",
                        text,
                        /^prepare|^draft/i.test(text) ? "prepare" : "read",
                        []
                      )
                    ]
            }),
            id
          );
        }
        if (body.text?.format?.name === "application_response_v2") {
          const state = JSON.parse(textOf(body.input)).verifiedApplicationState;
          const { renderResponse } = await import("./application.mjs");
          return output(JSON.stringify({ summary: renderResponse(state) }), id);
        }
        const lastTool = (body.input ?? [])
          .filter((item) => item.type === "function_call_output")
          .at(-1);
        if (lastTool)
          return output(
            `Authorized tool outcome: ${lastTool.output}. Prepared previews require approval.`,
            id
          );
        const full = textOf(body.input),
          text =
            full.match(
              /<untrusted_user_text>\s*([\s\S]*?)\s*<\/untrusted_user_text>/
            )?.[1] ?? full;
        const names = (body.tools ?? []).map((tool) => tool.name),
          selected = choose(text, names);
        if (!selected)
          return output(
            "Please clarify the request or obtain the required access.",
            id
          );
        const tool = body.tools.find((item) => item.name === selected);
        const factsMatch = full.match(/"example.request"\s*:\s*(\{[^}]+\})/);
        const facts = factsMatch
          ? JSON.parse(factsMatch[1])
          : {
              ticket_id: "TCK-100",
              order_id: "ORD-100",
              product_id: "SKU-100",
              warehouse_id: "WH-100",
              quantity_delta: 2,
              reason_code: "customer_request",
              participant_id: "USR-100",
              requested_date: "2030-06-10",
              attendee_email: "guest@example.com",
              duration_minutes: 30,
              topic: "Review"
            };
        const args = Object.fromEntries(
          Object.keys(tool.parameters.properties).map((key) => [
            key,
            facts[key] ?? null
          ])
        );
        const call = {
          type: "function_call",
          name: selected,
          call_id: `call_${sequence}`,
          arguments: JSON.stringify(args)
        };
        return { ...output("", id), output: [call] };
      }
    },
    embeddings: {
      async create(body, options) {
        requests.push({ kind: "embedding", body, options });
        return {
          model: EXECUTION.embeddingModel,
          data: body.input.map((text, index) => {
            const vector = Array(EXECUTION.dimensions).fill(0);
            for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
              vector[
                createHash("sha256").update(token).digest().readUInt16BE(0) %
                  vector.length
              ]++;
            if (!vector.some(Boolean)) vector[0] = 1;
            return { index, embedding: vector };
          }),
          usage: { prompt_tokens: 50, total_tokens: 50 }
        };
      }
    }
  };
  const host = createEvaluationClients({
    sdk,
    ledger,
    mock: true,
    tokenizer: (text) => Math.max(1, Math.ceil(text.length / 4)),
    tokenizerIdentity: "synthetic-token-count.v1",
    pricing: {
      inputPerMillion: 0,
      outputPerMillion: 0,
      embeddingPerMillion: 0,
      tokenCountPerRequest: 0,
      premiumMultiplier: 1
    }
  });
  return { ...host, requests, toToolName: toOpenAIResponsesToolName };
}
