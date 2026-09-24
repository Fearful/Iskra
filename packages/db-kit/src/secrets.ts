/** Query parameters that carry secrets, such as libsql's `authToken` or `password`. */
export const SENSITIVE_URL_PARAM = /pass|token|secret|key|auth|credential|signature/i;
