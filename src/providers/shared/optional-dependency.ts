import { AicfProviderError } from "./errors.js";
import type { LoadOptionalProviderDependencyOptions } from "./types.js";

export async function loadOptionalProviderDependency<T = unknown>(
  options: LoadOptionalProviderDependencyOptions
): Promise<T> {
  try {
    return await import(options.dependencyName) as T;
  } catch (error) {
    throw new AicfProviderError({
      code: "provider_dependency_missing",
      details: {
        dependencyName: options.dependencyName
      },
      message: error instanceof Error ? error.message : undefined,
      provider: options.provider,
      safeMessage: `Optional provider dependency "${options.dependencyName}" is not installed. Install it or pass a compatible host-owned client/factory.`
    });
  }
}
