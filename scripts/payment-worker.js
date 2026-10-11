import "dotenv/config";
import { setTimeout } from "node:timers/promises";
import { connectDatabase } from "../foundation/database.js";
import { runPaymentOnce, paymentSchema } from "../foundation/payments.js";
import { paymentProviders } from "../foundation/payment-providers.js";
const db = connectDatabase(
  process.env.SILVERSTONE_DATABASE_URL || process.env.DATABASE_URL,
  {
    allowRemote: process.env.SILVERSTONE_ALLOW_REMOTE_DATABASE === "true",
  },
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
  });
try {
  await paymentSchema(db);
  if (!Object.keys(paymentProviders).length)
    throw new Error(
      "No payment adapter configured. Worker will not execute payments.",
    );
  while (!stopping) {
    try {
      if (!(await runPaymentOnce(db, paymentProviders))) await setTimeout(1500);
    } catch {
      console.error(
        "Payment worker could not complete a cycle; durable claims retained.",
      );
      await setTimeout(5000);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
