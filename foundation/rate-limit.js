import { createClient } from "redis";

const WINDOW_SECONDS = 60;
const LUA_INCREMENT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

function redisOptions(env) {
  if (env.SILVERSTONE_REDIS_URL) return { url: env.SILVERSTONE_REDIS_URL };
  if (!env.REDIS_HOST) return null;
  const port = Number(env.REDIS_PORT || 6379);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("REDIS_PORT must be a valid TCP port.");
  return {
    username: env.REDIS_USERNAME || "default",
    password: env.REDIS_PASSWORD,
    socket: {
      host: env.REDIS_HOST,
      port,
      tls: true,
    },
  };
}

export async function connectRedisRateLimitStore(
  env = process.env,
  logger = console,
) {
  const options = redisOptions(env);
  if (!options) return { store: null, close: async () => {} };

  const client = createClient(options);
  client.on("error", (error) =>
    logger.warn?.(`Redis rate-limit store error: ${error.code || error.message}`),
  );
  try {
    await client.connect();
  } catch (error) {
    logger.warn?.(
      `Redis rate-limit store unavailable at startup; using process-local fallback: ${error.code || error.message}`,
    );
    if (client.isOpen) await client.close().catch(() => {});
    return { store: null, close: async () => {} };
  }

  return {
    store: {
      async hit(key) {
        const safeKey = `silverstone:rate-limit:${String(key).slice(0, 160)}`;
        return Number(
          await client.eval(LUA_INCREMENT, {
            keys: [safeKey],
            arguments: [String(WINDOW_SECONDS)],
          }),
        );
      },
    },
    close: async () => {
      if (client.isOpen) await client.close();
    },
  };
}

export function createRateLimitMiddleware({
  limit = 30,
  store = null,
  windowMs = WINDOW_SECONDS * 1000,
} = {}) {
  const local = new Map();

  function localHit(key) {
    const now = Date.now();
    for (const [entry, value] of local)
      if (value.until <= now) local.delete(entry);
    const value = local.get(key) || { count: 0, until: now + windowMs };
    value.count += 1;
    local.set(key, value);
    return value.count;
  }

  return async function rateLimit(req, res, next) {
    try {
      const key = req.ip || req.socket?.remoteAddress || "unknown";
      let count;
      if (store) {
        try {
          count = await store.hit(key);
        } catch {
          count = localHit(key);
        }
      } else {
        count = localHit(key);
      }
      if (count > limit) {
        res.set("Retry-After", String(Math.ceil(windowMs / 1000)));
        return res.status(429).json({
          error: {
            code: "RATE_LIMITED",
            message: "Too many attempts. Try again shortly.",
            fieldErrors: {},
            requestId: req.requestId,
          },
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
