// Application-owned planning fixtures; these are not additional manifests.
export const customerRequest =
  "Read ticket TCK-100 and prepare a refund for its order.";
export const plannedTasks = [
  {
    id: "read-ticket",
    text: "Read ticket TCK-100 for the refund review.",
    dependsOn: []
  },
  {
    id: "prepare-refund",
    text: "Prepare a refund case for the order from support ticket TCK-100.",
    dependsOn: ["read-ticket"]
  }
];
export const taskExpectations = {
  "read-ticket": {
    compatibleIds: ["support.ticket.get"],
    forbiddenIds: ["support.refund.commit_case"]
  },
  "prepare-refund": {
    compatibleIds: ["support.refund.prepare_case"],
    forbiddenIds: ["support.refund.commit_case"]
  }
};

/** Example application validation, deliberately separate from framework discovery. */
export function validatePlannedTasks(value) {
  if (!Array.isArray(value) || !value.length || value.length > 8)
    throw new Error("Invalid application task plan.");
  const known = new Set();
  return value.map((task) => {
    if (
      !task ||
      typeof task !== "object" ||
      Object.keys(task).some((key) => !["id", "text", "dependsOn"].includes(key)) ||
      typeof task.id !== "string" ||
      !task.id.trim() ||
      known.has(task.id) ||
      typeof task.text !== "string" ||
      !task.text.trim() ||
      task.text.length > 4000 ||
      !Array.isArray(task.dependsOn) ||
      task.dependsOn.some((id) => !known.has(id)) ||
      new Set(task.dependsOn).size !== task.dependsOn.length
    ) {
      throw new Error("Invalid application task plan.");
    }
    known.add(task.id);
    return { id: task.id, text: task.text, dependsOn: [...task.dependsOn] };
  });
}
