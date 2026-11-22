import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIP_TIERS,
  tierFromProductId,
  badgeInfo,
  mergeSupporterRecord,
  type SupporterRecord,
} from './supporter.ts';

describe('supporter badge & 3-tier IAP helpers', () => {
  it('defines three tip tiers with canonical product IDs', () => {
    assert.equal(TIP_TIERS.length, 3);
    assert.deepEqual(
      TIP_TIERS.map((t) => t.productId),
      [
        'app.xiaoyuan-note.tip.coffee',
        'app.xiaoyuan-note.tip.meal',
        'app.xiaoyuan-note.tip.feast',
      ],
    );
  });

  it('maps product IDs and tier keys to SupporterTier', () => {
    assert.equal(tierFromProductId('app.xiaoyuan-note.tip.coffee'), 'coffee');
    assert.equal(tierFromProductId('app.xiaoyuan-note.tip.meal'), 'meal');
    assert.equal(tierFromProductId('app.xiaoyuan-note.tip.feast'), 'feast');
    assert.equal(tierFromProductId('unknown.product'), null);
  });

  it('returns a single unified badge regardless of tier', () => {
    assert.deepEqual(badgeInfo(true, true), { icon: '✨', label: '支持者' });
    assert.deepEqual(badgeInfo(true, false), { icon: '✨', label: 'Supporter' });
    assert.equal(badgeInfo(false, true), null);
  });

  it('merges incoming purchases and activates unified supporter badge', () => {
    const empty: SupporterRecord = {
      active: false,
      purchasedIds: [],
      count: 0,
      updatedAt: 0,
    };

    const afterCoffee = mergeSupporterRecord(empty, ['app.xiaoyuan-note.tip.coffee'], true);
    assert.equal(afterCoffee.active, true);
    assert.equal(afterCoffee.count, 1);
    assert.deepEqual(afterCoffee.purchasedIds, ['app.xiaoyuan-note.tip.coffee']);

    const afterFeast = mergeSupporterRecord(afterCoffee, ['app.xiaoyuan-note.tip.feast'], true);
    assert.equal(afterFeast.active, true);
    assert.equal(afterFeast.count, 2);
    assert.deepEqual(afterFeast.purchasedIds, [
      'app.xiaoyuan-note.tip.coffee',
      'app.xiaoyuan-note.tip.feast',
    ]);
  });
});
