// Bundled by Wrangler for a *private, isolated* Worker stage when a Hyperdrive
// binding exists. Do not deploy without separate DB credentials and release
// checks. The existing production DB is NOT used by the current Pages preview.
import {PrismaClient} from "@prisma/client";
import {PrismaPg} from "@prisma/adapter-pg";
import {createNativeAuthRouter} from "./native-auth-router.mjs";

export const nativeNewChangesWorker=createNativeAuthRouter({
  async openDatabase(env){
    if(!env.HYPERDRIVE?.connectionString)throw new Error("Hyperdrive binding required");
    const adapter=new PrismaPg({
      connectionString:env.HYPERDRIVE.connectionString,
      max:2,
      connectionTimeoutMillis:5000,
      idleTimeoutMillis:15000
    });
    return new PrismaClient({adapter});
  }
});
export default nativeNewChangesWorker;
