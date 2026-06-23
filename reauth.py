"""Re-authorize Google (Gmail + Calendar) and refresh the stored token.

Run this when /refresh starts failing with `invalid_grant` — that means Google
revoked the refresh token (usually a password change, a manual app removal under
myaccount.google.com → "Third-party apps", or the per-client token limit).

Steps it performs:
  1. Opens a browser for Google login (uses credentials.json in this folder).
  2. Writes a fresh token.json locally.

After running, push the new token to Railway so the cloud app uses it too:

    B64=$(base64 -w0 token.json)
    railway variables --set "GOOGLE_TOKEN_B64=$B64"

That triggers a redeploy; get_creds() adopts the new token over any stale copy
on the volume. Verify with a POST to /refresh then GET /refresh/status.
"""

import pull
from google_auth_oauthlib.flow import InstalledAppFlow

flow = InstalledAppFlow.from_client_secrets_file(str(pull.CREDENTIALS_FILE), pull.SCOPES)
# prompt="consent" guarantees Google returns a fresh refresh_token, not just an
# access token, so the resulting token.json can refresh itself going forward.
creds = flow.run_local_server(port=0, prompt="consent", open_browser=True)
pull._persist_token(creds)
print("Re-auth OK -> token written to", pull.TOKEN_FILE,
      "| refresh_token length:", len(creds.refresh_token or ""))
