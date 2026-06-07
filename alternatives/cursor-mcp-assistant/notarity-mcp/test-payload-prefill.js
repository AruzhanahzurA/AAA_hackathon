import assert from 'node:assert/strict';
import { mergeExtractedIntoPayload, resolveFormState } from './services/conditionEvaluator.js';

const robertExtraction = {
  destinationCountry: 'LT',
  billingDetails: {
    firstName: 'Robert',
    lastName: 'Stevens',
    address: 'Savanorių pr. 120',
    city: 'Kaunas',
    zipCode: '44148',
    countryCode: 'LT',
  },
  participants: [
    { firstName: 'Robert', lastName: 'Stevens', role: 'Principal' },
    { firstName: 'Elena', lastName: 'Petrova', role: 'Agent' },
  ],
};

const { payload, prefilledFromDocument } = mergeExtractedIntoPayload({}, robertExtraction);

assert.equal(payload.billingDetails.firstName, 'Robert');
assert.equal(payload.billingDetails.lastName, 'Stevens');
assert.ok(prefilledFromDocument.includes('billingDetails.firstName'));

const billingForm = {
  pages: [
    {
      components: [{ type: 'billingDetails' }],
    },
  ],
};

const state = resolveFormState(
  billingForm,
  {
    _sourceDocument: 'Robert_Stevens_sample_case.pdf',
    _documentConfirmed: true,
    destinationCountry: 'LT',
    products: [{ id: 'ujwBkZleJLPEzByCnPCS' }],
    _productConfirmed: true,
  },
  robertExtraction,
);

assert.ok(!state.missingFields.includes('billingDetails.firstName'));
assert.ok(!state.missingFields.includes('billingDetails.lastName'));
assert.ok(state.missingFields.includes('billingDetails.email'));
assert.equal(state.effectivePayload.billingDetails.firstName, 'Robert');

const afterContact = resolveFormState(
  billingForm,
  {
    ...state.effectivePayload,
    billingDetails: {
      ...state.effectivePayload.billingDetails,
      email: 'robert@example.com',
      phoneNumber: '+4392957473737',
    },
  },
  robertExtraction,
);

assert.equal(afterContact.nextQuestionField, '_confirmBillingAddress');
assert.match(afterContact.confirmBillingAddress.confirmQuestion, /Savanorių pr\. 120/);
assert.match(afterContact.confirmBillingAddress.confirmQuestion, /Kaunas/);

const bookingForm = {
  pages: [
    {
      components: [{ type: 'billingDetails' }, { type: 'participants' }],
    },
  ],
};

const afterBillingComplete = resolveFormState(
  bookingForm,
  {
    _sourceDocument: 'Robert_Stevens_sample_case.pdf',
    _documentConfirmed: true,
    _billingAddressConfirmed: true,
    destinationCountry: 'LT',
    products: [{ id: 'ujwBkZleJLPEzByCnPCS' }],
    _productConfirmed: true,
    billingDetails: {
      firstName: 'Robert',
      lastName: 'Stevens',
      email: 'robert@example.com',
      phoneNumber: '+4392957473737',
      address: 'Savanorių pr. 120',
      city: 'Kaunas',
      zipCode: '44148',
      countryCode: 'LT',
    },
    participants: robertExtraction.participants,
  },
  robertExtraction,
);

assert.ok(!afterBillingComplete.missingFields.includes('participants.email'));
assert.equal(afterBillingComplete.effectivePayload.participants[0].email, 'robert@example.com');

console.log('test-payload-prefill: ok');
