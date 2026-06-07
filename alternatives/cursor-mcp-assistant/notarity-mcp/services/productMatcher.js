function productTitle(product) {
  if (typeof product.title === 'string') return product.title;
  return product.title?.en || product.title?.de || product.title?.es || '';
}

function buildSearchText(extractedFields = {}) {
  const parts = [];

  if (Array.isArray(extractedFields.products)) {
    parts.push(...extractedFields.products.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))));
  }

  for (const value of Object.values(extractedFields)) {
    if (typeof value === 'string') parts.push(value);
  }

  return parts.join(' ').toLowerCase();
}

const MATCHERS = [
  {
    patterns: [
      /power of attorney/i,
      /special power/i,
      /poder de representaci/i,
      /poder/i,
      /vollmacht/i,
      /shareholder/i,
      /grantor/i,
      /representative/i,
    ],
    titleMatch: /signature notarisation/i,
    reason: 'A Power of Attorney is notarised by certifying the signatory’s identity and signature.',
  },
  {
    patterns: [/certified copy/i, /beglaubigte kopie/i, /copia certificada/i],
    titleMatch: /certified copy/i,
    reason: 'Your document is for a certified copy.',
  },
  {
    patterns: [
      /certification of facts/i,
      /registerauszug/i,
      /company excerpt/i,
      /proof of representation/i,
      /organigram/i,
      /bescheinigung von tatsachen/i,
    ],
    titleMatch: /certification of facts/i,
    reason: 'This looks like a certification-of-facts request.',
  },
  {
    patterns: [/nie/i, /número de identidad/i, /foreigner identification/i, /nie application/i],
    titleMatch: /nie number application/i,
    reason: 'This is an NIE application for Spain.',
  },
  {
    patterns: [/flexco/i, /gesellschaftsvertrag/i, /incorporation/i, /company formation/i],
    titleMatch: /incorporation|flexco|gmbh/i,
    reason: 'This looks like a company incorporation document.',
  },
];

function findByTitleMatch(products, titleMatch) {
  return products.find((product) => titleMatch.test(productTitle(product).toLowerCase()));
}

export function suggestProduct({ extractedFields = {}, products = [] } = {}) {
  const text = buildSearchText(extractedFields);

  for (const rule of MATCHERS) {
    if (!rule.patterns.some((pattern) => pattern.test(text))) continue;

    const match = findByTitleMatch(products, rule.titleMatch);
    if (!match) continue;

    const title = productTitle(match);
    return {
      productId: match.id,
      title,
      reason: rule.reason,
      confidence: 'high',
      confirmQuestion: `Based on your document, I recommend **${title}**. Shall I proceed with that?`,
      needsUserChoice: false,
    };
  }

  if (products.length === 1) {
    const title = productTitle(products[0]);
    return {
      productId: products[0].id,
      title,
      reason: 'This is the only service available for your selected country.',
      confidence: 'medium',
      confirmQuestion: `I recommend **${title}** for your document. Shall I proceed with that?`,
      needsUserChoice: false,
    };
  }

  const signatureProduct = findByTitleMatch(products, /signature notarisation/i);
  if (signatureProduct && /attorney|poa|poder|vollmacht|grantor|sign/i.test(text)) {
    const title = productTitle(signatureProduct);
    return {
      productId: signatureProduct.id,
      title,
      reason: 'This document appears to require signature notarisation.',
      confidence: 'medium',
      confirmQuestion: `Based on your document, I recommend **${title}**. Shall I proceed with that?`,
      needsUserChoice: false,
    };
  }

  return {
    confidence: 'low',
    needsUserChoice: true,
    confirmQuestion: null,
    alternatives: products.map((product) => ({
      id: product.id,
      title: productTitle(product),
      description: product.description?.en || product.description || '',
    })),
  };
}
