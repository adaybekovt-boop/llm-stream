import type { ProviderMapper } from "../types.js";

export const cohereMapper: ProviderMapper = () => {
  throw new Error("provider 'cohere' not supported in 0.1.0");
};
