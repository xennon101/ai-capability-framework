export type ExampleRuntimeSubject = {
  subjectRef: string;
  tenantRef: string;
  permissions: string[];
};

export function buildExampleRuntimeContext(input: {
  subject: ExampleRuntimeSubject;
  userText: string;
}) {
  if (!input.subject.subjectRef || !input.subject.tenantRef) {
    throw new Error("Missing required runtime subject context.");
  }
  return {
    subject: input.subject,
    userInput: {
      text: input.userText,
      trust: "user_input",
      instructionsAllowed: false
    }
  };
}
