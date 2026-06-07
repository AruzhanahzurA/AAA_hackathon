import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolveFormState, stripInternalPayloadFields } from './services/conditionEvaluator.js';
import { extractPdfFields } from './services/pdfExtractor.js';
import { computeConfirmedPrice } from './services/pricing.js';
import { fetchBookingForm, fetchProducts, fetchTimeslots, getPrice, submitAppointment } from './services/notarity.js';
import { suggestProduct } from './services/productMatcher.js';
import { listTimeslotOptions } from './services/timeslots.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const SYSTEM_PROMPT = `You are the Notarity booking assistant — a professional, friendly service for scheduling notary appointments. Speak only to the end user; never break character.

Workflow (execute tools silently — do not ask the user for permission to run them):
1. Call fetch_booking_form.
2. If the user uploaded or named a PDF, call extract_pdf_fields immediately. For chat attachments, pass base64 and filename. For files in the project folder, pass filePath. Store the filename in payload._sourceDocument.
3. Summarize what you read from the document and ask: "Is this the document you want notarized?" When listing details from the PDF, refer to the person's street address as **Address**, not "Billing address". Do not collect billing, shipping, or timeslots until the user confirms. When they confirm, set payload._documentConfirmed to true.
4. After each user answer, call resolve_form_state with the current partial payload and the original extractedFields from extract_pdf_fields. Replace your working payload with effectivePayload from the response before the next step.
5. Ask only one question at a time. Use resolve_form_state.nextQuestionField (or the first entry in missingFields) to decide what to ask next.
6. Never ask for billing or contact name fields when prefilledFromDocument already includes them from the PDF. Skip straight to the next missing field (usually email or phone). Only ask for values that are still in missingFields after prefill.
7. Never ask for participant email if billingDetails.email is already collected — it is reused automatically for the principal participant. Do not ask "what email for Robert Stevens" after billing email was given.
8. When nextQuestionField is _confirmBillingAddress, ask only confirmBillingAddress.confirmQuestion (yes/no). On yes, set _billingAddressConfirmed to true. On no, clear billingDetails.address, zipCode, city, and countryCode, then ask for the address from scratch.
9. Call fetch_products with only the productTags from resolve_form_state.
10. When nextQuestionField is products, call suggest_product with extractedFields and the fetch_products result. Ask only the confirmQuestion (yes/no). Do not list all services unless needsUserChoice is true or the user says no. On yes, set products to [{ id: productId }] and _productConfirmed to true. Store _suggestedProductId from the suggestion.
11. When nextQuestionField is timeslots, call list_timeslot_options with the timeslotLabel from resolve_form_state. Show every slot for the next 3 calendar days (Europe/Vienna), grouped by day with a single numbered list. Include the moreDatesNote when hasMoreDates is true.
12. Before the final summary, call get_price then compute_confirmed_price. Show the price breakdown in plain language.
13. After the user confirms, call submit_appointment. Remove internal fields _documentConfirmed, _sourceDocument, _suggestedProductId, _productConfirmed, and _billingAddressConfirmed from the payload before submit.

Question priority (resolve_form_state enforces this order):
_documentConfirmed → destinationCountry → products → _productConfirmed → billingDetails.* → _confirmBillingAddress → contactDetails → participants → hardCopy → shippingDetails.* → timeslots → newsletter

