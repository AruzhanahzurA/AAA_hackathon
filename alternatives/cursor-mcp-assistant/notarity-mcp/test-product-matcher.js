import assert from 'node:assert/strict';
import { suggestProduct } from './services/productMatcher.js';

const lithuaniaProducts = [
  { id: 'ujwBkZleJLPEzByCnPCS', title: { en: 'Signature notarisation' } },
  { id: 'copy-id', title: { en: 'Certified copy' } },
  { id: 'facts-id', title: { en: 'Certification of Facts' } },
];

const poaExtraction = {
  documentType: 'Power of Attorney',
  destinationCountry: 'LT',
  products: ['Power of Attorney for shareholder representation'],
};

const suggestion = suggestProduct({ extractedFields: poaExtraction, products: lithuaniaProducts });

assert.equal(suggestion.productId, 'ujwBkZleJLPEzByCnPCS');
assert.equal(suggestion.needsUserChoice, false);
assert.match(suggestion.confirmQuestion, /Signature notarisation/i);

console.log('test-product-matcher: ok');
