export interface SettingsWithWebhook {
  dailyTokenCap: number;
  dailyCostCapUsd: number;
  dailyTaskTarget: number;
  autoIdleMinutes: number;
  hardBudgetStop: boolean;
  alertWebhookUrl: string;
}

export interface PublicOfficeSettings extends Omit<SettingsWithWebhook, "alertWebhookUrl"> {
  alertWebhookUrl: "";
  alertWebhookConfigured: boolean;
}

/** Dashboard payload never includes the stored webhook URL. */
export function toPublicSettings(settings: SettingsWithWebhook): PublicOfficeSettings {
  return {
    dailyTokenCap: settings.dailyTokenCap,
    dailyCostCapUsd: settings.dailyCostCapUsd,
    dailyTaskTarget: settings.dailyTaskTarget,
    autoIdleMinutes: settings.autoIdleMinutes,
    hardBudgetStop: settings.hardBudgetStop,
    alertWebhookUrl: "",
    alertWebhookConfigured: settings.alertWebhookUrl.trim().length > 0,
  };
}

/**
 * Blank saves keep the stored URL. An explicit clear wipes it.
 * A non-empty submission is returned for the caller to validate.
 */
export function resolveAlertWebhookUpdate(
  current: string,
  body: { alertWebhookUrl?: unknown; clearAlertWebhook?: unknown }
): { kind: "keep" } | { kind: "clear" } | { kind: "replace"; url: string } {
  if (body.clearAlertWebhook === true) return { kind: "clear" };
  if (typeof body.alertWebhookUrl !== "string") return { kind: "keep" };
  const trimmed = body.alertWebhookUrl.trim();
  if (!trimmed) return { kind: "keep" };
  return { kind: "replace", url: trimmed };
}
