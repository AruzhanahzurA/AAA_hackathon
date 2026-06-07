function parseConditionValue(value) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('[') || value.startsWith('{')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function getValueByPath(obj, path) {
  if (!path) return undefined;

  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length; i += 1) {
    const key = parts[i];
    if (current == null) return undefined;

    if (Array.isArray(current)) {
      if (key === 'id') {
        return current.map((item) => item?.id).filter(Boolean);
      }
      return undefined;
    }

    current = current[key];
  }

  return current;
}

function isEmpty(value) {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

export function evaluateCondition(condition, payload) {
  const fieldValue = getValueByPath(payload, condition.compare || '');
  const expected = parseConditionValue(condition.value);

  switch (condition.operator) {
    case 'ISDEFINED':
      return !isEmpty(fieldValue);
    case 'EQUAL':
      return fieldValue === expected;
    case 'INCLUDES':
      return Array.isArray(expected) ? expected.includes(fieldValue) : fieldValue === expected;
    case 'INTERSECTS':
      return (
        Array.isArray(fieldValue) &&
        Array.isArray(expected) &&
        fieldValue.some((item) => expected.includes(item))
      );
    case 'ISTRUE':
      return Boolean(fieldValue);
    default:
      return false;
  }
}

function walkComponents(components, payload, activeComponents) {
  if (!Array.isArray(components)) return;

  for (const component of components) {
    if (component.type === 'condition') {
      const props = component.props || {};
      const matches = evaluateCondition(
        {
          operator: props.condition,
          compare: props.compare,
          value: props.value,
        },
        payload,
      );
      walkComponents(matches ? props.components : props.elseComponents, payload, activeComponents);
      continue;
    }

    activeComponents.push(component);
  }
}

const BILLING_ADDRESS_FIELDS = [
  'billingDetails.address',
  'billingDetails.zipCode',
  'billingDetails.city',
  'billingDetails.countryCode',
];

const BILLING_FIELDS = [
  'billingDetails.firstName',
  'billingDetails.lastName',
  'billingDetails.email',
  'billingDetails.phoneNumber',
  ...BILLING_ADDRESS_FIELDS,
];

const CONTACT_FIELDS = [
  'contactDetails.firstName',
  'contactDetails.lastName',
  'contactDetails.email',
  'contactDetails.phoneNumber',
];

const SHIPPING_FIELDS = [
  'shippingDetails.firstName',
  'shippingDetails.lastName',
  'shippingDetails.email',
  'shippingDetails.phoneNumber',
  'shippingDetails.address',
  'shippingDetails.zipCode',
  'shippingDetails.city',
  'shippingDetails.countryCode',
];

function collectMissingPaths(payload, paths) {
  return paths.filter((path) => isEmpty(getValueByPath(payload, path)));
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    if (current[key] == null || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }

  current[parts[parts.length - 1]] = value;
}

function mergeSectionFields(payload, sectionKey, sectionValue, prefilledFromDocument) {
  if (!sectionValue || typeof sectionValue !== 'object' || Array.isArray(sectionValue)) return;

  for (const [key, value] of Object.entries(sectionValue)) {
    const path = `${sectionKey}.${key}`;
    if (isEmpty(getValueByPath(payload, path)) && !isEmpty(value)) {
      setNestedValue(payload, path, value);
      prefilledFromDocument.push(path);
    }
  }
}

export function mergeExtractedIntoPayload(payload = {}, extractedFields = {}) {
  const merged = { ...payload };
  const prefilledFromDocument = [];

  if (
    extractedFields.destinationCountry &&
    isEmpty(merged.destinationCountry)
  ) {
    merged.destinationCountry = extractedFields.destinationCountry;
    prefilledFromDocument.push('destinationCountry');
  }

  mergeSectionFields(merged, 'billingDetails', extractedFields.billingDetails, prefilledFromDocument);
  mergeSectionFields(merged, 'contactDetails', extractedFields.contactDetails, prefilledFromDocument);
  mergeSectionFields(merged, 'shippingDetails', extractedFields.shippingDetails, prefilledFromDocument);

  const primaryParticipant = Array.isArray(extractedFields.participants)
    ? extractedFields.participants[0]
    : null;

  if (primaryParticipant) {
    const participantNameFields = [
      ['billingDetails.firstName', primaryParticipant.firstName],
      ['billingDetails.lastName', primaryParticipant.lastName],
      ['contactDetails.firstName', primaryParticipant.firstName],
      ['contactDetails.lastName', primaryParticipant.lastName],
    ];

    const participantAddressFields = [
      ['billingDetails.address', primaryParticipant.address],
      ['billingDetails.city', primaryParticipant.city],
      ['billingDetails.zipCode', primaryParticipant.zipCode],
      ['billingDetails.countryCode', primaryParticipant.countryCode],
    ];

    for (const [path, value] of [...participantNameFields, ...participantAddressFields]) {
      if (isEmpty(getValueByPath(merged, path)) && !isEmpty(value)) {
        setNestedValue(merged, path, value);
        prefilledFromDocument.push(path);
      }
    }
  }

  if (
    isEmpty(merged.participants) &&
    Array.isArray(extractedFields.participants) &&
    extractedFields.participants.length > 0
  ) {
    merged.participants = extractedFields.participants;
    prefilledFromDocument.push('participants');
  }

  return { payload: merged, prefilledFromDocument: [...new Set(prefilledFromDocument)] };
}

function namesMatch(personA, personB) {
  return (
    personA?.firstName?.toLowerCase() === personB?.firstName?.toLowerCase() &&
    personA?.lastName?.toLowerCase() === personB?.lastName?.toLowerCase()
  );
}

function findPrimaryParticipantIndex(participants) {
  const principalIndex = participants.findIndex((participant) =>
    /principal|grantor|signatory|mandant|client/i.test(participant?.role || ''),
  );
  return principalIndex >= 0 ? principalIndex : 0;
}

export function syncParticipantEmailFromBilling(payload = {}) {
  const billingEmail = payload.billingDetails?.email;
  if (isEmpty(billingEmail) || !Array.isArray(payload.participants) || payload.participants.length === 0) {
    return payload;
  }

  if (payload.participants.some((participant) => participant?.email)) {
    return payload;
  }

  const primaryIndex = findPrimaryParticipantIndex(payload.participants);
  const primary = payload.participants[primaryIndex];
  const billing = payload.billingDetails || {};
  const shouldSync =
    namesMatch(primary, billing) || payload.participants.length === 1 || primaryIndex === 0;

  if (!shouldSync) {
    return payload;
  }

  const participants = payload.participants.map((participant, index) => {
    if (index !== primaryIndex || !isEmpty(participant?.email)) {
      return participant;
    }

    return {
      ...participant,
      email: billingEmail,
      client: participant.client ?? true,
      supervisor: participant.supervisor ?? false,
    };
  });

  return { ...payload, participants };
}

function applyBookingDefaults(payload = {}) {
  const withContactDefault = {
    ...payload,
    contactDetails: {
      ...(payload.contactDetails || {}),
      contactDetailsSameAsBillingDetails:
        payload.contactDetails?.contactDetailsSameAsBillingDetails ?? true,
    },
  };

  return syncParticipantEmailFromBilling(withContactDefault);
}

function formatBillingAddress(payload) {
  const billing = payload.billingDetails || {};
  return [billing.address, billing.zipCode, billing.city, billing.countryCode].filter(Boolean).join(', ');
}

function hasDocumentBillingAddress(prefilledFromDocument) {
  return BILLING_ADDRESS_FIELDS.some((path) => prefilledFromDocument.includes(path));
}

function extractionHasBillingAddress(extractedFields = {}) {
  const billing = extractedFields.billingDetails || {};
  const participant = Array.isArray(extractedFields.participants) ? extractedFields.participants[0] : null;

  return BILLING_ADDRESS_FIELDS.some((path) => {
    const key = path.split('.')[1];
    return !isEmpty(billing[key]) || !isEmpty(participant?.[key]);
  });
}

function collectMissingFields(activeComponents, payload, prefilledFromDocument = [], extractedFields = null) {
  const types = new Set(activeComponents.map((component) => component.type));
  const missing = [];

  if (payload._sourceDocument && !payload._documentConfirmed) {
    missing.push('_documentConfirmed');
  }

  if (types.has('countryPicker') && isEmpty(payload.destinationCountry)) {
    missing.push('destinationCountry');
  }

  if (types.has('productPicker') && isEmpty(getValueByPath(payload, 'products.id'))) {
    if (payload._suggestedProductId && payload._productConfirmed !== true) {
      missing.push('_productConfirmed');
    } else {
      missing.push('products');
    }
  }

  if (types.has('billingDetails')) {
    const missingBilling = collectMissingPaths(payload, BILLING_FIELDS);
    const nonAddressMissing = missingBilling.filter((path) => !BILLING_ADDRESS_FIELDS.includes(path));
    missing.push(...nonAddressMissing);

    const anyAddressMissing = BILLING_ADDRESS_FIELDS.some((path) => isEmpty(getValueByPath(payload, path)));
    const addressFromDocument =
      hasDocumentBillingAddress(prefilledFromDocument) || extractionHasBillingAddress(extractedFields);

    if (anyAddressMissing) {
      missing.push(...BILLING_ADDRESS_FIELDS.filter((path) => isEmpty(getValueByPath(payload, path))));
    } else if (addressFromDocument && payload._billingAddressConfirmed !== true) {
      missing.push('_confirmBillingAddress');
    }
  }

  if (types.has('contactDetails')) {
    const sameAsBilling = payload.contactDetails?.contactDetailsSameAsBillingDetails;
    if (sameAsBilling !== true && sameAsBilling !== false) {
      missing.push('contactDetails.contactDetailsSameAsBillingDetails');
    } else if (!sameAsBilling) {
      missing.push(...collectMissingPaths(payload, CONTACT_FIELDS));
    }
  }

  if (types.has('participants')) {
    const participants = payload.participants;
    if (!Array.isArray(participants) || participants.length === 0) {
      missing.push('participants');
    } else if (!participants.some((participant) => participant?.email)) {
      missing.push('participants.email');
    }
  }

  if (types.has('hardCopy')) {
    const wantsHardCopy = payload.hardCopy?.hardCopy;
    if (wantsHardCopy !== true && wantsHardCopy !== false) {
      missing.push('hardCopy.hardCopy');
    } else if (wantsHardCopy === true) {
      if (payload.hardCopy?.expressShipping !== true && payload.hardCopy?.expressShipping !== false) {
        missing.push('hardCopy.expressShipping');
      }
    }
  }

  if (payload.hardCopy?.hardCopy === true && types.has('hardCopy')) {
    missing.push(...collectMissingPaths(payload, SHIPPING_FIELDS));
  }

  if (types.has('timeSlots') && isEmpty(payload.timeslots)) {
    missing.push('timeslots');
  }

  if (types.has('newsletter') && payload.newsletter !== true && payload.newsletter !== false) {
    missing.push('newsletter');
  }

  return missing;
}

export function resolveFormState(bookingForm, payload = {}, extractedFields = null) {
  let workingPayload = payload;
  let prefilledFromDocument = [];

  if (extractedFields && typeof extractedFields === 'object') {
    const shouldPrefillBilling =
      payload._documentConfirmed === true || !payload._sourceDocument;

    const fieldsToMerge =
      shouldPrefillBilling
        ? extractedFields
        : { destinationCountry: extractedFields.destinationCountry };

    const mergeResult = mergeExtractedIntoPayload(payload, fieldsToMerge);
    workingPayload = applyBookingDefaults(mergeResult.payload);
    prefilledFromDocument = mergeResult.prefilledFromDocument;
  } else {
    workingPayload = applyBookingDefaults(payload);
  }

  const activeComponents = [];

  for (const page of bookingForm.pages || []) {
    walkComponents(page.components, workingPayload, activeComponents);
  }

  const productTags = new Set();
  const autoProductIds = new Set();
  let timeslotLabel = null;

  for (const component of activeComponents) {
    if (component.type === 'productPicker' && Array.isArray(component.props?.tags)) {
      component.props.tags.forEach((tag) => productTags.add(tag));
    }

    if (component.type === 'singleProduct' && component.props?._product) {
      autoProductIds.add(component.props._product);
    }

    if (component.type === 'timeSlots' && component.props?.timeslotLabel) {
      timeslotLabel = component.props.timeslotLabel;
    }
  }

  const missingFields = collectMissingFields(
    activeComponents,
    workingPayload,
    prefilledFromDocument,
    extractedFields,
  );
  const requiresDocumentConfirmation = Boolean(
    workingPayload._sourceDocument && !workingPayload._documentConfirmed,
  );
  const billingAddressSummary = formatBillingAddress(workingPayload);
  const confirmBillingAddress =
    missingFields.includes('_confirmBillingAddress') && billingAddressSummary
      ? {
          field: '_confirmBillingAddress',
          addressSummary: billingAddressSummary,
          confirmQuestion: `Is this address correct: ${billingAddressSummary}?`,
        }
      : null;

  return {
    productTags: [...productTags],
    autoProductIds: [...autoProductIds],
    timeslotLabel,
    activeComponentTypes: activeComponents.map((component) => component.type),
    requiresDocumentConfirmation,
    effectivePayload: workingPayload,
    prefilledFromDocument,
    confirmBillingAddress,
    missingFields,
    nextQuestionField: missingFields[0] ?? null,
  };
}

export function resolveActiveComponents(components, payload) {
  return components.filter((component) => {
    if (!component.condition) return true;
    return evaluateCondition(component.condition, payload);
  });
}

export function stripInternalPayloadFields(payload) {
  const {
    _documentConfirmed,
    _sourceDocument,
    _suggestedProductId,
    _productConfirmed,
    _billingAddressConfirmed,
    ...rest
  } = payload;
  return rest;
}
