import assert from 'node:assert/strict';import test from 'node:test';
import { validCheckoutKey,checkoutOwners,checkoutOwnerHash,checkoutRequestHash } from '../lib/checkout-recovery';
const key='12345678-1234-4234-8234-123456789abc';
test('recovery UUID keys are scoped to owner and normalized',()=>{assert.equal(validCheckoutKey(key),true);assert.equal(validCheckoutKey('order-id'),false);assert.equal(checkoutRequestHash(key),checkoutRequestHash(key.toUpperCase()));assert.notEqual(checkoutOwnerHash({userId:'a'},key),checkoutOwnerHash({sessionId:'a'},key));assert.deepEqual(checkoutOwners('a',key),[{userId:'a'},{sessionId:key}]);assert.deepEqual(checkoutOwners(undefined,'garbage'),[]);});
