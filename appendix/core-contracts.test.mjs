import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composePermission, sameScope, observationEligibility, SessionPins, interventionKey,
  operationOutcome, mayScheduleNewLearning, mayAssertAbsenceInDeclaredScope,
} from '../checks/reference-build/core-contracts.js';

const scope = Object.freeze({ serverId:'srv-1', serverEpoch:'epoch-1', locationId:'loc-1',
  projectId:'proj-1', worktreeId:'wt-1', sessionId:'session-1', agentId:'agent-1' });
const current = Object.freeze({ scope, snapshotId:'snapshot-1', policyDigest:'digest-v12' });
const observation = Object.freeze({ ...current, id:'obs-1', status:'completed', requiredEvidence:'available' });
const rank = { allow:0, ask:1, deny:2 };

for (const native of ['allow','ask','deny']) {
  for (const decision of [ {kind:'abstain'}, {kind:'ask_permission',ruleId:'K1'}, {kind:'deny_by_rule',ruleId:'K2'} ]) {
    test(`permission never weakens ${native} with ${decision.kind}`,()=>{
      assert.ok(rank[composePermission(native,decision)] >= rank[native]);
      if (decision.kind==='abstain') assert.equal(composePermission(native,decision),native);
    });
  }
}
test('unknown permission value rejected, not mapped to allow',()=>{
  assert.throws(()=>composePermission('permit',{kind:'abstain'}),TypeError);
});
test('unknown kernel decision rejected',()=>{
  assert.throws(()=>composePermission('ask',{kind:'model_says_yes'}),TypeError);
});
test('rule-based decision requires a rule reference',()=>{
  assert.throws(()=>composePermission('allow',{kind:'ask_permission',ruleId:''}),TypeError);
});
test('identical observations are applicable, not thereby proved true',()=>{
  assert.deepEqual(observationEligibility(current,observation),{eligible:true});
});
for (const field of Object.keys(scope)) {
  test(`observation rejects different ${field}`,()=>{
    const changed={...observation,scope:{...scope,[field]:scope[field]+'-other'}};
    assert.equal(sameScope(scope,changed.scope),false);
    assert.deepEqual(observationEligibility(current,changed),{eligible:false,reason:'scope_mismatch'});
  });
}
test('stale snapshot rejected',()=>{
  assert.deepEqual(observationEligibility(current,{...observation,snapshotId:'snapshot-0'}),
    {eligible:false,reason:'stale_snapshot'});
});
test('candidate policy result cannot enter pinned session',()=>{
  assert.deepEqual(observationEligibility(current,{...observation,policyDigest:'digest-v13'}),
    {eligible:false,reason:'policy_mismatch'});
});
for (const status of ['cancelled','superseded','unavailable','invalid_response','budget_exhausted']) {
  test(`${status} result cannot be applied`,()=>{
    assert.deepEqual(observationEligibility(current,{...observation,status}),{eligible:false,reason:'not_completed'});
  });
}
for (const requiredEvidence of ['missing','unknown']) {
  test(`${requiredEvidence} required evidence defeats a completed observation`,()=>{
    assert.deepEqual(observationEligibility(current,{...observation,requiredEvidence}),
      {eligible:false,reason:'evidence_missing'});
  });
}
test('blank scope is rejected before storage or delivery',()=>{
  assert.throws(()=>sameScope({...scope,serverId:''},scope),TypeError);
});
test('existing session remains pinned after active pointer update',()=>{
  const pins=new SessionPins();
  assert.equal(pins.pin(scope,{id:'v12',digest:'digest-v12'}).policyId,'v12');
  assert.equal(pins.pin(scope,{id:'v13',digest:'digest-v13'}).policyId,'v12');
  assert.equal(pins.pin({...scope,sessionId:'session-2'},{id:'v13',digest:'digest-v13'}).policyId,'v13');
});
test('agents in the same session share a pin without changing observation scopes',()=>{
  const pins=new SessionPins(); pins.pin(scope,{id:'v12',digest:'digest-v12'});
  assert.equal(pins.pin({...scope,agentId:'agent-2'},{id:'v13',digest:'digest-v13'}).policyId,'v12');
  assert.equal(sameScope(scope,{...scope,agentId:'agent-2'}),false);
});
test('revocation is explicit and does not silently select a new policy',()=>{
  const pins=new SessionPins(); pins.pin(scope,{id:'v12',digest:'digest-v12'});
  pins.revokeDigest('digest-v12','data scope violation');
  const state=pins.read(scope); assert.equal(state.kind,'revoked');
  assert.equal(state.pin.policyId,'v12');
});
test('stored pin copies and freezes caller scope',()=>{
  const pins=new SessionPins(); const input={...scope}; const pin=pins.pin(input,{id:'v12',digest:'digest-v12'});
  input.locationId='changed'; assert.equal(pin.scope.locationId,'loc-1');
  assert.equal(Object.isFrozen(pin.scope),true);
});
test('unseen session remains missing',()=>{
  assert.deepEqual(new SessionPins().read(scope),{kind:'missing'});
});
test('intervention keys remain stable but vary by evidence or channel',()=>{
  const k=interventionKey(current,'F1','E1','context');
  assert.equal(k,interventionKey(current,'F1','E1','context'));
  assert.notEqual(k,interventionKey(current,'F1','E2','context'));
  assert.notEqual(k,interventionKey(current,'F1','E1','tui'));
});
test('key construction avoids delimiter-collision aliases',()=>{
  assert.notEqual(interventionKey(current,'F|A','B','context'),interventionKey(current,'F','A|B','context'));
});
test('interruption or missing result does not mean no side effect',()=>{
  assert.equal(operationOutcome({kind:'interrupted'}),'outcome_unknown');
  assert.equal(operationOutcome({kind:'missing_result'}),'outcome_unknown');
});
test('tool completion records operation, not task correctness',()=>{
  assert.equal(operationOutcome({kind:'tool_completed'}),'observed_completed');
  assert.equal(operationOutcome({kind:'tool_error'}),'observed_error');
});
test('only explicit pre-dispatch denial establishes denied-before-dispatch',()=>{
  assert.equal(operationOutcome({kind:'denied_before_dispatch'}),'denied_before_dispatch');
});
test('experiment and audit cannot recursively launch optimizer',()=>{
  assert.equal(mayScheduleNewLearning('main_work',true),true);
  for (const origin of ['warden','experiment','audit']) assert.equal(mayScheduleNewLearning(origin,true),false);
  assert.equal(mayScheduleNewLearning('main_work',false),false);
});
test('excerpt absence cannot become specification-wide absence',()=>{
  for(const inspectedScope of ['partial','unknown']) {
    assert.equal(mayAssertAbsenceInDeclaredScope({inspectedScope,hasMissingReference:false}),false);
  }
  assert.equal(mayAssertAbsenceInDeclaredScope({inspectedScope:'complete_declared_scope',hasMissingReference:true}),false);
  assert.equal(mayAssertAbsenceInDeclaredScope({inspectedScope:'complete_declared_scope',hasMissingReference:false}),true);
});
