# Booking Form → Appointment Request Flow

This folder documents how a Notarity booking form is turned into a submitted
appointment request. The end goal is the `POST /appointment-requests` call in
[`submit-appointment-request.js`](./submit-appointment-request.js) — but that
payload can only be built by first **reading the booking form**, **resolving its
products**, and **picking a timeslot**.

> **Hackathon challenge:** reimagine this flow. The endpoints below are the raw
> material. The booking form is a declarative, page-based schema — your job is to
> render it, collect user input against it, and assemble a valid submission
> payload.

Base URL (staging): `https://staging-api.notarity.com`

---

## The flow at a glance

```
1. GET  /booking-form/slug?slug=<slug>      → form schema (pages, components, conditions)
2. GET  /products/tags?_tags=<tagId>        → product definitions referenced by productPickers
3. GET  /appointment-requests/timeslots     → available timeslots
4. POST /appointment-requests/price         → priced line items for the current selection
   ─────────────────────────────────────────────────────────────
5. POST /appointment-requests               → submit (multipart: payload JSON + files)
```

Steps 1–3 are **reads** that give you everything needed to construct the
selection. Step 4 prices that selection server-side (don't compute totals
yourself — see below). The form schema is the source of truth: it tells you which
products to fetch (via tags), which timeslot label to query, and which fields the
user must fill in.

---

## 1. Fetch the booking form

```bash
curl 'https://staging-api.notarity.com/booking-form/slug?slug=start-vienna-hackathon'
```

Returns the form definition. Key fields:

| Field             | Meaning                                                          |
| ----------------- | --------------------------------------------------------------- |
| `id`              | The booking form id → becomes `_bookingForm` in the payload     |
| `_company`        | Owning company id                                               |
| `options`         | `shippingFee`, `expressShippingFee` (in **cents**), `logo`, etc. |
| `pages[]`         | Ordered booking form pages, each with `components[]`                  |

### How the form is structured

The form is a tree of **components**. Each component has a `type`, optional
`props`, and an `accessor` (the key it writes into the submission payload).

For `start-vienna-hackathon` the four pages map directly to the payload:

| Page | Title          | Components (types)                                              | Produces payload keys                              |
| ---- | -------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| 1    | Product        | `countryPicker`, `condition`, `productPicker`, `singleProduct` | `destinationCountry`, `products[]`                 |
| 2    | Appointment    | `participants`, `condition`, `timeSlots`                       | `participants[]`, `timeslots[]`                    |
| 3    | Contact Info   | `billingDetails`, `contactDetails`, `hardCopy`, `shippingDetails` | `billingDetails`, `contactDetails`, `hardCopy`, `shippingDetails` |
| 4    | Summary        | `summary`, `preferredNotary`, `newsletter`, `confirmTC`        | `preferredNotary`, `newsletter`                    |

### Conditions drive what's shown

`condition` components show/hide child components based on prior answers. They
carry `condition` (operator), `compare` (the field to test), `value`, plus
`components` (shown when true) and `elseComponents` (shown when false).

Operators seen in this form: `ISDEFINED`, `INCLUDES`, `EQUAL`, `INTERSECTS`,
`ISTRUE`.

The product logic on page 1 reads like this:

```
countryPicker → destinationCountry
└─ if destinationCountry ISDEFINED
   └─ if destinationCountry INCLUDES ["AT"]
      → productPicker(tags: ["5DVjVha92EJnyyO6138f"])      // Austria products
      else:
      └─ if destinationCountry EQUAL "ES"
         → productPicker(tags: ["HdippWIH77AdMywneldY", "t7t78Pbrs5nEyHTqDuQv"])
         └─ if products.id INTERSECTS ["UpEJ7raQEKQKFhWn12r2"]   // NIE application chosen
            → singleProduct(_product: "xK5IkgPX1LTYdWLFzW8X")    // auto-add NIE Personal Data
         else:
         → productPicker(tags: ["t7t78Pbrs5nEyHTqDuQv"])
```

So the example payload (`destinationCountry: "ES"`) is the result of: pick Spain →
the `HdippWIH77AdMywneldY` + `t7t78Pbrs5nEyHTqDuQv` product pickers appear → user
selects **NIE number application** (`UpEJ7raQEKQKFhWn12r2`) → that selection
triggers the `singleProduct` rule, auto-adding **NIE Personal Data**
(`xK5IkgPX1LTYdWLFzW8X`).

