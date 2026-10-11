import { invalid, allowFields } from "./errors.js";
export function paymentEndpoint(value) {
  allowFields(value, ["networkCode", "identifierType", "identifier"]);
  if (
    !["vodacom", "airtel", "yas", "halotel"].includes(value.networkCode) ||
    !["phone", "agent", "till"].includes(value.identifierType) ||
    typeof value.identifier !== "string"
  )
    throw invalid("Choose a network and wallet, agent or till number.");
  let identifier = value.identifier.trim();
  if (value.identifierType === "phone") {
    identifier = identifier.replace(/[ ()-]/g, "");
    if (/^0[67]\d{8}$/.test(identifier))
      identifier = "+255" + identifier.slice(1);
    if (/^255[67]\d{8}$/.test(identifier)) identifier = "+" + identifier;
    if (!/^\+255[67]\d{8}$/.test(identifier))
      throw invalid("Enter a valid Tanzanian mobile wallet number.");
  } else if (!/^[A-Za-z0-9_-]{3,32}$/.test(identifier)) {
    throw invalid("Enter a valid agent or till identifier (3–32 characters).");
  }
  return {
    networkCode: value.networkCode,
    identifierType: value.identifierType,
    identifier,
  };
}
