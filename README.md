# Notarity Copilot

Conversation-first Streamlit MVP for the START Hack Vienna '26 Notarity case.

The app lets a customer book by answering short natural-language questions. Gemini interprets the conversation, the app stores structured booking state, and Notarity APIs are used for schema, timeslots, pricing, and debug submission.

## Run

```bash
export GEMINI_API_KEY="your-gemini-api-key"
# Optional: override the default model
export GEMINI_MODEL="models/gemini-2.5-flash"
pip install -r requirements.txt
streamlit run app.py
```

## Demo Flow

- Users start by answering one assistant question at a time. Uploading documents is optional.
- Gemini updates structured booking state and asks the next relevant question.
- If `GEMINI_API_KEY` is not set, the app does not invent a booking path; it asks for a working Gemini key.
- The UI keeps technical schema/API details in expanders while the main experience remains conversational.
- Product choices come from the visible booking-form schema and `/products/tags`, not hardcoded persona cases.
- It calls the real schedule API from the conversation when appointment times are needed.
- It calls the real staging pricing endpoint automatically when the booking state is complete enough.
- It asks for confirmation in chat and then submits a real multipart debug appointment request after the user confirms.
- Payload fields are assembled from conversation state, uploaded files, schema visibility, selected products, timeslots, and backend pricing.

## Prototype Notes

- `_appointmentRequestDraft` can be sent with the sample ID, a generated demo ID, or omitted because the draft autosave endpoint is not documented in the provided sample.
- The final payload preview mirrors the `POST /appointment-requests` multipart payload shape.
- The UI uses `asetkabdula@gmail.com` as the safe demo contact email.
- The final submit button calls the real staging API manually; it is never triggered automatically.
- Gemini is used only for intake extraction and question planning. The app still builds the final payload and calls Notarity APIs deterministically.
