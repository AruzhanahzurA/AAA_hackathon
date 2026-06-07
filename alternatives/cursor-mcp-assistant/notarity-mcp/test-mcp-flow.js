import { resolveFormState } from './services/conditionEvaluator.js';
import { computeConfirmedPrice } from './services/pricing.js';
import { extractTextResult, sendJsonRpc } from './test-helpers.js';

const NIE_APPLICATION_ID = 'UpEJ7raQEKQKFhWn12r2';
const NIE_PERSONAL_DATA_ID = 'xK5IkgPX1LTYdWLFzW8X';
const ES_TIMESLOT_LABEL = '29sfIoZ9WgFQl8XjbKPu';

function buildPricePayload(bookingForm, timeslotId, confirmedPrice) {
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

async function main() {
  const partialPayload = {
    destinationCountry: 'ES',
    products: [{ id: NIE_APPLICATION_ID }],
  };

  await sendJsonRpc({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });

  const bookingForm = extractTextResult(
    await sendJsonRpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'fetch_booking_form', arguments: {} },
    }),
    2,
  );

  const formState = resolveFormState(bookingForm, partialPayload);

  const resolveToolState = extractTextResult(
    await sendJsonRpc({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'resolve_form_state',
        arguments: { bookingForm, payload: partialPayload },
      },
    }),
    3,
  );

  if (JSON.stringify(formState) !== JSON.stringify(resolveToolState)) {
    throw new Error('resolve_form_state tool result does not match local evaluator.');
  }

  if (formState.timeslotLabel !== ES_TIMESLOT_LABEL) {
    throw new Error(`Expected ES timeslot label ${ES_TIMESLOT_LABEL}, got ${formState.timeslotLabel}.`);
  }

  if (!formState.autoProductIds.includes(NIE_PERSONAL_DATA_ID)) {
    throw new Error('Expected auto-added NIE Personal Data product.');
  }

  const products = extractTextResult(
    await sendJsonRpc({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'fetch_products', arguments: { tags: formState.productTags } },
    }),
    4,
  );

  const timeslots = extractTextResult(
    await sendJsonRpc({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'fetch_timeslots',
        arguments: {
          timeslotLabel: formState.timeslotLabel,
          startDate: '2026-06-08T00:00:00.000Z',
          endDate: '2026-06-15T00:00:00.000Z',
        },
      },
    }),
    5,
  );

  const draftPayload = buildPricePayload(bookingForm, timeslots[0].id, 0);
  const pricing = extractTextResult(
    await sendJsonRpc({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'get_price', arguments: { payload: draftPayload } },
    }),
    6,
  );

  const confirmedPriceResult = extractTextResult(
    await sendJsonRpc({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'compute_confirmed_price', arguments: { priceLines: pricing } },
    }),
    7,
  );

  const confirmedPrice = confirmedPriceResult.confirmedPrice;
  const localConfirmedPrice = computeConfirmedPrice(pricing);

  if (confirmedPrice !== localConfirmedPrice) {
    throw new Error('compute_confirmed_price tool mismatch.');
  }

  console.log('FORM_STATE');
  console.log(JSON.stringify(formState, null, 2));
  console.log('\nPRODUCT_TAGS');
  console.log(JSON.stringify(formState.productTags, null, 2));
  console.log('\nAUTO_PRODUCT_IDS');
  console.log(JSON.stringify(formState.autoProductIds, null, 2));
  console.log('\nTIMESLOT_LABEL');
  console.log(formState.timeslotLabel);
  console.log('\nPRODUCT_IDS');
  console.log(JSON.stringify(products.map((product) => product.id), null, 2));
  console.log('\nCONFIRMED_PRICE');
  console.log(confirmedPrice);
  console.log('\nPRICE_LINES');
  console.log(JSON.stringify(pricing, null, 2));

  if (!products.some((product) => product.id === NIE_APPLICATION_ID)) {
    throw new Error('NIE application product missing from fetch_products response.');
  }

  if (!pricing.some((line) => line.name?.toLowerCase().includes('nie'))) {
    throw new Error('Price lines do not include NIE products.');
  }

  if (confirmedPrice !== 580) {
    throw new Error(`Expected confirmed price 580, got ${confirmedPrice}.`);
  }

  console.log('\nFLOW_TEST_OK');
}

main().catch((error) => {
  console.error('FLOW_TEST_FAILED');
  console.error(error);
  process.exit(1);
});
