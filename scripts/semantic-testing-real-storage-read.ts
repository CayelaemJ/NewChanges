// Run only with operator-approved Testing credentials and an already-existing
// synthetic object. GET only: zero database writes, uploads or deletions.
import { verifyExistingSemanticObjectRead } from "../src/services/semanticRealStorageRead.js";

verifyExistingSemanticObjectRead(process.env).then(proof=>{
  console.log(JSON.stringify({
    test:"real-existing-s3-test-object-read",verified:proof.verified,
    bytes:proof.bytes,sha256:proof.sha256,bucket:proof.bucket,
    readOnly:true,productionModified:false,
  }));
}).catch(error=>{
  console.error("Real Testing storage read verification failed:",error?.message??String(error));
  process.exitCode=1;
});
