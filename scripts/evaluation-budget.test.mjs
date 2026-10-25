import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareEvaluationCall } from './evaluation-budget.mjs';
import { createCrmModelClient } from '../lib/ai-crm/model-client.ts';

test('a next call is rejected before inference instead of overshooting the total budget', async () => {
  const input={model:'gpt-5.6-luna',input:'same input',max_output_tokens:2400};
  await assert.rejects(prepareEvaluationCall({input,usedTokens:18000,maxTotalTokens:20000,countInputTokens:async()=>1900}),error=>error.code==='AI_EVALUATION_BUDGET');
  assert.equal(input.max_output_tokens,2400);
});
test('remaining output capacity is bounded without increasing the stipulated per-round cap', async () => {
  const input={model:'gpt-5.6-luna',input:'same input',max_output_tokens:2400};
  const proof=await prepareEvaluationCall({input,usedTokens:15000,maxTotalTokens:20000,countInputTokens:async()=>3000});
  assert.equal(proof.inputTokens,3000); assert.equal(input.max_output_tokens,1744);
  assert.equal(15000+proof.inputReservation+input.max_output_tokens,20000);
});
test('unavailable and invalid counts fail closed, and provider abort reaches the counting request', async () => {
  const input={model:'gpt-5.6-luna',input:'fixture',max_output_tokens:2400};
  for(const count of [undefined,NaN,-1,1.5])await assert.rejects(prepareEvaluationCall({input,usedTokens:0,maxTotalTokens:20000,countInputTokens:async()=>count}),error=>error.code==='AI_EVALUATION_TOKEN_COUNT');
  const controller=new AbortController();controller.abort();
  await assert.rejects(prepareEvaluationCall({input,usedTokens:0,maxTotalTokens:20000,countInputTokens:async()=>1,signal:controller.signal}),error=>error.name==='AbortError');
});
test('OpenAI counts the same instructions/tools/input and omits inference-only fields',async()=>{
  let actual;
  const client=createCrmModelClient('openai','fixture',1000,async(url,init)=>{
    actual={url:String(url),body:JSON.parse(init.body)};
    return new Response(JSON.stringify({object:'response.input_tokens',input_tokens:432}),{headers:{'content-type':'application/json'}});
  });
  const input={model:'gpt-5.6-luna',instructions:'source boundary',input:'selected contact',tools:[],parallel_tool_calls:false,tool_choice:'auto',max_output_tokens:2400,store:false};
  assert.equal(await client.responses.countInputTokens(input),432);
  assert.match(actual.url,/\/v1\/responses\/input_tokens$/);
  assert.equal(actual.body.instructions,input.instructions);assert.equal(actual.body.input,input.input);assert.deepEqual(actual.body.tools,[]);
  assert.equal(actual.body.max_output_tokens,undefined);assert.equal(actual.body.store,undefined);
});
test('Claude counts its actual adapter input without leaking provider errors',async()=>{
  let actual;
  const client=createCrmModelClient('anthropic','fixture',1000,async(url,init)=>{
    actual={url:String(url),body:JSON.parse(init.body)};
    return new Response(JSON.stringify({input_tokens:123}),{headers:{'content-type':'application/json'}});
  });
  assert.equal(await client.responses.countInputTokens({model:'claude-sonnet-5-5',instructions:'source boundary',input:'selected contact',tools:[],max_output_tokens:2400}),123);
  assert.match(actual.url,/\/v1\/messages\/count_tokens$/);assert.equal(actual.body.system,'source boundary');
  assert.deepEqual(actual.body.messages,[{role:'user',content:[{type:'text',text:'selected contact'}]}]);assert.equal(actual.body.max_tokens,undefined);
  const unavailable=createCrmModelClient('anthropic','fixture',1000,async()=>new Response('PRIVATE_PROMPT_SECRET',{status:429}));
  await assert.rejects(unavailable.responses.countInputTokens({model:'claude-sonnet-5-5',input:'fixture'}),error=>error.code==='AI_EVALUATION_TOKEN_COUNT'&&!error.message.includes('PRIVATE'));
});
