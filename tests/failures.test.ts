import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFailure, NewsletterFormatError } from '../src/failures.js';
test('controlled diagnostics classify provider errors without exposing secrets', () => {
  for (const error of [{code:401}, {response:{data:{error:'invalid_grant'}}}, new Error('invalid_grant')]) assert.equal(describeFailure(error).code,'auth_error');
  assert.equal(describeFailure({response:{status:403}}).retryable,false);
  for(const code of [429,503,'ETIMEDOUT','EAI_AGAIN']) assert.equal(describeFailure({code}).retryable,true);
  assert.equal(describeFailure(new NewsletterFormatError('secret')).code,'format_error');
  for(const error of [null, undefined, new Error('secret-token')]) {
    assert.equal(describeFailure(error).retryable,false);
    assert.doesNotMatch(describeFailure(error).message,/secret-token/);
  }
});
