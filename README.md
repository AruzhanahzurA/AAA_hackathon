# Notarity Copilot

A short conversation instead of a complex booking form.

A submission for START Hack Vienna '26, built for the case provided by Notarity.

## About

Traditional online booking interfaces force users through rigid multi-page forms that often confuse customers dealing with international notarization requirements. Notarity Copilot replaces static forms with an intelligent conversational assistant that understands natural language, analyzes uploaded legal documents, and automatically guides users through the booking process validating booking information against live Notarity backend rules.

## The Challenge

The goal was to design an intelligent conversational intake assistant capable of guiding both individual customers and business users through the notarization booking process using a single chat interface. The system needed to parse multilingual legal documents, extract relevant metadata, calculate live pricing, and coordinate appointment availability through the Notarity backend APIs.

## What We Built

### Dynamic Booking Schema Interpreter

Reads Notarity booking schemas at runtime and automatically discovers available products, conditions, appointment configurations, and validation rules without hardcoded service definitions.

### Conversational Booking Assistant

Uses OpenAI structured JSON outputs to extract booking information, understand user intent, and maintain a complete appointment state through natural conversation.

### Intelligent Appointment Scheduler

Queries availability across rolling time windows, filters unavailable appointments, and presents the earliest valid slots to users.

### PDF-Aware Intake Workflow

Extracts text from uploaded legal documents and uses it to identify relevant notarization services and pre-fill booking information.

### Business Draft Link Generator

Supports both direct customer bookings and business workflows by generating secure pre-filled appointment drafts for clients.

## Demo

- **Live demo:** Run locally (see instructions below)
- **Screenshots / video:** `<link>`

## Getting Started

### Prerequisites

To run this project locally, make sure you have:

- Python 3.12+
- An OpenAI API key with support for structured JSON outputs

### Setup

```bash
# 1. Clone the repository
git clone <your-assigned-start-hack-repo-url>
cd notarity-copilot

# 2. Configure environment
cp .env.example .env

# Fill in the required values inside .env

# 3. Install dependencies
pip install -r requirements.txt
```

### Run

```bash
# Start the Streamlit application
streamlit run app.py
```

Then open:

```
http://localhost:8501
```

in your browser.

## Project Structure

```text
├── app.py                # Main Streamlit application, session state management, and UI rendering
├── requirements.txt      # Python dependencies
├── .env.example          # Example environment configuration
├── README.md             # Project documentation
└── supporting modules and utilities
```

## Configuration

The application uses environment variables for configuration. Store secrets in `.env` (git-ignored) and provide safe defaults in `.env.example`.

| Variable Name | Default Value | Description |
|---------------|--------------|-------------|
| OPENAI_API_KEY | Required | OpenAI API authentication key |
| NOTARITY_API_KEY | Optional | API credential for secure draft link generation |
| NOTARITY_API_BASE_URL | https://staging-api.notarity.com | Backend API endpoint |
| NOTARITY_WEB_BASE_URL | https://staging.notarity.com | Frontend base URL for generated links |
| BOOKING_FORM_SLUG | start-vienna-hackathon | Booking form identifier |
| OPENAI_MODEL | gpt-4.1 | OpenAI model used for structured reasoning |
| NOTARITY_DRAFT_PASSWORD | notarity-challenge-2026 | Default password for generated draft links |
| DEFAULT_TIMEZONE | Europe/Vienna | Timezone used for scheduling calculations |
| NOTARITY_REQUEST_MODE | debug | Request mode flag attached to API payloads |

## Architecture & Assumptions

The system separates conversational understanding from backend validation and booking logic.

A central Streamlit session state stores booking metadata such as destination country, selected products, billing information, and appointment details. User messages and uploaded document content are processed by OpenAI, which returns structured state updates in JSON format. These updates are validated against the dynamically loaded booking schema before pricing calculations and appointment availability requests are executed.

The application assumes:

- Product pricing is represented in minor currency units (cents).
- Country values are standardized using ISO Alpha-2 country codes.
- Backend schemas represent the source of truth for booking requirements and available products.
- Uploaded PDFs contain extractable text content suitable for automated analysis.

## Troubleshooting

### Problem
Price calculation returns €0 or falls back to a default value.

### Fix
Verify that the extracted document type matches an available product in the booking catalog and ensure selected product IDs are synchronized with the backend schema.

---

### Problem
`ImportError: cannot import name 'PdfReader' from 'pypdf'`

### Fix
Upgrade to the latest version of pypdf:

```bash
pip install --upgrade pypdf
```

---

### Problem
The chat interface becomes unresponsive after submitting a message.

### Fix
Check that your `OPENAI_API_KEY` is correctly configured and verify that your account is not being rate-limited (HTTP 429 errors).

## Team

- Asset Kabdula — Lead Application Developer
- Aruzhan Oshakbayeva — MCP Plugin Engineer
- Azhar Serik — Workflow Automation Engineer

## Submission

**Track:** Legal Tech & Workflow Automation  
**Case Partner:** Notarity

Submitted to the START Hack Vienna '26 GitHub organisation.

## Alternative solution (draft)

A Cursor MCP-based booking assistant lives in [`alternatives/cursor-mcp-assistant/`](alternatives/cursor-mcp-assistant/README.md). Open that folder as a workspace to run it.

## License

Released under the MIT License — see `LICENSE`.