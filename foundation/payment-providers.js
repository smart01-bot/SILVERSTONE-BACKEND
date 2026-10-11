// Add reviewed provider adapters here after contract/capability verification.
// No mock adapter, client URL, secret or live execution fallback is installed.
export const paymentProviders = Object.freeze({});
export function configuredProvider(providers, name) {
  const adapter = providers[name];
  return adapter &&
    [
      "supports",
      "collect",
      "payout",
      "lookup",
      "verifyWebhook",
      "balance",
    ].every((k) => typeof adapter[k] === "function")
    ? adapter
    : null;
}
