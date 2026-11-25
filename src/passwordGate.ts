export function renderOfficePasswordPage(errorMessage = ""): string {
  const errorHtml = errorMessage
    ? `<p id="office-password-error" style="margin:0 0 1rem;color:#fda4af;font-size:0.9rem">${errorMessage}</p>`
    : "";
  return `<!doctype html><html><body style="font-family:system-ui;background:#0a0e18;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0">
        <form method="POST" action="/auth" style="background:#121826;padding:2rem;border-radius:14px;border:1px solid #24304a;width:330px;box-shadow:0 20px 50px rgba(0,0,0,0.5)">
          <h2 style="margin:0 0 0.4rem">Grok Bot HQ</h2>
          <p style="margin:0 0 1.2rem;color:#8b9bb4;font-size:0.9rem">Enter your office password to unlock HQ.</p>
          ${errorHtml}
          <label for="office-password" style="display:block;margin:0 0 0.4rem;font-size:0.85rem">Office password</label>
          <input id="office-password" type="password" name="password" autocomplete="current-password" required autofocus style="width:100%;box-sizing:border-box;padding:0.7rem;border-radius:8px;border:1px solid #334155;background:#0a0e18;color:#fff;margin-bottom:1rem" />
          <button type="submit" style="width:100%;padding:0.7rem;border-radius:8px;border:none;background:#f59e0b;color:#1c1917;font-weight:700;cursor:pointer">Enter Office</button>
        </form>
      </body></html>`;
}