The page-2 condition selects the timeslot label: Austria
(`destinationCountry EQUAL "AT"`) uses `timeslotLabel:
"yYD129MD1NizqtQKkLqN"`, everything else uses `"29sfIoZ9WgFQl8XjbKPu"`. The
label is an opaque id — read it straight from the `timeSlots` component's
`props.timeslotLabel` and pass it through to step 3; don't hardcode it.

---

## 2. Fetch products by tag

`productPicker` components reference products by **tag**, not by id. Resolve each
tag to its product list:

```bash
curl 'https://staging-api.notarity.com/products/tags?_tags=t7t78Pbrs5nEyHTqDuQv'
```

Returns an array of product objects. Pass multiple tags by repeating/joining the
`_tags` param as the picker specifies. Relevant fields per product:

| Field                          | Meaning                                                        |
| ------------------------------ | -------------------------------------------------------------- |
| `id`                           | Product id → goes into `products[].id` in the payload          |
| `title` / `description`        | Localised (`en` / `de` / `es`)                                 |
| `baseFee`, `pricePerDoc`       | Prices in **cents** (`55000` = €550)                           |
| `includedDocs`                 | Docs included in `baseFee` before `pricePerDoc` applies        |
| `showApostille` / `apostilleRequired` / `apostillePrice` | Whether the apostille toggle is shown/forced + its price |
| `showFileUpload` / `fileUploadRequired` | Whether documents may/must be uploaded                |
| `showUserInput` / `userInputRequired`   | Free-text input on the product                        |
| `showNeedHelpDrafting` / `draftingFee`  | Optional drafting help + its price                    |
| `showProofOfRepresentation` / `proofOfRepresentationPrice` | Proof-of-representation toggle             |
| `hardCopySupported`            | Whether a physical hard copy can be shipped for this product   |
| `instantNotarisationSupported` | Feeds `instantNotarisationSupported` / `instant` in the payload |

### Products used in the example

| Product                       | Tag                    | id                       | baseFee   |
| ----------------------------- | ---------------------- | ------------------------ | --------- |
| NIE number application        | `HdippWIH77AdMywneldY` | `UpEJ7raQEKQKFhWn12r2`   | 55000 (€550), apostille required |
| NIE Personal Data             | _(auto via singleProduct)_ | `xK5IkgPX1LTYdWLFzW8X` | 0 (free, file upload required)   |

Each selected product becomes an entry in the payload `products[]`:

```jsonc
{
  "id": "UpEJ7raQEKQKFhWn12r2",
  "apostille": true,              // honour showApostille / apostilleRequired
  "userInput": "",                // when showUserInput
  "documentsNotReadyYet": false,
  "needHelpDrafting": false,      // when showNeedHelpDrafting
  "proofOfRepresentation": null,  // when showProofOfRepresentation
  "files": ["nie-application-demo-joshua_timms.pdf"]  // names must match uploaded files
}
```

> **`files` linkage:** the strings in `products[].files` must exactly match the
> filenames appended to the multipart `files` field in step 5.

---

## 3. Fetch timeslots

```bash
curl 'https://staging-api.notarity.com/appointment-requests/timeslots?_timeslotLabel=29sfIoZ9WgFQl8XjbKPu&startDate=2026-06-05T00:00:00.000Z&endDate=2026-06-12T00:00:00.000Z'
```

Params:

| Param             | Notes                                                            |
| ----------------- | ---------------------------------------------------------------- |
| `_timeslotLabel`  | Take it verbatim from the `timeSlots` component's `props.timeslotLabel` — an opaque id, **not** a friendly name. For this form: `29sfIoZ9WgFQl8XjbKPu` (non-AT) or `yYD129MD1NizqtQKkLqN` (AT). |
| `startDate` / `endDate` | ISO‑8601 window to search                                  |

Returns an array of available slots (typically 10‑minute increments). Each `id`
goes into the payload `timeslots[]`:

```jsonc
{
  "startTime": "2026-06-08T06:00:00.000Z",
  "endTime":   "2026-06-08T06:10:00.000Z",
  "available": 2,
  "taken": 0,
  "_timeslotLabel": "29sfIoZ9WgFQl8XjbKPu",
  "deleted": false,
  "id": "iiCQHiAzdfvEwx1gshtp"
}
```

---

## 4. Price the selection

Don't compute the total client-side — `POST /appointment-requests/price` returns
the authoritative, itemised pricing for the current selection. See
[`price.js`](./price.js) for a runnable example.

