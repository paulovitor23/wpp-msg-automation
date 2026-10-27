export class ConfigurationError extends Error {}
export class AuthorizationSetupError extends Error {}
export class NewsletterFormatError extends Error {}

// Only return controlled messages: provider errors may contain tokens and email bodies.
export function describeFailure(error: unknown) {
  if (error instanceof ConfigurationError) return { code: 'configuration_error', retryable: false, message: error.message };
  if (error instanceof AuthorizationSetupError) return { code: 'auth_error', retryable: false, message: error.message };
  const e = error as { code?: unknown; message?: string; response?: { status?: number; data?: { error?: unknown } } } | null;
  const status = e?.response?.status ?? Number(e?.code);
  const provider = e?.response?.data?.error;
  if (status === 401 || provider === 'invalid_grant' || e?.message === 'invalid_grant') {
    return { code: 'auth_error', retryable: false, message: 'Autorização expirada ou revogada. Execute npm run email:auth e reinicie o processo.' };
  }
  if (status === 403) return { code: 'permission_error', retryable: false, message: 'Acesso negado pelo Gmail. Confira permissões, API habilitada e limites no Google Cloud.' };
  if (error instanceof NewsletterFormatError) return { code: 'format_error', retryable: false, message: 'Formato/data inválido ou edições ambíguas. Confira com npm run gmail:preview.' };
  if (status === 429 || status >= 500 && status <= 599 || ['ETIMEDOUT','ECONNRESET','ENOTFOUND','EAI_AGAIN','ECONNREFUSED'].includes(String(e?.code))) {
    return { code: 'temporary_error', retryable: true, message: 'Falha temporária ao consultar o Gmail (rede ou limite do serviço).' };
  }
  return { code: 'error', retryable: false, message: 'Falha inesperada. Confira a configuração e execute npm run gmail:preview para diagnóstico.' };
}
