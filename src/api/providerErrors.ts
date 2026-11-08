/** The native host can encode an upstream HTTP failure as an HTTP-200 SSE chunk. */
export function nativeStreamFailure(text: string): { message: string; status?: number } | null {
  if (!/^\s*\[API (?:错误|Error)\]/i.test(text)) return null;
  const status = Number(/\bstatus\s+(\d{3})\b/i.exec(text)?.[1]) || undefined;
  if (/quota|insufficient[_ ](?:quota|balance)|余额不足|额度.*(?:不足|用尽)/i.test(text)) {
    return { status, message: '副 API 渠道额度不足，请更换有额度的解析渠道或补充额度后重试' };
  }
  return { status, message: text.replace(/^\s*\[API (?:错误|Error)\]\s*/i, '')
    .replace(/https?:\/\/\S+/gi, '[endpoint]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 300) };
}

export function permanentCompletionFailure(error: unknown): boolean {
  const e = error as { status?: number; message?: string } | null;
  return [400, 401, 402, 403, 404].includes(e?.status ?? 0)
    || /quota exceeded|insufficient[_ ](?:quota|balance)|额度不足|余额不足|额度已用尽/i.test(e?.message ?? '');
}
