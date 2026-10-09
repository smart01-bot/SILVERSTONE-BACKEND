export class ApiError extends Error {
  constructor(status, code, message, fieldErrors = {}) {
    super(message);
    Object.assign(this, { status, code, fieldErrors });
  }
}
export const invalid = (message) => new ApiError(400, "INVALID_INPUT", message);
export const unauthenticated = () =>
  new ApiError(401, "INVALID_SESSION", "Please sign in again.");
export function allowFields(body, fields) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !fields.includes(key))
  ) {
    throw invalid("The request contains unsupported fields.");
  }
}
export const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
