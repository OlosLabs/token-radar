import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ageBandPolicy, buildRadar, parseSnapshot } from '../lib/model.ts';
import { coverageFold, productionAblation } from '../lib/evidence.ts';
const snapshot = parseSnapshot(readFileSync(new URL('../../kit/token-radar-01-kit/input/snapshot.json', import.meta.url), 'utf8'));
const radar = buildRadar(snapshot);

test('all production row values, odds, ranges, verdicts and complete plans match reviewed v7', () => {
  const projection = radar.rows.map(x=>({slug:x.slug,rank:x.rank,implied:x.implied_value_usd,conditional:x.conditional_value_usd,odds:x.launch_odds,range:x.range,verdict:x.verdict,plan:x.plan,farm_steps:x.farm_steps}));
  assert.equal(createHash('sha256').update(JSON.stringify(projection)).digest('hex'), '1bddb10d43fff0af9c6b26499c7678174333dcf11b0d6124e5af83ff4ec59e58');
});

test('conditional-cap ablation compares fixed variants and reports mixed control honestly', () => {
  const a = radar.validation.production_ablation;
  assert.deepEqual([a.loo_n,a.train_n,a.split_n], [87,33,33]);
  assert.deepEqual(a.rows.map(r=>[r.loo.toFixed(3),r.split.toFixed(3)]), [['4.458','4.520'],['3.606','2.305'],['3.611','3.158'],['3.481','2.362'],['3.773','2.069'],['3.290','2.104'],['3.458','2.415']]);
  assert.deepEqual(productionAblation(radar.peers, radar.as_of), a);
});

test('outer targets cannot influence centers or factors, only scoring', () => {
  const [p,...train] = radar.peers;
  const [orig] = coverageFold(train,[p],radar.as_of, snapshot.protocols.filter(x=>x.slug!==p.slug));
  const [inside,outside] = coverageFold(train,[{...p,mcap_usd:orig.low},{...p,mcap_usd:orig.high+1}],radar.as_of, snapshot.protocols.filter(x=>x.slug!==p.slug));
  const geometry = x => [x.slug,x.conditional,x.odds,x.implied,x.factor,x.bucket,x.low,x.high];
  assert.deepEqual(geometry(inside),geometry(orig));
  assert.deepEqual(geometry(outside),geometry(orig));
  assert.equal(inside.hit,true);
  assert.equal(outside.hit,false);
});

test('age pooling and fallback match production thresholds; held-out counts reconcile', () => {
  const asOf = '2026-11-14';
  const at = d => ({listed_at:new Date(Date.parse(asOf)-d*86400000).toISOString().slice(0,10)});
  const peers = [...Array.from({length:4},()=>at(100)), ...Array.from({length:8},()=>at(220)), {listed_at:null}];
  const policy = ageBandPolicy(peers,asOf,peers.map((_,i)=>i/10),3);
  assert.equal(policy.age_bands[0].pooled_n,12);
  assert.equal(policy.age_bands.at(-1).global_fallback,true);
  assert.equal(policy.bandFor(null),3);
  assert.equal(policy.bandFor(-1),3);
  assert.equal(policy.bucketLabel(180),'180-365d');
  assert.equal(policy.bucketLabel(null),'Global fallback');
  const c = radar.validation.nested_coverage;
  assert.deepEqual([c.nominal,c.loo,c.split],[0.8,{n:87,hits:61},{n:33,hits:18}]);
  assert.deepEqual([c.conditional.loo,c.conditional.split],[{n:87,hits:66},{n:33,hits:23}]);
  for (const fold of ['loo','split']) for (const key of ['n','hits'])
    assert.equal(c.buckets.reduce((sum,r)=>sum+r[fold][key],0),c[fold][key]);
});
