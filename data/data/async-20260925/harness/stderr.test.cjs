const { test } = require('node:test');
const assert = require('node:assert/strict');
const { unexpected } = require('./stderr.cjs');

test('allows only the known AMD HDR capability probe', () => {
  const probe = '[38184:0923/113832.625:ERROR:ui\\gl\\direct_composition_support.cc:625] AMD VideoProcessorGetOutputExtension failed: 参数错误。 (0x80070057)';
  assert.equal(unexpected(probe + '\r\n'), '');
  assert.equal(unexpected(probe + '\r\nSandbox profile permission failure\r\n'), 'Sandbox profile permission failure');
  assert.equal(unexpected('Other GPU error\r\n'), 'Other GPU error');
});
