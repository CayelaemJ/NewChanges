import { strict as assert } from "node:assert";
import { computeOptimiseScore, computeSubScores, DEFAULT_WEIGHTS } from "../src/services/scoreEngine.js";

const complete = {
  usersStartedJourney: 80,
  eligibleEmployees: 100,
  savingsUnlocked: 60,
  savingsAchievable: 100,
  platformUsersInArrears: 20,
  platformUsers: 100,
  wastefulCoverFixed: 30,
  wastefulCoverFound: 40,
  policiesObserved: 100,
};

assert.deepEqual(computeSubScores(complete), {
  engagement: 80,
  cashflow: 60,
  debtRisk: 80,
  insurance: 75,
});

const result = computeOptimiseScore(complete);
assert.equal(result.complete, true);
assert.equal(result.optimiseScore, 73);
assert.equal(result.rawScore, 73.0);
assert.deepEqual(result.weights, DEFAULT_WEIGHTS);
assert.deepEqual(result.missingDrivers, []);

const incomplete = computeOptimiseScore(complete, DEFAULT_WEIGHTS, {
  engagement: true,
  cashflow: false,
  debtRisk: true,
  insurance: true,
});
assert.equal(incomplete.complete, false);
assert.equal(incomplete.optimiseScore, null);
assert.equal(incomplete.rawScore, null);
assert.equal(incomplete.sub.cashflow, null);
assert.deepEqual(incomplete.missingDrivers, ["cashflow"]);

assert.equal(computeSubScores({ ...complete, platformUsers: 0 }).debtRisk, 0);
assert.equal(computeSubScores({ ...complete, wastefulCoverFound: 0, policiesObserved: 10 }).insurance, 100);
assert.throws(() => computeOptimiseScore(complete, { ENGAGEMENT: 0.2, CASHFLOW: 0.3, DEBT_RISK: 0.3, INSURANCE: 0.25 }));

console.log("score engine regression tests passed");
