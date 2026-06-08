type ExampleHandler = (
  args: Record<string, unknown>
) => Promise<Record<string, unknown>>;

export class ExampleHandlerRegistry {
  private readonly handlers = new Map<string, ExampleHandler>();

  register(capabilityId: string, handler: ExampleHandler) {
    if (this.handlers.has(capabilityId)) {
      throw new Error(`Duplicate handler for ${capabilityId}.`);
    }
    this.handlers.set(capabilityId, handler);
  }

  require(capabilityId: string): ExampleHandler {
    const handler = this.handlers.get(capabilityId);
    if (!handler) throw new Error(`No handler for ${capabilityId}.`);
    return handler;
  }
}
