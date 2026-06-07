import { readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function submitAppointmentRequest() {
  const samplesDir = join(__dirname, "..", "samples");
  const [file1, file2] = await Promise.all([
    readFile(join(samplesDir, "nie-application-demo-joshua_timms.pdf")),
    readFile(join(samplesDir, "nie_personal_details.pdf")),
  ]);

  const form = new FormData();

  form.append("files", new File([file1], "nie-application-demo-joshua_timms.pdf", { type: "application/pdf" }));
  form.append("files", new File([file2], "nie_personal_details.pdf", { type: "application/pdf" }));

  const payload = {
    _bookingForm: "kmVXjYM937qB8JTYG2yH",
    language: "en",
    origin: "https://staging.notarity.com/#/my-companies/HpKfHmbViXxFEMzjtxln/appointment-requests",
    confirmedPrice: 580,
    hardCopy: { expressShipping: false, hardCopy: true },
    newsletter: false,
    mode: "debug",
    _appointmentRequestDraft: "vfniS9nfoq8nMpRqQj7Z",
    destinationCountry: "ES",
    products: [
      {
        id: "UpEJ7raQEKQKFhWn12r2",
        apostille: true,
        userInput: "",
        documentsNotReadyYet: false,
        needHelpDrafting: false,
        proofOfRepresentation: null,
        files: ["nie-application-demo-joshua_timms.pdf"],
      },
      {
        id: "xK5IkgPX1LTYdWLFzW8X",
        apostille: null,
        userInput: "",
        documentsNotReadyYet: false,
        needHelpDrafting: false,
        proofOfRepresentation: null,
        files: ["nie_personal_details.pdf"],
      },
    ],
    participants: [{ email: "joshua.timms@notarity.com", client: true, supervisor: false }],
    timeslots: ["xitTkTMC18R0ZfCNtqyW"],
    instantNotarisationSupported: false,
    instant: false,
    timezone: "Europe/Vienna",
    billingDetails: {
      firstName: "Joshua",
      lastName: "Timms",
      business: false,
      email: "joshua.timms@notarity.com",
      phoneNumber: "+12125550174",
      address: "5th Ave 350",
      zipCode: "10118",
      city: "New York",
      stateProvince: "NY",
      countryCode: "US",
    },
    contactDetails: {
      contactDetailsSameAsBillingDetails: true,
      firstName: "Joshua",
      lastName: "Timms",
      business: false,
      email: "joshua.timms@notarity.com",
      phoneNumber: "+12125550174",
    },
    shippingDetails: {
      shippingDetailsSameAsBillingDetails: false,
      firstName: "Joshua",
      lastName: "Timms",
      business: false,
      email: "joshua.timms@notarity.com",
      phoneNumber: "+12125550174",
      address: "Carrer de Mallorca 401",
      zipCode: "08013",
      city: "Barcelona",
      stateProvince: "CT",
      countryCode: "ES",
    },
    preferredNotary: "",
  };

  form.append("payload", JSON.stringify(payload));

  const response = await fetch("https://staging-api.notarity.com/appointment-requests", {
    method: "POST",
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language": "en-AT,en;q=0.9",
      "cache-control": "no-cache",
      referer: "https://staging.notarity.com/",
    },
    body: form,
  });

  const text = await response.text();
  console.log("Status:", response.status);
  try {
    console.log("Response:", JSON.parse(text));
  } catch {
    console.log("Response:", text);
  }
}

submitAppointmentRequest().catch(console.error);
