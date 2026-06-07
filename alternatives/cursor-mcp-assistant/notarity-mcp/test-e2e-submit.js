import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveFormState } from './services/conditionEvaluator.js';
import { computeConfirmedPrice } from './services/pricing.js';
import { WORKSPACE_ROOT } from './services/pdfExtractor.js';
import { extractTextResult, sendJsonRpc } from './test-helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(WORKSPACE_ROOT, 'samples');

const NIE_APPLICATION_ID = 'UpEJ7raQEKQKFhWn12r2';
const NIE_PERSONAL_DATA_ID = 'xK5IkgPX1LTYdWLFzW8X';
const ES_TIMESLOT_LABEL = '29sfIoZ9WgFQl8XjbKPu';

function buildJoshuaPayload(bookingForm, timeslotId, confirmedPrice) {
  return {
    _bookingForm: bookingForm.id,
    language: 'en',
    origin: `https://staging.notarity.com/#/my-companies/${bookingForm._company}/appointment-requests`,
    confirmedPrice,
    hardCopy: { expressShipping: false, hardCopy: true },
    newsletter: false,
    mode: 'debug',
    _appointmentRequestDraft: 'vfniS9nfoq8nMpRqQj7Z',
    destinationCountry: 'ES',
    products: [
      {
        id: NIE_APPLICATION_ID,
        apostille: true,
        userInput: '',
        documentsNotReadyYet: false,
        needHelpDrafting: false,
        proofOfRepresentation: null,
        files: ['nie-application-demo-joshua_timms.pdf'],
      },
      {
        id: NIE_PERSONAL_DATA_ID,
        apostille: null,
        userInput: '',
        documentsNotReadyYet: false,
        needHelpDrafting: false,
        proofOfRepresentation: null,
        files: ['nie_personal_details.pdf'],
      },
    ],
    participants: [{ email: 'joshua.timms@notarity.com', client: true, supervisor: false }],
    timeslots: [timeslotId],
    instantNotarisationSupported: false,
    instant: false,
    timezone: 'Europe/Vienna',
    billingDetails: {
      firstName: 'Joshua',
      lastName: 'Timms',
      business: false,
      email: 'joshua.timms@notarity.com',
      phoneNumber: '+12125550174',
      address: '5th Ave 350',
      zipCode: '10118',
      city: 'New York',
      stateProvince: 'NY',
      countryCode: 'US',
    },
    contactDetails: {
      contactDetailsSameAsBillingDetails: true,
      firstName: 'Joshua',
      lastName: 'Timms',
      business: false,
      email: 'joshua.timms@notarity.com',
      phoneNumber: '+12125550174',
    },
    shippingDetails: {
      shippingDetailsSameAsBillingDetails: false,
      firstName: 'Joshua',
      lastName: 'Timms',
      business: false,
      email: 'joshua.timms@notarity.com',
      phoneNumber: '+12125550174',
      address: 'Carrer de Mallorca 401',
      zipCode: '08013',
      city: 'Barcelona',
      stateProvince: 'CT',
      countryCode: 'ES',
    },
    preferredNotary: '',
  };
}

function readPdfBase64(filename) {
  const buffer = readFileSync(path.join(SAMPLES_DIR, filename));
  return buffer.toString('base64');
}

async function main() {
  const partialPayload = {
    destinationCountry: 'ES',
    products: [{ id: NIE_APPLICATION_ID }],
  };

  const bookingFormResponse = await sendJsonRpc({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'fetch_booking_form', arguments: {} },
  });

  const bookingForm = extractTextResult(bookingFormResponse, 2);
  const formState = resolveFormState(bookingForm, partialPayload);

  console.log('FORM_STATE');
  console.log(JSON.stringify(formState, null, 2));

  if (!formState.productTags.includes('HdippWIH77AdMywneldY')) {
    throw new Error('Expected Spain product tags for destinationCountry ES.');
  }

  if (!formState.autoProductIds.includes(NIE_PERSONAL_DATA_ID)) {
    throw new Error('Expected NIE Personal Data auto-product when NIE application is selected.');
  }

  if (formState.timeslotLabel !== ES_TIMESLOT_LABEL) {
    throw new Error(`Expected ES timeslot label ${ES_TIMESLOT_LABEL}, got ${formState.timeslotLabel}.`);
  }

  const productsResponse = await sendJsonRpc({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'fetch_products', arguments: { tags: formState.productTags } },
  });
  const products = extractTextResult(productsResponse, 3);

  const timeslotsResponse = await sendJsonRpc({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'fetch_timeslots',
      arguments: {
        timeslotLabel: formState.timeslotLabel,
        startDate: '2026-06-08T00:00:00.000Z',
        endDate: '2026-06-15T00:00:00.000Z',
      },
    },
  });
  const timeslots = extractTextResult(timeslotsResponse, 4);

  const draftPayload = buildJoshuaPayload(bookingForm, timeslots[0].id, 0);
  const priceResponse = await sendJsonRpc({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'get_price', arguments: { payload: draftPayload } },
  });
  const pricing = extractTextResult(priceResponse, 5);
  const confirmedPrice = computeConfirmedPrice(pricing);
  const finalPayload = buildJoshuaPayload(bookingForm, timeslots[0].id, confirmedPrice);

  const submitResponse = await sendJsonRpc({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'submit_appointment',
      arguments: {
        payload: finalPayload,
        files: [
          { filename: 'nie-application-demo-joshua_timms.pdf', base64: readPdfBase64('nie-application-demo-joshua_timms.pdf') },
          { filename: 'nie_personal_details.pdf', base64: readPdfBase64('nie_personal_details.pdf') },
        ],
      },
    },
  });
  const submission = extractTextResult(submitResponse, 6);

  console.log('\nPRODUCT_TAGS');
  console.log(JSON.stringify(formState.productTags, null, 2));
  console.log('\nPRODUCTS');
  console.log(JSON.stringify(products.map((product) => product.id), null, 2));
  console.log('\nTIMESLOT_LABEL');
  console.log(formState.timeslotLabel);
  console.log('\nCONFIRMED_PRICE');
  console.log(confirmedPrice);
  console.log('\nPRICE_LINES');
  console.log(JSON.stringify(pricing, null, 2));
  console.log('\nSUBMIT_RESPONSE');
  console.log(JSON.stringify(submission, null, 2));

  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('Product lookup returned no product definitions.');
  }

  if (!products.some((product) => product.id === NIE_APPLICATION_ID)) {
    throw new Error('NIE application product missing from fetch_products response.');
  }

  if (!Array.isArray(timeslots) || timeslots.length === 0) {
    throw new Error('Timeslot lookup returned no available slots.');
  }

  if (!Array.isArray(pricing) || pricing.length === 0) {
    throw new Error('Price lookup returned no pricing lines.');
  }

  if (submission?.error) {
    throw new Error(submission.error);
  }

  if (!submission?.id && !submission?._id && submission?.ok !== true) {
    throw new Error('Submit did not return a success response.');
  }

  console.log('\nE2E_SUBMIT_OK');
  console.log(`Workspace root: ${WORKSPACE_ROOT}`);
}

main().catch((error) => {
  console.error('E2E_SUBMIT_FAILED');
  console.error(error);
  process.exit(1);
});
