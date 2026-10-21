import assert from "node:assert/strict";
import { computeOptimiseScore, DEFAULT_WEIGHTS } from "../src/services/scoreEngine.js";

// Matches the isolated Testing fixture's one eligible, activated synthetic
// platform user, an unresolved arrears debt, unresolved wasteful cover and a
// controlled R500 monthly achievable target. Pure test: no Neon I/O.
const fixtureInputs = {
  usersStartedJourney:1,eligibleEmployees:1,
  savingsUnlocked:100,savingsAchievable:500,
  platformUsersInArrears:1,platformUsers:1,
  wastefulCoverFixed:0,wastefulCoverFound:1,policiesObserved:1,
};
const baseline=computeOptimiseScore(fixtureInputs,DEFAULT_WEIGHTS);
const corrected=computeOptimiseScore({...fixtureInputs,savingsUnlocked:300},DEFAULT_WEIGHTS);
assert(baseline.complete && corrected.complete,"Synthetic data must provide all score drivers");
assert.equal(baseline.optimiseScore,26,"Baseline synthetic score should not be perfect");
assert.equal(corrected.optimiseScore,38,"Synthetic monthly saving change must alter the wellness score");
assert.equal(corrected.optimiseScore!-baseline.optimiseScore!,12);
assert.equal(baseline.sub.cashflow,20);
assert.equal(corrected.sub.cashflow,60);
console.log("Synthetic fixture score delta prediction passed: 26 -> 38 (expected +12)");
