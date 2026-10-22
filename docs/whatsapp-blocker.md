# WhatsApp: outbound replies blocked by Meta account requirements

**Status (22 Oct 2026, 15:16 UTC): inbound works, outbound blocked.**

## What works

The integration is complete and verified live for incoming messages:

1. Meta verified the webhook (`GET /api/webhooks/whatsapp` handshake, 200).
2. A real WhatsApp message to the test number (+1 555 202 4480) reached the app with a valid
   `X-Hub-Signature-256` signature.
3. The assistant qualified the lead (company, service, budget, timeline all quoted from the message),
   assigned it to Asha Mehta by routing rule RT3, read her Google Calendar and chose three free slots.
4. `POST /{phone-number-id}/messages` accepted the reply (HTTP 200, a `wamid` returned).

## What is blocked

Seconds later Meta's delivery webhook reported the reply as **failed: "Business Account locked"**. The app
recorded this on the message, logged it on the lead and set WhatsApp to "error" in the dashboard header.

The WhatsApp Business Account's `health_status` explains why (IDs masked):

```json
{
  "account_review_status": "APPROVED",
  "business_verification_status": "not_verified",
  "health_status": {
    "can_send_message": "BLOCKED",
    "entities": [
      {
        "entity_type": "WABA",
        "id": "xxxxxxxxxxxx5766",
        "can_send_message": "BLOCKED",
        "errors": [
          {
            "error_code": 141006,
            "error_description": "There is an error with the payment method. This will block business initiated conversations.",
            "possible_solution": "There was an error with your payment method. Please add a new payment method to the account."
          }
        ]
      },
      {
        "entity_type": "BUSINESS",
        "id": "xxxxxxxxxxx0086",
        "can_send_message": "LIMITED",
        "errors": [
          {
            "error_code": 141010,
            "error_description": "The Business has not passed business verification.",
            "possible_solution": "Visit business settings and start or resolve the business verification request."
          }
        ]
      },
      {
        "entity_type": "APP",
        "id": "xxxxxxxxxxxx2231",
        "can_send_message": "AVAILABLE"
      }
    ]
  }
}
```

## What was attempted

| Step | Result |
|---|---|
| System-user access token (never expires) with `whatsapp_business_messaging` | Done |
| Webhook verified and subscribed to `messages` | Done |
| App subscribed to the WhatsApp Business Account (`POST /{waba-id}/subscribed_apps`) | Done; it had only Meta's internal "WA DevX" app |
| Business profile completed (legal name, country, website), clearing error 131000 | Done; business status went from BLOCKED to LIMITED |
| Add a payment method to clear 141006 | Not done: it requires putting a personal card on file with Meta for a test account |
| Business verification to clear 141010 | Not possible: it requires official documents for a registered business |

Replies to a customer within 24 hours are free under WhatsApp's pricing, but Meta still requires the account to
have a valid payment method before it will deliver any message from this business.

## How to complete it

Add a payment method in WhatsApp Manager → Payment settings, then send a message to the number. No code changes
are needed; the same flow already completes on Instagram through to a confirmed Google Calendar booking.
