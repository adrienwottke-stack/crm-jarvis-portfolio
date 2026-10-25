// Shared by both evaluation runtimes. Counting is separate from inference usage.
export async function prepareEvaluationCall({ input, usedTokens, maxTotalTokens, countInputTokens, signal }) {
  signal?.throwIfAborted();
  const fail=code=>Object.assign(new Error(code),{code});
  if (![usedTokens,maxTotalTokens,input.max_output_tokens].every(Number.isSafeInteger) || usedTokens<0 || maxTotalTokens<=0 || input.max_output_tokens<=0) throw fail('AI_EVALUATION_BUDGET');
  if (typeof countInputTokens!=='function') throw fail('AI_EVALUATION_TOKEN_COUNT');
  const inputTokens=await countInputTokens(input,{signal});
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(inputTokens)||inputTokens<0) throw fail('AI_EVALUATION_TOKEN_COUNT');
  // Retain margin for protocol differences and verify actual usage afterwards.
  const inputReservation=inputTokens+Math.max(256,Math.ceil(inputTokens*.02));
  const outputAllowance=Math.min(input.max_output_tokens,maxTotalTokens-usedTokens-inputReservation);
  if(outputAllowance<256)throw fail('AI_EVALUATION_BUDGET');
  input.max_output_tokens=outputAllowance;
  return { inputTokens,inputReservation,maxOutputTokens:outputAllowance };
}
