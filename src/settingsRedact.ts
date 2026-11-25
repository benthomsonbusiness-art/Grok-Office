/** Dashboard copy of office settings. The stored webhook URL stays in SQLite. */
export function redactAlertWebhook<T extends { alertWebhookUrl: string }>(
  settings: T
): Omit<T, "alertWebhookUrl"> & { alertWebhookUrl: ""; alertWebhookConfigured: boolean } {
  const configured = Boolean(settings.alertWebhookUrl.trim());
  return {
    ...settings,
    alertWebhookUrl: "",
    alertWebhookConfigured: configured,
  };
}