```bash
curl 'https://staging-api.notarity.com/appointment-requests/price' \
  -X POST -H 'content-type: application/json' \
  -d '{ ...the same JSON payload you would submit in step 5... }'
```

The request body is the **same payload object** as the submission (step 5), sent
as plain `application/json` (no files / no multipart). The fields that actually
move the price are `products[]` (ids + their `apostille` / `needHelpDrafting` /
`proofOfRepresentation` toggles), `hardCopy`, and `destinationCountry`.

The response is an **array of line items**, each priced in **cents**:

```jsonc
[
  { "name": "Nie number application", "_product": "UpEJ7raQEKQKFhWn12r2", "amount": 1, "pricePerUnit": 55000, "net": 55000, "identifier": 1, "pricingEnabled": true },
  { "name": "NIE Personal Data",      "_product": "xK5IkgPX1LTYdWLFzW8X", "amount": 1, "pricePerUnit": 0,     "net": 0,     "identifier": 2, "pricingEnabled": true },
  { "name": "NIE Personal Data - Additional Documents", "_product": "xK5IkgPX1LTYdWLFzW8X", "amount": 1, "pricePerUnit": 0, "net": 0, "identifier": 2 },
  { "name": "Hard Copy (including shipping)", "amount": 1, "pricePerUnit": 3000, "net": 3000, "identifier": 3, "pricingEnabled": true }
]
```

| Field          | Meaning                                                          |
| -------------- | ---------------------------------------------------------------- |
| `name`         | Human-readable line label                                        |
| `_product`     | Source product id (absent on non-product lines like shipping)    |
| `amount`       | Quantity (e.g. number of documents)                              |
| `pricePerUnit` | Unit price in **cents**                                          |
| `net`          | Line total in **cents** (`pricePerUnit × amount`)                |
| `identifier`   | Groups lines belonging to the same product/section              |
| `pricingEnabled` | Whether this line contributes a real charge                    |

**`confirmedPrice` = sum of all `net` values, converted to euros.** For the
example: `55000 + 0 + 0 + 3000 = 58000 cents = €580` → `confirmedPrice: 580`,
which is what step 5 sends back. Use this call to render the price breakdown to
the user and to derive the `confirmedPrice` you submit.

### Run it

```bash
node price.js
```

---

## 5. Submit the appointment request

Assemble everything into a multipart `POST /appointment-requests`. See
[`submit-appointment-request.js`](./submit-appointment-request.js) for a runnable
example.

The request body is `multipart/form-data` with two kinds of parts:

- One `files` part **per uploaded document** (the PDFs).
- One `payload` part containing the JSON below, stringified.

### Where each payload field comes from

| Payload field                  | Source                                                            |
| ------------------------------ | ----------------------------------------------------------------- |
| `_bookingForm`                 | Booking form `id` (step 1)                                        |
| `destinationCountry`           | `countryPicker` answer                                            |
| `products[]`                   | Selected products (step 2) + their per-product options            |
| `participants[]`               | `participants` component                                          |
| `timeslots[]`                  | Chosen timeslot ids (step 3)                                      |
| `billingDetails`               | `billingDetails` component                                        |
| `contactDetails`               | `contactDetails` component (`...SameAsBillingDetails` shortcut)   |
| `hardCopy`                     | `hardCopy` component (`{ hardCopy, expressShipping }`)            |
| `shippingDetails`              | `shippingDetails` (shown only when `hardCopy.hardCopy` is true)   |
| `newsletter`, `preferredNotary`| Summary page components                                          |
| `confirmedPrice`               | Sum of the step‑4 price line items (`net`), in **euros**         |
| `instant` / `instantNotarisationSupported` | Derived from product capabilities                    |
| `language`, `timezone`, `origin` | Client context                                                 |
| `_appointmentRequestDraft`     | Draft id created during the session (autosave of the in-progress form) |
| `mode`                         | `"debug"` for testing                                            |

### `confirmedPrice`

Get this from the **step‑4 price endpoint**, not by adding up product fields
yourself: sum the `net` of every returned line item and convert cents → euros.
For the example that's `58000 cents → €580`. Submitting the
server-derived value keeps the client in sync with how the backend prices
apostilles, drafting, shipping and per-document charges.

### Run it

```bash
node submit-appointment-request.js
```

Expects the two demo PDFs (`nie-application-demo-joshua_timms.pdf`,
`nie_personal_details.pdf`) to sit alongside the script. On success the endpoint
returns the created appointment request as JSON.
