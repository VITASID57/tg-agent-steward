# TG Agent Steward collaboration rules

This repository is the generic, source-available TG Steward. It must remain usable
without any private companion system or downstream host product.

- Never commit bot tokens, model credentials, account cookies, private persona
  text, chat IDs, server addresses, or private-project-specific tool names.
- Keep the public core provider-neutral. Private behavior belongs in external
  persona/rules files or adapters loaded at runtime.
- The web UI and HTTP API are clients of the same application services. Do not
  put business logic in the browser.
- Engine adapters implement the public engine contract. They must not import
  Telegram, HTTP UI, or a private memory implementation.
- Default to least privilege. Do not use permission-bypass flags. Secrets come
  from environment variables or the engine's own supported login flow.
- Model and effort choices must come from the engine when possible. Reject an
  unavailable choice rather than silently substituting another.
- Keep handwritten source files near 300 lines and functions near 80 lines;
  split by responsibility when a module starts mixing concerns.
- Use Node built-ins by default. Add a dependency only when it materially
  improves correctness or maintainability.
- Tests must use fake engines and fake Telegram transports. They may never call
  paid model APIs or the live Telegram API.
