import { ApiError } from "./errors.js";

/**
 * @typedef {'unconfigured'|'synthetic_fixture'} ProviderMode
 * @typedef {{provider:null, mode:ProviderMode, executionEnabled:false,
 * callbackEnabled:false, manualSettlementEnabled:false, agentFloatSupport:'unverified',
 * providerFees:{status:'unknown',amountTzs:null}}} ProviderBoundary
 * No registry network, credential, environment flag or test fixture enables execution.
 * Concrete transport, callback authentication and status mapping require a reviewed adapter.
 */
/** @returns {ProviderBoundary} */
export function providerBoundary() {
  return {
    provider: null,
    mode: "unconfigured",
    executionEnabled: false,
    callbackEnabled: false,
    manualSettlementEnabled: false,
    agentFloatSupport: "unverified",
    providerFees: { status: "unknown", amountTzs: null },
  };
}
const disabled = async () => {
  throw new ApiError(
    503,
    "PROVIDER_UNCONFIGURED",
    "No approved provider is configured. Do not send funds.",
  );
};
/**
 * @typedef {{requestId:string,legId:string,reference:string,idempotencyKey:string,
 * amountTzs:string,currency:'TZS',networkCode:string,
 * fromAccountId:string,toAccountId:string}} AttemptTerms
 * @typedef {{provider:string,scope:string,eventKey:string,reference:string,
 * requestId:string,legId:string,amountTzs:string,currency:string,networkCode:string,
 * fromAccountId:string,toAccountId:string,
 * status:'acknowledged'|'confirmed'|'failed'|'unknown'|'reversed'}} NormalizedEvidence
 * @typedef {{capabilities:()=>ProviderBoundary,
 * collect:(terms:AttemptTerms)=>Promise<never>, payout:(terms:AttemptTerms)=>Promise<never>,
 * lookup:(terms:AttemptTerms)=>Promise<never>, reverse:(terms:AttemptTerms)=>Promise<never>,
 * verifyCallback:(input:unknown)=>Promise<never>}} DisabledAdapter
 * Fail-closed transport contract; no network calls or inferred provider guarantees.
 * Promise<never> is intentional: a concrete adapter needs a separately reviewed result contract.
 * @type {DisabledAdapter}
 */
export const disabledProvider = Object.freeze({
  capabilities: providerBoundary,
  collect: disabled,
  payout: disabled,
  lookup: disabled,
  reverse: disabled,
  verifyCallback: disabled,
});

// Read only, called AFTER request authorization. Never exposes inbox payloads/tokens.
export async function providerEvidenceDTO(db, requestId) {
  const { rows } = await db.query(
    `SELECT a.id,a.leg_id,a.reference,a.provider,a.scope,a.created_at,s.status
    FROM ss_v1.provider_attempts a JOIN ss_v1.provider_evidence_state s ON s.attempt_id=a.id
    WHERE a.request_id=$1 ORDER BY a.created_at,a.id`,
    [requestId],
  );
  return rows.map((a) => ({
    id: a.id,
    legId: a.leg_id,
    reference: a.reference,
    source: a.provider,
    scope: a.scope,
    evidenceStatus: a.status,
    actualSettlementVerified: false,
    reconciliationRequired: true,
    createdAt: new Date(a.created_at).toISOString(),
  }));
}
