# Notarity Copilot

Conversation-first Streamlit MVP for the START Hack Vienna '26 Notarity case.

The app lets customers and business users complete Notarity flows through short natural-language chat. OpenAI interprets the conversation, the app stores structured booking state, and Notarity APIs are used for booking schema, products, timeslots, pricing, appointment submission, and business draft links.

## Run

```bash
export OPENAI_API_KEY="your-openai-api-key"

# Optional runtime configuration
export OPENAI_MODEL="gpt-4.1"
export NOTARITY_API_BASE_URL="https://staging-api.notarity.com"
export NOTARITY_WEB_BASE_URL="https://staging.notarity.com"
export BOOKING_FORM_SLUG="start-vienna-hackathon"
export NOTARITY_API_KEY="your-draft-api-key"
export NOTARITY_DRAFT_PASSWORD="notarity-challenge-2026"
export DEFAULT_DEMO_EMAIL="asetkabdula@gmail.com"
export DEFAULT_DEMO_PHONE="+43000000000"
export DEFAULT_TIMEZONE="Europe/Vienna"
export NOTARITY_REQUEST_MODE="debug"

pip install -r requirements.txt
streamlit run app.py
```

## Demo Flow

- The assistant first determines whether the user is a customer or a business user preparing something for a client.
- Customers answer one concise question at a time; document upload is optional and auto-reviewed when present.
- OpenAI updates structured booking state and asks only for the next missing field.
- Product choices come from the visible booking-form schema and `/products/tags`, not hardcoded persona cases.
- Timeslot labels are read from the visible schema. If the schema does not expose one, optional env fallbacks can be set with `AT_TIMESLOT_LABEL_FALLBACK` and `DEFAULT_TIMESLOT_LABEL_FALLBACK`.
- Pricing is called automatically once the booking state is complete enough.
- Appointment submission uses a real multipart request containing `payload` plus uploaded files.
- Business draft mode creates a draft link through `/api/v1/appointment-request-drafts`; the lawyer can copy the link and the client can choose remaining details later.

## Configuration Notes

- `NOTARITY_API_BASE_URL` and `NOTARITY_WEB_BASE_URL` keep staging/production URLs configurable.
- `BOOKING_FORM_SLUG` selects the booking form schema.
- `NOTARITY_API_KEY` is required only for creating business draft links.
- `NOTARITY_DRAFT_PASSWORD` is sent in the draft payload.
- `DEFAULT_DEMO_EMAIL` and `DEFAULT_DEMO_PHONE` are safe demo fallbacks only.
- `NOTARITY_REQUEST_MODE` defaults to `debug`; change or unset it based on the target environment.

## Prototype Notes

- Customer-facing chat avoids technical words like API, endpoint, schema, payload, backend, and HTTP status.
- Technical responses and generated payloads are visible only in sidebar expanders.
- Country normalization uses `pycountry` and expects ISO alpha-2 country codes in structured state.
- The app builds final request payloads deterministically; the LLM only handles intake, extraction, and conversation planning.
