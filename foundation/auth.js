import { randomBytes, randomUUID, createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { ApiError, unauthenticated } from "./errors.js";
import { findAgent, agentDTO } from "./models.js";

const issuer = "silverstone-api";
const audience = "silverstone-mobile";
const hash = (token) => createHash("sha256").update(token).digest("hex");
const options = { algorithm: "HS256", issuer, audience, expiresIn: "15m" };
export function authentication(db, secret) {
  if (typeof secret !== "string" || secret.length < 32)
    throw new Error(
      "SILVERSTONE_JWT_SECRET must contain at least 32 characters.",
    );
  const access = (agentId, sid) =>
    jwt.sign({ sub: agentId, sid, purpose: "access" }, secret, options);
  async function session(agent) {
    const sid = randomUUID(),
      refreshToken = randomBytes(32).toString("base64url");
    await db.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO ss_v1.sessions(id,agent_id,expires_at) VALUES ($1,$2,now()+interval '7 days')",
        [sid, agent.id],
      );
      await tx.query(
        "INSERT INTO ss_v1.refresh_tokens(token_hash,session_id) VALUES ($1,$2)",
        [hash(refreshToken), sid],
      );
    });
    return {
      accessToken: access(agent.id, sid),
      refreshToken,
      agent: agentDTO(agent),
    };
  }
  async function refresh(token) {
    if (typeof token !== "string" || token.length > 200)
      throw unauthenticated();
    const result = await db.transaction(async (tx) => {
      const row = (
        await tx.query(
          `SELECT t.used_at, s.* FROM ss_v1.refresh_tokens t
        JOIN ss_v1.sessions s ON s.id=t.session_id WHERE t.token_hash=$1 FOR UPDATE OF s,t`,
          [hash(token)],
        )
      ).rows[0];
      if (!row || row.revoked_at || new Date(row.expires_at) <= new Date())
        return null;
      if (row.used_at) {
        await tx.query(
          "UPDATE ss_v1.sessions SET revoked_at=now() WHERE id=$1",
          [row.id],
        );
        return null; // Commit the replay revocation, then reject outside the transaction.
      }
      const agent = await findAgent(tx, row.agent_id);
      if (!agent || agent.account_status === "closed") return null;
      const refreshToken = randomBytes(32).toString("base64url");
      await tx.query(
        "UPDATE ss_v1.refresh_tokens SET used_at=now() WHERE token_hash=$1",
        [hash(token)],
      );
      await tx.query(
        "INSERT INTO ss_v1.refresh_tokens(token_hash,session_id) VALUES ($1,$2)",
        [hash(refreshToken), row.id],
      );
      return {
        accessToken: access(agent.id, row.id),
        refreshToken,
        agent: agentDTO(agent),
      };
    });
    if (!result) throw unauthenticated();
    return result;
  }
  async function authenticate(req, res, next) {
    try {
      const header = req.headers.authorization;
      if (!header?.startsWith("Bearer ")) throw unauthenticated();
      let claims;
      try {
        claims = jwt.verify(header.slice(7), secret, {
          algorithms: ["HS256"],
          issuer,
          audience,
        });
      } catch {
        throw unauthenticated();
      }
      if (
        claims.purpose !== "access" ||
        typeof claims.sub !== "string" ||
        typeof claims.sid !== "string"
      )
        throw unauthenticated();
      const session = (
        await db.query(
          "SELECT * FROM ss_v1.sessions WHERE id::text=$1 AND agent_id::text=$2 AND revoked_at IS NULL AND expires_at>now()",
          [claims.sid, claims.sub],
        )
      ).rows[0];
      if (!session) throw unauthenticated();
      const agent = await findAgent(db, session.agent_id);
      if (!agent || agent.account_status === "closed") throw unauthenticated();
      req.agent = agent;
      req.sessionId = session.id;
      next();
    } catch (error) {
      next(error);
    }
  }
  return { session, refresh, authenticate };
}
export function active(req, res, next) {
  if (
    req.agent.account_status !== "active" ||
    req.agent.application_status !== "approved"
  ) {
    return next(
      new ApiError(
        403,
        "ACCOUNT_RESTRICTED",
        "Your account is not approved for this action.",
      ),
    );
  }
  next();
}
export function mainAgent(req, res, next) {
  if (req.agent.role !== "main-agent")
    return next(
      new ApiError(
        403,
        "ROLE_REQUIRED",
        "This action requires an assigned main-agent.",
      ),
    );
  next();
}
export async function checkPassword(password, digest) {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password) <= 72 &&
    (await bcrypt.compare(password, digest))
  );
}