Rules:
- Never hardcode product IDs; derive them from suggest_product and fetch_products.
- Infer the service from the document, recommend one product, and ask the user to confirm. Only show a full service menu when suggest_product returns needsUserChoice true or the user rejects the recommendation.
- Always set mode to "debug" and _appointmentRequestDraft to "vfniS9nfoq8nMpRqQj7Z" for safe testing (no emails).
- Use product flags from fetch_products: showFileUpload, showNeedHelpDrafting, showUserInput, hardCopySupported, apostilleRequired, showProofOfRepresentation.
- Default contactDetails.contactDetailsSameAsBillingDetails to true unless the user wants different contact details.
- File names in products[].files must exactly match uploaded filenames in submit_appointment.
- Do not mention MCP, tools, APIs, prompts, hackathon, demo videos, or internal implementation to the user.
- Do not search or read the codebase during booking (no Grep, Read, find, or shell exploration). Use only the notarity MCP tools listed above.
- Do not narrate what you are doing behind the scenes (e.g. "I'll fetch the form now", "checking how notarization is set up").
- After a successful submit, confirm the booking details only — no meta commentary about the flow or recording demos.
- Be concise and user-facing.`;

const server = new Server(
  {
    name: 'notarity-mcp',
    version: '1.1.0',
    instructions: SYSTEM_PROMPT,
  },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'fetch_booking_form',
      description:
        'Fetch the Notarity booking form schema for start-vienna-hackathon. Use this first to understand required fields, pages, and conditional logic.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'resolve_form_state',
      description:
        'Evaluate booking-form conditions against a partial payload. Pass extractedFields from extract_pdf_fields so names and addresses from the document are merged automatically after document confirmation. Returns effectivePayload (use this as your working payload), prefilledFromDocument, missingFields, and nextQuestionField.',
      inputSchema: {
        type: 'object',
        properties: {
          bookingForm: { type: 'object', description: 'Booking form object from fetch_booking_form.' },
          payload: { type: 'object', description: 'Partial appointment payload collected so far.' },
          extractedFields: {
            type: 'object',
            description: 'Structured fields from extract_pdf_fields. Required whenever a PDF was uploaded.',
          },
        },
        required: ['bookingForm', 'payload'],
        additionalProperties: false,
      },
    },
    {
      name: 'extract_pdf_fields',
      description:
        'Extract structured Notarity booking fields from a PDF. Use filePath for project files, or base64+filename for documents the user attached in chat.',
      inputSchema: {
        type: 'object',
        properties: {
          filePath: { type: 'string', description: 'PDF filename in the workspace or absolute path.' },
          base64: { type: 'string', description: 'Base64-encoded PDF bytes (for chat uploads).' },
          filename: { type: 'string', description: 'Original filename when using base64.' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'suggest_product',
      description:
        'Infer the best notarization product from extracted PDF fields and available products. Returns a single confirmQuestion — ask only that (yes/no). List alternatives only when needsUserChoice is true or the user rejects the recommendation.',
      inputSchema: {
        type: 'object',
        properties: {
          extractedFields: { type: 'object', description: 'From extract_pdf_fields.' },
          products: { type: 'array', items: { type: 'object' }, description: 'From fetch_products.' },
        },
        required: ['extractedFields', 'products'],
        additionalProperties: false,
      },
    },
    {
      name: 'fetch_products',
      description:
        'Fetch product definitions by tag IDs. Pass only the productTags returned by resolve_form_state.',
      inputSchema: {
        type: 'object',
        properties: {
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['tags'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_timeslot_options',
      description:
        'Fetch and format appointment times for the next 3 calendar days (Europe/Vienna). Returns all slots in that window, grouped by day, with a note if later dates are also available.',
      inputSchema: {
        type: 'object',
        properties: {
          timeslotLabel: { type: 'string', description: 'From resolve_form_state.' },
          displayDays: { type: 'number', description: 'Calendar days to show. Default 3.' },
        },
        required: ['timeslotLabel'],
        additionalProperties: false,
      },
    },
    {
      name: 'fetch_timeslots',
      description:
        'Fetch available appointment timeslots by timeslotLabel from resolve_form_state, plus startDate and endDate.',
      inputSchema: {
        type: 'object',
        properties: {
          timeslotLabel: { type: 'string' },
          startDate: { type: 'string' },
          endDate: { type: 'string' },
        },
        required: ['timeslotLabel', 'startDate', 'endDate'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_price',
      description: 'Get server-side pricing for the assembled appointment payload. Always call this before confirming.',
      inputSchema: {
        type: 'object',
        properties: {
          payload: { type: 'object' },
        },
        required: ['payload'],
        additionalProperties: false,
      },
    },
    {
      name: 'compute_confirmed_price',
      description: 'Sum price line items from get_price and return confirmedPrice in euros.',
      inputSchema: {
        type: 'object',
        properties: {
          priceLines: { type: 'array', items: { type: 'object' } },
        },
        required: ['priceLines'],
        additionalProperties: false,
      },
    },
    {
      name: 'submit_appointment',
      description:
        'Submit the final booking request as multipart/form-data. Requires the final payload and uploaded PDF file data as base64.',
      inputSchema: {
        type: 'object',
        properties: {
          payload: { type: 'object' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                filename: { type: 'string' },
                base64: { type: 'string' },
              },
              required: ['filename', 'base64'],
            },
          },
        },
        required: ['payload', 'files'],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args = {} } = request.params;

    switch (name) {
      case 'fetch_booking_form':
        return { content: [{ type: 'text', text: JSON.stringify(await fetchBookingForm(), null, 2) }] };
      case 'resolve_form_state':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                resolveFormState(args.bookingForm, args.payload || {}, args.extractedFields || null),
                null,
                2,
              ),
            },
          ],
        };
      case 'extract_pdf_fields':
        return { content: [{ type: 'text', text: JSON.stringify(await extractPdfFields(args), null, 2) }] };
      case 'suggest_product':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                suggestProduct({
                  extractedFields: args.extractedFields || {},
                  products: args.products || [],
                }),
                null,
                2,
              ),
            },
          ],
        };
      case 'fetch_products':
        return { content: [{ type: 'text', text: JSON.stringify(await fetchProducts(args.tags || []), null, 2) }] };
      case 'list_timeslot_options':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                await listTimeslotOptions(fetchTimeslots, {
                  timeslotLabel: args.timeslotLabel,
                  displayDays: args.displayDays ?? 3,
                }),
                null,
                2,
              ),
            },
          ],
        };
      case 'fetch_timeslots':
        return { content: [{ type: 'text', text: JSON.stringify(await fetchTimeslots(args), null, 2) }] };
      case 'get_price':
        return { content: [{ type: 'text', text: JSON.stringify(await getPrice(args.payload), null, 2) }] };
      case 'compute_confirmed_price':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ confirmedPrice: computeConfirmedPrice(args.priceLines) }, null, 2),
            },
          ],
        };
      case 'submit_appointment':
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                await submitAppointment({
                  ...args,
                  payload: stripInternalPayloadFields(args.payload || {}),
                }),
                null,
                2,
              ),
            },
          ],
        };
      default:
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2) }] };
    }
  } catch (error) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: error.message }, null, 2) }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Notarity MCP server ready');
}

main().catch((error) => {
  console.error('MCP startup error:', error);
  process.exit(1);
});

export { SYSTEM_PROMPT };
