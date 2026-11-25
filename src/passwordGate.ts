export function officePasswordGateHtml(failed: boolean): string {
  const error = failed
    ? `<p id="office-password-error" class="gate-error" role="alert">That password didn't match. Try again.</p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Grok Bot HQ</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap" />
  <style>
    :root { color-scheme: dark; }
    body.gate-body {
      min-height: 100vh; margin: 0; display: grid; place-items: center;
      padding: 1rem; background: #07090e; color: #d7dee8;
      font-family: Inter, "Helvetica Neue", Arial, sans-serif;
    }
    .gate-card {
      width: min(100%, 24rem); background: #10141c; border: 1px solid rgba(168, 179, 196, 0.16);
      border-radius: 16px; box-shadow: 0 16px 40px rgba(7, 12, 20, 0.55); padding: 2rem;
    }
    .gate-card h1 {
      margin: 0 0 0.5rem; font-family: "Space Grotesk", Inter, sans-serif;
      font-size: 1.5rem; font-weight: 700; color: #f3f6fb; line-height: 1.2;
    }
    .gate-lead { margin: 0 0 1.5rem; color: #a8b3c4; font-size: 1rem; line-height: 1.5; max-width: 65ch; }
    .gate-form { display: flex; flex-direction: column; gap: 0.5rem; }
    .gate-form label { font-size: 0.875rem; font-weight: 600; color: #d7dee8; }
    .gate-form input {
      min-height: 44px; padding: 0.5rem 0.75rem; border-radius: 10px;
      border: 1px solid rgba(168, 179, 196, 0.16); background: #07090e; color: #f3f6fb; font-size: 1rem;
    }
    .gate-form input:focus-visible { outline: 2px solid #7dd3fc; outline-offset: 2px; }
    .gate-error { margin: 0; color: #fb7185; font-size: 0.875rem; line-height: 1.5; }
    .gate-form button {
      min-height: 44px; margin-top: 0.75rem; border: none; border-radius: 10px;
      background: #38bdf8; color: #062033; font-weight: 700; font-size: 1rem; cursor: pointer;
    }
  </style>
</head>
<body class="gate-body">
  <main class="gate-card">
    <h1>Grok Bot HQ</h1>
    <p class="gate-lead">Enter your office password to unlock HQ.</p>
    <form method="POST" action="/auth" class="gate-form">
      <label for="office-password">Office password</label>
      <input id="office-password" name="password" type="password" autocomplete="current-password" required autofocus />
      ${error}
      <button type="submit">Enter HQ</button>
    </form>
  </main>
</body>
</html>`;
}
