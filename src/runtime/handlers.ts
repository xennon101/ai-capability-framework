import { AicfRuntimeError } from "./errors.js";
import type {
  AicfCapabilityHandler,
  ManifestRegistry
} from "./types.js";

export class AicfHandlerRegistry {
  private handlers = new Map<string, AicfCapabilityHandler>();
  private registry?: ManifestRegistry;

  constructor(options: {
    registry?: ManifestRegistry;
  } = {}) {
    this.registry = options.registry;
  }

  register(handler: AicfCapabilityHandler): void {
    if (this.handlers.has(handler.capabilityId)) {
      throw new AicfRuntimeError({
        code: "capability_not_available",
        safeMessage: `Handler for capability "${handler.capabilityId}" is already registered.`
      });
    }

    if (this.registry && !this.registry.capabilityById.has(handler.capabilityId)) {
      throw new AicfRuntimeError({
        code: "capability_not_found",
        safeMessage: `Handler capability "${handler.capabilityId}" is not present in the manifest registry.`
      });
    }

    this.handlers.set(handler.capabilityId, handler);
  }

  get(capabilityId: string): AicfCapabilityHandler | undefined {
    return this.handlers.get(capabilityId);
  }

  require(capabilityId: string): AicfCapabilityHandler {
    const handler = this.get(capabilityId);
    if (!handler) {
      throw new AicfRuntimeError({
        code: "handler_not_found",
        safeMessage: `No handler is registered for capability "${capabilityId}".`
      });
    }

    return handler;
  }

  list(): AicfCapabilityHandler[] {
    return [...this.handlers.values()];
  }
}
