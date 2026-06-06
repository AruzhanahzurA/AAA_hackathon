import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from io import BytesIO
from zoneinfo import ZoneInfo

import requests
import streamlit as st

try:
    from openai import OpenAI
except ImportError:  # pragma: no cover
    OpenAI = None

try:
    from pypdf import PdfReader
except ImportError:  # pragma: no cover
    PdfReader = None


BASE_URL = "https://staging-api.notarity.com"
BOOKING_FORM_SLUG = "start-vienna-hackathon"
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4.1")
DEFAULT_EMAIL = "asetkabdula@gmail.com"
COUNTRY_ALIASES = {
    "spain": "ES",
    "espana": "ES",
    "espagna": "ES",
    "spanish": "ES",
    "es": "ES",
    "austria": "AT",
    "osterreich": "AT",
    "vienna": "AT",
    "wien": "AT",
    "at": "AT",
    "lithuania": "LT",
    "lt": "LT",
    "germany": "DE",
    "de": "DE",
    "united states": "US",
    "usa": "US",
    "us": "US",
}

st.set_page_config(page_title="Notarity Copilot", page_icon="NC", layout="wide")


def default_state():
    return {
        "intent": None,
        "destinationCountry": None,
        "participantName": None,
        "participantEmail": None,
        "participantPhone": None,
        "documentReady": None,
        "documentsNotReadyYet": False,
        "hardCopy": None,
        "expressShipping": False,
        "shippingDetails": None,
        "billingDetails": None,
        "contactDetails": None,
        "selectedProductIds": [],
        "timeslotId": None,
        "confirmedPrice": None,
        "language": "en",
        "timezone": "Europe/Vienna",
        "contactDetailsSameAsBilling": True,
        "shippingDetailsSameAsBilling": True,
        "preferredNotary": None,
    }


def init_session():
    st.session_state.setdefault(
        "messages",
        [
            {
                "role": "assistant",
                "content": "What do you need help with? You can upload a document, or describe what you need if you do not have one yet.",
            }
        ],
    )
    st.session_state.setdefault("booking_state", default_state())
    st.session_state.setdefault("uploaded_files", [])
    st.session_state.setdefault("document_text", "")
    st.session_state.setdefault("booking_form_response", None)
    st.session_state.setdefault("products_response", None)
    st.session_state.setdefault("timeslot_response", None)
    st.session_state.setdefault("price_response", None)
    st.session_state.setdefault("submit_response", None)
    st.session_state.setdefault("last_llm_json", None)
    st.session_state.setdefault("llm_error", None)
    st.session_state.setdefault("llm_source", None)
    st.session_state.setdefault("submit_confirmation_requested", False)
    st.session_state.setdefault("offered_timeslots", [])
    st.session_state.setdefault("shown_timeslot_count", 0)
    st.session_state.setdefault("pending_document_review", False)
    st.session_state.setdefault("document_review_started", False)
    st.session_state.setdefault("asking_field", None)
    st.session_state.setdefault("confirming_field", None)
    st.session_state.setdefault("confirming_value", None)


def css():
    st.markdown(
        """
        <style>
        .stApp { background: radial-gradient(circle at top left, rgba(92,242,178,.12), transparent 30%), linear-gradient(135deg,#07121f,#111827); color: #f7fbff; }
        header, .stDeployButton { display: none !important; }
        .block-container { padding-top: 2rem; max-width: 1240px; }
        h1,h2,h3 { color: white; letter-spacing: -.04em; }
        p,li,label,.stMarkdown { color: #dbe6f2; }
        .hero,.card { border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.075); border-radius: 24px; padding: 22px; box-shadow: 0 24px 80px rgba(0,0,0,.22); }
        .hero-title { font-size: clamp(2rem, 5vw, 4.4rem); line-height: .96; font-weight: 850; letter-spacing: -.06em; color: white; }
        .eyebrow { color: #5cf2b2; text-transform: uppercase; letter-spacing: .16em; font-size: .76rem; font-weight: 800; }
        .pill { display: inline-flex; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 7px 11px; margin: 4px 5px 4px 0; background: rgba(255,255,255,.07); color: #eaf2fb; font-size: .86rem; }
        .ok { color: #5cf2b2; font-weight: 800; }
        .warn { color: #ffd166; font-weight: 800; }
        .line { display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,.12); padding: 8px 0; }
        .total { display: flex; justify-content: space-between; padding-top: 12px; font-size: 1.35rem; font-weight: 850; color: white; }
        .stButton > button { border-radius: 999px; border: 1px solid rgba(92,242,178,.55); background: linear-gradient(135deg,#5cf2b2,#70a7ff); color: #06111d; font-weight: 800; }
        </style>
        """,
        unsafe_allow_html=True,
    )


def money(value):
    return f"EUR {value:,.0f}"


def api_json(method, path, **kwargs):
    response = requests.request(method, f"{BASE_URL}{path}", timeout=45, **kwargs)
    try:
        body = response.json()
    except ValueError:
        body = response.text
    return {"status": response.status_code, "body": body, "text": response.text}


def get_booking_form():
    response = st.session_state.booking_form_response
    if response and response.get("status") == 200:
        return response["body"]
    response = api_json("GET", "/booking-form/slug", params={"slug": BOOKING_FORM_SLUG})
    st.session_state.booking_form_response = response
    return response["body"] if response.get("status") == 200 else None


def fetch_products(tags):
    if not tags:
        return []
    response = api_json("GET", "/products/tags", params={"_tags": tags})
    st.session_state.products_response = response
    return response["body"] if response.get("status") in [200, 201] and isinstance(response["body"], list) else []


def fetch_timeslots_window(timeslot_label, start_offset_days, end_offset_days):
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start = base + timedelta(days=start_offset_days)
    end = base + timedelta(days=end_offset_days)
    response = api_json(
        "GET",
        "/appointment-requests/timeslots",
        params={
            "_timeslotLabel": timeslot_label,
            "startDate": start.isoformat().replace("+00:00", "Z"),
            "endDate": end.isoformat().replace("+00:00", "Z"),
        },
    )
    st.session_state.timeslot_response = response
    return response["body"] if response.get("status") == 200 and isinstance(response["body"], list) else []


def slot_is_available(slot):
    if slot.get("deleted") or not slot.get("id") or not slot.get("startTime"):
        return False
    available = slot.get("available") or 0
    taken = slot.get("taken") or 0
    return available > taken or available > 0


def fetch_available_timeslots(timeslot_label):
    windows = [(start, min(start + 7, 60)) for start in range(0, 60, 7)]
    for start_offset, end_offset in windows:
        slots = fetch_timeslots_window(timeslot_label, start_offset, end_offset)
        available = sorted([slot for slot in slots if slot_is_available(slot)], key=lambda item: item.get("startTime", ""))
        if available:
            st.session_state.offered_timeslots = available
            st.session_state.shown_timeslot_count = 0
            return available, start_offset, end_offset
    st.session_state.offered_timeslots = []
    return [], 0, 60


def price_appointment(payload):
    return api_json(
        "POST",
        "/appointment-requests/price",
        headers={"accept": "application/json, text/plain, */*", "content-type": "application/json", "origin": "https://staging.notarity.com", "referer": "https://staging.notarity.com/"},
        json=payload,
    )


def submit_appointment(payload, files_payload):
    response = requests.post(
        f"{BASE_URL}/appointment-requests",
        headers={"accept": "application/json, text/plain, */*", "referer": "https://staging.notarity.com/"},
        data={"payload": json.dumps(payload)},
        files=[("files", item) for item in files_payload],
        timeout=60,
    )
    try:
        body = response.json()
    except ValueError:
        body = response.text
    return {"status": response.status_code, "body": body, "text": response.text}


def extract_pdf_text(file_bytes):
    if not file_bytes or PdfReader is None:
        return ""
    try:
        reader = PdfReader(BytesIO(file_bytes))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception:
        return ""


def compact(text, limit=12000):
    return " ".join((text or "").split())[:limit]


def call_openai_json(api_key, prompt, temperature=0.15):
    client = OpenAI(api_key=api_key)
    last_error = None
    for attempt in range(3):
        try:
            response = client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": "You are a JSON-only assistant. Always respond with valid JSON matching the requested shape."},
                    {"role": "user", "content": json.dumps(prompt)},
                ],
                temperature=temperature,
                response_format={"type": "json_object"},
            )
            return json.loads(response.choices[0].message.content), None
        except Exception as error:
            last_error = error
            if "429" not in str(error) and "rate_limit" not in str(error).lower() or attempt == 2:
                break
            time.sleep(1 + attempt)
    return None, last_error


def normalize_country(value):
    if not value:
        return value
    text = str(value).strip()
    if len(text) == 2 and text.isalpha():
        return text.upper()
    lowered = text.lower().replace("ö", "o").replace("ä", "a").replace("ü", "u").replace("ß", "ss")
    for alias, code in COUNTRY_ALIASES.items():
        if alias in lowered:
            return code
    return text


def normalize_country_strict(value):
    if not value:
        return value
    text = str(value).strip()
    if len(text) == 2 and text.isalpha():
        return text.upper()
    lowered = text.lower().replace("ö", "o").replace("ä", "a").replace("ü", "u").replace("ß", "ss")
    city_aliases = {"vienna", "wien"}
    for alias, code in COUNTRY_ALIASES.items():
        if alias not in city_aliases and alias in lowered:
            return code
    return None


def parse_address_details(value):
    text = (value or "").strip()
    if not text:
        return {}
    parts = [part.strip() for part in text.split(",") if part.strip()]
    details = {"address": parts[0] if parts else text}
    remaining = parts[1:] if len(parts) > 1 else []

    for index in range(len(remaining) - 1, -1, -1):
        country = normalize_country_strict(remaining[index])
        if country:
            details["countryCode"] = country
            remaining.pop(index)
            break

    for index, part in enumerate(list(remaining)):
        match = re.search(r"\b\d{4,6}\b", part)
        if match:
            details["zipCode"] = match.group(0)
            city = (part[: match.start()] + part[match.end() :]).strip(" ,-;")
            if city:
                details["city"] = city
            remaining.pop(index)
            break

    if "city" not in details and remaining:
        details["city"] = remaining[-1]
    return details


def parse_yes_no(value):
    normalized = (value or "").strip().lower()
    if normalized in ["yes", "y", "true", "sure", "ok", "okay", "i do", "correct"]:
        return True
    if normalized in ["no", "n", "false", "not", "nope", "i don't", "i do not"]:
        return False
    return None


def set_state_path(path, value):
    if not path or value in [None, "", [], {}]:
        return
    state = st.session_state.booking_state
    if path == "destinationCountry":
        value = normalize_country(value)
    if path in ["hardCopy", "expressShipping", "contactDetailsSameAsBilling", "shippingDetailsSameAsBilling"]:
        parsed = parse_yes_no(value) if isinstance(value, str) else value
        if parsed is None:
            return
        value = parsed
    if "." not in path:
        if path in state:
            state[path] = value
        return
    root, field = path.split(".", 1)
    if root not in state:
        return
    current = state.get(root) or {}
    if not isinstance(current, dict):
        current = {}
    if field == "address":
        current.update(parse_address_details(value))
    else:
        current[field] = normalize_country(value) if field == "countryCode" else value
    state[root] = current


def localized(value):
    if isinstance(value, dict):
        return value.get("en") or value.get("de") or value.get("es") or next(iter(value.values()), "")
    return value or ""


def get_field(obj, path):
    if path in ["products.id", "products"]:
        return st.session_state.booking_state.get("selectedProductIds", [])
    current = st.session_state.booking_state
    for part in (path or "").split("."):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def condition_value(component, key):
    return component.get(key) if key in component else (component.get("props") or {}).get(key)


def evaluate_condition(component):
    operator = condition_value(component, "condition")
    compare = condition_value(component, "compare")
    expected = condition_value(component, "value")
    actual = get_field(st.session_state.booking_state, compare)
    if operator == "ISDEFINED":
        return actual not in [None, "", [], {}]
    if operator == "INCLUDES":
        expected_list = expected if isinstance(expected, list) else [expected]
        if isinstance(actual, list):
            return any(item in actual for item in expected_list)
        return actual in expected_list
    if operator == "EQUAL":
        return actual == expected
    if operator == "INTERSECTS":
        expected_list = expected if isinstance(expected, list) else [expected]
        actual_list = actual if isinstance(actual, list) else [actual]
        return any(item in expected_list for item in actual_list)
    if operator == "ISTRUE":
        return bool(actual) is True
    return False


def visible_components(components):
    visible = []
    for component in components or []:
        if component.get("type") == "condition":
            props = component.get("props") or {}
            branch = (component.get("components") or props.get("components")) if evaluate_condition(component) else (component.get("elseComponents") or props.get("elseComponents"))
            visible.extend(visible_components(branch or []))
        else:
            visible.append(component)
            nested = component.get("components") or (component.get("props") or {}).get("components")
            visible.extend(visible_components(nested or []))
    return visible


def all_visible_components():
    form = get_booking_form()
    if not form:
        return []
    components = []
    for page in form.get("pages", []):
        components.extend(visible_components(page.get("components", [])))
    return components


def product_tags_from_schema():
    tags = []
    for component in all_visible_components():
        if component.get("type") == "productPicker":
            props = component.get("props") or {}
            values = props.get("tags") or props.get("_tags") or component.get("tags") or component.get("_tags") or []
            tags.extend(values if isinstance(values, list) else [values])
    return list(dict.fromkeys([tag for tag in tags if tag]))


def auto_product_ids_from_schema():
    ids = []
    for component in all_visible_components():
        if component.get("type") == "singleProduct":
            props = component.get("props") or {}
            product_id = props.get("_product") or component.get("_product")
            if product_id:
                ids.append(product_id)
    return list(dict.fromkeys(ids))


def allowed_products():
    products = fetch_products(product_tags_from_schema())
    auto_ids = set(auto_product_ids_from_schema())
    selected = set(st.session_state.booking_state.get("selectedProductIds", []))
    result = []
    for product in products:
        result.append(
            {
                "id": product.get("id"),
                "title": localized(product.get("title")),
                "description": localized(product.get("description")),
                "fileUploadRequired": product.get("fileUploadRequired"),
                "showFileUpload": product.get("showFileUpload"),
                "apostilleRequired": product.get("apostilleRequired"),
                "showApostille": product.get("showApostille"),
                "hardCopySupported": product.get("hardCopySupported"),
                "selected": product.get("id") in selected,
                "autoAdded": product.get("id") in auto_ids,
                "raw": product,
            }
        )
    for product_id in auto_ids:
        if product_id not in [item["id"] for item in result]:
            result.append({"id": product_id, "title": "Auto-added product", "description": "Added by booking form condition", "autoAdded": True, "raw": {"id": product_id}})
    return result


def selected_product_titles():
    selected = set(st.session_state.booking_state.get("selectedProductIds") or [])
    titles = []
    for product in allowed_products():
        if product.get("id") in selected or product.get("autoAdded"):
            titles.append(product.get("title") or "required product")
    return titles


def products_need_selection():
    return bool(allowed_products()) and not st.session_state.booking_state.get("selectedProductIds")


def timeslot_label_from_schema():
    for component in all_visible_components():
        if component.get("type") == "timeSlots":
            props = component.get("props") or {}
            return props.get("timeslotLabel") or component.get("timeslotLabel")
    return None


def resolve_timeslot_label():
    schema_label = timeslot_label_from_schema()
    if schema_label:
        return schema_label
    country = normalize_country(st.session_state.booking_state.get("destinationCountry"))
    if country == "AT":
        return "yYD129MD1NizqtQKkLqN"
    if country:
        return "29sfIoZ9WgFQl8XjbKPu"
    return None


def schema_summary():
    components = all_visible_components()
    return {
        "visibleComponentTypes": [component.get("type") for component in components],
        "productPickerTags": product_tags_from_schema(),
        "timeslotLabelAvailable": bool(timeslot_label_from_schema()),
    }


def uploaded_file_parts():
    return [(file.name, file.getvalue(), "application/pdf") for file in st.session_state.uploaded_files or []]


def missing_fields():
    state = st.session_state.booking_state
    missing = []
    if not state.get("intent"):
        missing.append("intent")
    if not state.get("destinationCountry"):
        missing.append("destinationCountry")
    if not product_payloads():
        missing.append("productSelection")
    if not state.get("participantName"):
        missing.append("participantName")
    if not state.get("participantEmail"):
        missing.append("participantEmail")
    if not state.get("participantPhone"):
        missing.append("participantPhone")
    if not state.get("timeslotId"):
        missing.append("timeslotId")
    billing = state.get("billingDetails") or {}
    if not billing.get("lastName"):
        missing.append("billingDetails.lastName")
    if not billing.get("address"):
        missing.append("billingDetails.address")
    if not billing.get("zipCode"):
        missing.append("billingDetails.zipCode")
    if not billing.get("city"):
        missing.append("billingDetails.city")
    if not billing.get("countryCode"):
        missing.append("billingDetails.countryCode")
    if state.get("hardCopy") is None:
        missing.append("hardCopy")
    if state.get("hardCopy") and not state.get("shippingDetailsSameAsBilling") and not state.get("shippingDetails"):
        missing.append("shippingDetails")
    return missing


def offered_timeslot_options():
    return st.session_state.offered_timeslots or []


def format_slot_time(iso_value):
    try:
        dt = datetime.fromisoformat(iso_value.replace("Z", "+00:00"))
        local = dt.astimezone(ZoneInfo("Europe/Vienna"))
        return local.strftime("%A, %B %d at %H:%M Vienna time")
    except Exception:
        return iso_value or "available time"


def format_timeslots(slots, start_offset=0, end_offset=7):
    if not slots:
        return "I could not find an available appointment in the next 60 days. Would you like to continue without choosing a time for now, or should we try a different appointment setup?"
    intro = "I found the earliest available appointment times:"
    if start_offset >= 7:
        intro = "This week appears to be fully booked, but I found openings later:"
    elif start_offset > 0:
        intro = "I found openings a little later:"
    lines = [intro]
    visible = slots[:12]
    st.session_state.shown_timeslot_count = len(visible)
    for index, slot in enumerate(visible, start=1):
        lines.append(f"{index}. {format_slot_time(slot.get('startTime'))}")
    if len(slots) > len(visible):
        lines.append("I found more times too. Say 'show more' if you want later options.")
    lines.append("Which one works best for you?")
    return "\n".join(lines)


def user_asks_for_times(text):
    normalized = (text or "").lower()
    return any(phrase in normalized for phrase in ["slots", "times", "availability", "appointments", "schedule", "when are you available"])


def user_asks_show_more(text):
    normalized = (text or "").lower()
    return any(phrase in normalized for phrase in ["show more", "more times", "more slots", "later options", "more options"])


def format_more_timeslots():
    slots = offered_timeslot_options()
    start = st.session_state.shown_timeslot_count or 0
    next_slots = slots[start : start + 12]
    if not next_slots:
        return "I have shown all available times I found in this search window."
    lines = ["Here are more available appointment times:"]
    for index, slot in enumerate(next_slots, start=start + 1):
        lines.append(f"{index}. {format_slot_time(slot.get('startTime'))}")
    st.session_state.shown_timeslot_count = start + len(next_slots)
    if len(slots) > st.session_state.shown_timeslot_count:
        lines.append("Say 'show more' if you want to see additional times.")
    lines.append("Which one works best for you?")
    return "\n".join(lines)


def parse_timeslot_choice(text):
    choice = (text or "").strip().lower()
    digits = "".join(char for char in choice if char.isdigit())
    if digits:
        number = int(digits)
        if 1 <= number <= 99:
            return number - 1
    mapping = {
        "1": 0,
        "first": 0,
        "first one": 0,
        "one": 0,
        "2": 1,
        "second": 1,
        "second one": 1,
        "two": 1,
        "3": 2,
        "third": 2,
        "third one": 2,
        "three": 2,
        "4": 3,
        "fourth": 3,
        "four": 3,
        "5": 4,
        "fifth": 4,
        "five": 4,
    }
    if choice in mapping:
        return mapping[choice]
    for token, index in mapping.items():
        if f" {token} " in f" {choice} ":
            return index
    return None


def user_confirmed_submit(text, llm_result):
    if llm_result.get("userConfirmedSubmit") is True:
        return True
    normalized = (text or "").lower()
    return st.session_state.submit_confirmation_requested and any(
        phrase in normalized for phrase in ["yes", "submit", "confirm", "go ahead", "send it", "book it"]
    )


def format_price_response(response):
    body = response.get("body")
    if not isinstance(body, list):
        return "I tried to calculate the price, but pricing is not available right now. Please try again in a moment."
    total = sum(item.get("net", 0) for item in body) / 100
    st.session_state.booking_state["confirmedPrice"] = total
    lines = [f"The confirmed price from Notarity is {money(total)}:"]
    for item in body:
        lines.append(f"- {item.get('name')}: {money(item.get('net', 0) / 100)}")
    lines.append("Do you want me to submit the appointment request?")
    st.session_state.submit_confirmation_requested = True
    return "\n".join(lines)


def required_files_missing():
    for product in product_payloads():
        if product.get("documentsNotReadyYet") and not product.get("files"):
            return True
    return False


def run_automatic_actions(user_text, llm_result):
    messages = []

    choice_index = parse_timeslot_choice(user_text)
    slots = offered_timeslot_options()
    if choice_index is not None and choice_index < len(slots):
        st.session_state.booking_state["timeslotId"] = slots[choice_index]["id"]
        messages.append("I saved that appointment time.")

    requested = llm_result.get("requestedAction") or "none"
    should_fetch_times = requested == "fetch_timeslots" or (
        user_asks_for_times(user_text)
        and st.session_state.booking_state.get("destinationCountry")
        and st.session_state.booking_state.get("selectedProductIds")
        and resolve_timeslot_label()
        and not st.session_state.booking_state.get("timeslotId")
    )
    if should_fetch_times:
        label = resolve_timeslot_label()
        if label:
            slots, start_offset, end_offset = fetch_available_timeslots(label)
            messages.append(format_timeslots(slots, start_offset, end_offset))
    elif user_asks_for_times(user_text) and st.session_state.booking_state.get("destinationCountry") and not st.session_state.booking_state.get("selectedProductIds"):
        messages.append("Let me first find the right service for your document. What type of notarization do you need?")
    elif user_asks_for_times(user_text) and not st.session_state.booking_state.get("destinationCountry"):
        messages.append("Which country will the document be used in? I need that to find the right appointment calendar.")

    if ready_for_pricing() and not st.session_state.price_response:
        response = price_appointment(build_payload())
        st.session_state.price_response = response
        messages.append(format_price_response(response))

    if user_confirmed_submit(user_text, llm_result):
        if not st.session_state.price_response:
            messages.append("I need to price the request before I can submit it.")
        elif required_files_missing():
            messages.append("Before I submit, please upload the required document files so they can be attached to the request.")
        else:
            response = submit_appointment(build_payload(), uploaded_file_parts())
            st.session_state.submit_response = response
            if response.get("status") in [200, 201]:
                messages.append("Your appointment request has been submitted successfully.")
                st.session_state.submit_confirmation_requested = False
            else:
                messages.append("I tried to submit the appointment request, but something went wrong. Please try again in a moment.")

    return messages


def product_payloads():
    selected_ids = list(dict.fromkeys((st.session_state.booking_state.get("selectedProductIds") or []) + auto_product_ids_from_schema()))
    files = [name for name, _, _ in uploaded_file_parts()]
    products = {product["id"]: product for product in allowed_products()}
    payloads = []
    for index, product_id in enumerate(selected_ids):
        product = products.get(product_id, {"raw": {}})
        raw = product.get("raw") or {}
        needs_files = bool(raw.get("showFileUpload") or raw.get("fileUploadRequired"))
        assigned_files = files if needs_files and index == 0 else []
        payloads.append(
            {
                "id": product_id,
                "apostille": True if raw.get("apostilleRequired") else (False if raw.get("showApostille") else None),
                "userInput": "",
                "documentsNotReadyYet": not bool(assigned_files) if needs_files else False,
                "needHelpDrafting": False,
                "proofOfRepresentation": None,
                "files": assigned_files,
            }
        )
    return payloads


def split_name(name):
    parts = (name or "Client").split()
    return parts[0], " ".join(parts[1:])


def build_payload():
    form = get_booking_form() or {}
    state = st.session_state.booking_state
    first, last = split_name(state.get("participantName"))
    email = state.get("participantEmail") or DEFAULT_EMAIL
    phone = state.get("participantPhone") or "+43000000000"
    billing = state.get("billingDetails") or {}
    billing = {
        "firstName": billing.get("firstName") or first,
        "lastName": billing.get("lastName") or last,
        "business": billing.get("business", False),
        "email": billing.get("email") or email,
        "phoneNumber": billing.get("phoneNumber") or phone,
        "address": billing.get("address") or "",
        "zipCode": billing.get("zipCode") or "",
        "city": billing.get("city") or "",
        "stateProvince": billing.get("stateProvince") or "",
        "countryCode": billing.get("countryCode") or state.get("destinationCountry") or "",
    }
    contact = state.get("contactDetails") or {}
    if state.get("contactDetailsSameAsBilling"):
        contact = {
            "contactDetailsSameAsBillingDetails": True,
            "firstName": billing["firstName"],
            "lastName": billing["lastName"],
            "business": billing["business"],
            "email": billing["email"],
            "phoneNumber": billing["phoneNumber"],
        }
    else:
        contact = {
            "contactDetailsSameAsBillingDetails": False,
            "firstName": contact.get("firstName") or first,
            "lastName": contact.get("lastName") or last,
            "business": contact.get("business", False),
            "email": contact.get("email") or email,
            "phoneNumber": contact.get("phoneNumber") or phone,
        }
    payload = {
        "_bookingForm": form.get("id"),
        "language": state.get("language") or "en",
        "origin": "https://staging.notarity.com/#/appointment-requests",
        "confirmedPrice": state.get("confirmedPrice") or 0,
        "hardCopy": {"expressShipping": bool(state.get("expressShipping")), "hardCopy": bool(state.get("hardCopy"))},
        "newsletter": False,
        "mode": "debug",
        "destinationCountry": state.get("destinationCountry"),
        "products": product_payloads(),
        "participants": [{"email": email, "client": True, "supervisor": False}],
        "timeslots": [state.get("timeslotId")] if state.get("timeslotId") else [],
        "instantNotarisationSupported": False,
        "instant": False,
        "timezone": state.get("timezone") or "Europe/Vienna",
        "billingDetails": billing,
        "contactDetails": contact,
        "preferredNotary": state.get("preferredNotary") or "",
    }
    if state.get("hardCopy"):
        shipping = state.get("shippingDetails") or {}
        if state.get("shippingDetailsSameAsBilling"):
            shipping = {
                "shippingDetailsSameAsBillingDetails": True,
                "firstName": billing["firstName"],
                "lastName": billing["lastName"],
                "business": billing["business"],
                "email": billing["email"],
                "phoneNumber": billing["phoneNumber"],
                "address": billing["address"],
                "zipCode": billing["zipCode"],
                "city": billing["city"],
                "stateProvince": billing["stateProvince"],
                "countryCode": billing["countryCode"],
            }
        else:
            shipping = {
                "shippingDetailsSameAsBillingDetails": False,
                "firstName": shipping.get("firstName") or first,
                "lastName": shipping.get("lastName") or last,
                "business": shipping.get("business", False),
                "email": shipping.get("email") or email,
                "phoneNumber": shipping.get("phoneNumber") or phone,
                "address": shipping.get("address") or "",
                "zipCode": shipping.get("zipCode") or "",
                "city": shipping.get("city") or "",
                "stateProvince": shipping.get("stateProvince") or "",
                "countryCode": shipping.get("countryCode") or billing["countryCode"],
            }
        payload["shippingDetails"] = shipping
    draft_id = os.environ.get("APPOINTMENT_REQUEST_DRAFT_ID")
    if draft_id:
        payload["_appointmentRequestDraft"] = draft_id
    return payload


def openai_turn(user_message):
    api_key = os.environ.get("OPENAI_API_KEY") or st.session_state.get("openai_api_key")
    if not api_key or OpenAI is None:
        return {
            "assistantMessage": "I need a working OpenAI API key to continue. Please set OPENAI_API_KEY, then I can inspect the document and guide the booking.",
            "stateUpdates": {},
            "selectedProductIds": [],
            "detectedFacts": [],
            "needsDocumentUpload": False,
            "readyForPricing": False,
        }, "no-llm"

    allowed = [{k: v for k, v in product.items() if k != "raw"} for product in allowed_products()]
    previous_assistant = next((m["content"] for m in reversed(st.session_state.messages) if m["role"] == "assistant"), "")
    prompt = {
        "role": "Notarity Copilot",
        "rules": [
            "Continue a short conversation. Ask exactly one concise question unless ready for pricing.",
            "The customer often does not know what they need. If they say they do not know, ask for a document or ask a broader outcome question.",
            "A document is optional at the start. If the customer does not have a document, continue by asking what they need notarized or what outcome they want.",
            "Do not ask the customer to upload a document unless the selected product requires files before final submit.",
            "If the customer says they do not have the document yet, set documentReady to false and documentsNotReadyYet to true, then continue the booking conversation.",
            "Examples of no-document needs include notarizing a signature, getting a certified copy, creating a power of attorney, or certifying specific facts.",
            "If the user asks you to read or inspect the document and documentText is empty, ask them to upload the document.",
            "If the user asks you to read or inspect the document and documentText is present, infer only the booking-relevant facts from the document.",
            "Customers usually do not know the Notarity product they need; never expect them to name a product.",
            "Use documentText, latestUserMessage, bookingState, and allowedProducts to identify the best product yourself.",
            "When documentText is available, use it as the primary evidence for product selection.",
            "If one allowed product clearly matches the document or stated outcome, select it in selectedProductIds and continue to the next missing booking field.",
            "Only ask a product clarification question when multiple allowedProducts plausibly fit and the documentText does not distinguish them.",
            "If documentText is unrelated to any allowedProducts, such as a CV/resume or an informational document with no apparent notarization need, do not select a product.",
            "For unsuitable or unrelated documents, politely say that the document does not appear to match the available notarization services and ask what the customer needs notarized or certified.",
            "Never force a product match just because products are available; selectedProductIds must stay empty unless the document or user outcome clearly fits an allowed product.",
            "Your goal is to complete a Notarity appointment request, not to fully analyze the document.",
            "Do not ask about legal, business, meeting, transaction, or document-content details unless they are required to choose one allowed product.",
            "If the document type is clear, proceed with product selection and the next missing booking field instead of asking about the document's purpose.",
            "If the user says they do not know, asks you to check the document, or says you do not need that information, never repeat the same question; move to the next missing booking field.",
            "If latestUserMessage answers previousAssistantQuestion, update the matching state field and do not ask for that field again.",
            "If the customer provides multiple details in one answer, extract and update all matching fields at once; do not ask again for fields already present in that answer.",
            "If you infer a required field value from documentText, ask the customer to confirm it before treating it as final.",
            "During document review, prefer confirming extracted required fields before asking for fields that are still unknown.",
            "For document-derived values, ask in this format: 'I found [value] as the [field label]. Is that correct?'",
            "When assistantMessage asks for confirmation of a document-derived value, set confirmingField and confirmingValue, and set askingField to null.",
            "Ask only for fields in missingFields unless product selection is truly impossible from allowedProducts and documentText.",
            "Whenever assistantMessage asks the customer for a booking field, set askingField to the exact missingFields path being requested.",
            "If assistantMessage is not asking for a customer field, set askingField to null.",
            "For power of attorney documents, choose Signature notarisation when it is available and no more specific allowed product is clearly required.",
            "Never repeat the previous assistant question verbatim.",
            "Do not expose internal routing, product IDs, prices, timeslot IDs, or schema internals to the user.",
            "Never mention APIs, endpoints, payloads, schemas, backend calls, or technical infrastructure to the customer.",
            "You may only select product IDs from allowedProducts. If none fit, ask a clarifying question.",
            "Do not invent product IDs, booking form IDs, timeslot IDs, prices, or draft IDs.",
            "Ask exactly one question at a time. Never ask two questions in the same message.",
            "Once you have collected destinationCountry, participantName, participantEmail, participantPhone, billingDetails (lastName, address, zipCode, city, countryCode), and hardCopy preference, set requestedAction to 'fetch_timeslots' to offer appointment times.",
        ],
        "conversation": st.session_state.messages[-8:],
        "latestUserMessage": user_message,
        "previousAssistantQuestion": previous_assistant,
        "currentAskingField": st.session_state.get("asking_field"),
        "currentConfirmingField": st.session_state.get("confirming_field"),
        "currentConfirmingValue": st.session_state.get("confirming_value"),
        "bookingState": st.session_state.booking_state,
        "schemaSummary": schema_summary(),
        "allowedProducts": allowed,
        "missingFields": missing_fields(),
        "availableActions": {
            "fetchTimeslots": bool(resolve_timeslot_label() and not st.session_state.booking_state.get("timeslotId")),
            "price": ready_for_pricing(),
            "submit": bool(st.session_state.price_response),
        },
        "documentText": compact(st.session_state.document_text, limit=6000),
        "returnJsonShape": {
            "assistantMessage": "string",
            "stateUpdates": {
                "intent": "string or null",
                "destinationCountry": "ISO alpha-2 or null",
                "participantName": "string or null",
                "participantEmail": "string or null",
                "participantPhone": "string or null",
                "documentReady": "boolean or null",
                "documentsNotReadyYet": "boolean or null",
                "hardCopy": "boolean or null",
                "expressShipping": "boolean or null",
                "contactDetailsSameAsBilling": "boolean",
                "shippingDetailsSameAsBilling": "boolean",
                "preferredNotary": "string or null",
                "billingDetails": {
                    "firstName": "string or null",
                    "lastName": "string or null",
                    "email": "string or null",
                    "phoneNumber": "string or null",
                    "address": "string or null",
                    "zipCode": "string or null",
                    "city": "string or null",
                    "stateProvince": "string or null",
                    "countryCode": "ISO alpha-2 or null",
                    "business": "boolean"
                },
                "contactDetails": "object or null",
                "shippingDetails": "object or null",
            },
            "selectedProductIds": ["IDs from allowedProducts only"],
            "detectedFacts": ["short facts"],
            "needsDocumentUpload": "boolean",
            "readyForPricing": "boolean",
            "requestedAction": "none | fetch_timeslots | price | submit",
            "userConfirmedSubmit": "boolean",
            "askingField": "one missing field path you are asking for, e.g. participantEmail or billingDetails.address, or null",
            "confirmingField": "one field path for a document-derived value being confirmed, or null",
            "confirmingValue": "the document-derived value being confirmed, or null",
        },
    }
    try:
        result, error = call_openai_json(api_key, prompt, temperature=0.15)
        if error:
            raise error
        allowed_ids = {product["id"] for product in allowed if product.get("id")}
        result["selectedProductIds"] = [product_id for product_id in result.get("selectedProductIds", []) if product_id in allowed_ids]
        apply_state(result.get("stateUpdates") or {})
        if result["selectedProductIds"]:
            st.session_state.booking_state["selectedProductIds"] = list(dict.fromkeys(result["selectedProductIds"]))
        st.session_state.confirming_field = result.get("confirmingField") or None
        st.session_state.confirming_value = result.get("confirmingValue") or None
        st.session_state.asking_field = None if st.session_state.confirming_field else (result.get("askingField") or None)
        return result, f"openai: {OPENAI_MODEL}"
    except Exception as error:
        st.session_state.llm_error = str(error)
        return {
            "assistantMessage": "I need a moment before continuing. Please try again in a few seconds.",
            "stateUpdates": {},
            "selectedProductIds": [],
            "detectedFacts": [],
            "needsDocumentUpload": False,
            "readyForPricing": False,
        }, "llm-error"




def apply_state(updates):
    state = st.session_state.booking_state
    for key, value in (updates or {}).items():
        if key in state and value not in [None, "", [], {}]:
            if key == "destinationCountry":
                value = normalize_country(value)
            if isinstance(value, dict) and value.get("address"):
                value = {**value, **parse_address_details(value.get("address"))}
            if isinstance(value, dict) and isinstance(state.get(key), dict):
                state[key].update(value)
            else:
                state[key] = value


def apply_user_answer_from_previous_question(user_text):
    answer = (user_text or "").strip()
    if not answer:
        return
    confirming_field = st.session_state.get("confirming_field")
    if confirming_field:
        confirmed = parse_yes_no(answer)
        if confirmed is True:
            set_state_path(confirming_field, st.session_state.get("confirming_value"))
            st.session_state.confirming_field = None
            st.session_state.confirming_value = None
            return
        if confirmed is False:
            st.session_state.confirming_field = None
            st.session_state.confirming_value = None
            st.session_state.asking_field = confirming_field
            return
        set_state_path(confirming_field, answer)
        st.session_state.confirming_field = None
        st.session_state.confirming_value = None
        return
    asking_field = st.session_state.get("asking_field")
    if asking_field:
        set_state_path(asking_field, answer)
        st.session_state.asking_field = None
        return
    previous = next((m["content"] for m in reversed(st.session_state.messages) if m["role"] == "assistant"), "").lower()
    state = st.session_state.booking_state
    billing = state.get("billingDetails") or {}

    if "email" in previous and "participant" in previous:
        state["participantEmail"] = answer
        billing["email"] = answer
    elif "phone" in previous and "participant" in previous:
        state["participantPhone"] = answer
        billing["phoneNumber"] = answer
    elif "name" in previous and ("participant" in previous or "your name" in previous):
        state["participantName"] = answer
        first, last = split_name(answer)
        billing.setdefault("firstName", first)
        if last:
            billing.setdefault("lastName", last)
    elif "last name" in previous and "billing" in previous:
        billing["lastName"] = answer
    elif "address" in previous and "billing" in previous:
        billing.update(parse_address_details(answer))
    elif ("zip" in previous or "postal" in previous) and "billing" in previous:
        billing["zipCode"] = answer
    elif "city" in previous and "billing" in previous:
        billing["city"] = answer
    elif ("country code" in previous or "billing country" in previous or "country for the billing" in previous) and "billing" in previous:
        billing["countryCode"] = normalize_country(answer)

    if billing:
        state["billingDetails"] = billing


def ready_for_timeslots():
    return bool(resolve_timeslot_label() and not st.session_state.booking_state.get("timeslotId"))


def ready_for_pricing():
    return len(missing_fields()) == 0


def ready_for_submit():
    return bool(ready_for_pricing() and st.session_state.price_response and uploaded_file_parts())


def uploaded_file_parts():
    return [(file.name, file.getvalue(), "application/pdf") for file in st.session_state.uploaded_files or []]


def render_hero():
    st.markdown(
        """
        <div class="hero">
          <div class="eyebrow">Notarity Copilot</div>
          <div class="hero-title">A short conversation instead of a booking form.</div>
          <p>OpenAI understands the customer. Notarity's booking rules keep the appointment valid from start to finish.</p>
          <span class="pill">No predefined cases</span><span class="pill">Guided by real booking rules</span><span class="pill">Optional document upload</span><span class="pill">Real appointment times</span>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_chat():
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.subheader("Conversation")
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.write(message["content"])

    upload_label = "Uploaded documents" if st.session_state.uploaded_files else "Upload documents if you have them"
    files = st.file_uploader(upload_label, type=["pdf"], accept_multiple_files=True, key="chat_upload")
    if files != st.session_state.uploaded_files:
        st.session_state.uploaded_files = files
        st.session_state.document_text = "\n".join(f"--- {file.name} ---\n{extract_pdf_text(file.getvalue())}" for file in files or [])
        if files:
            st.session_state.pending_document_review = True
            st.session_state.document_review_started = False
            st.session_state.messages.append({"role": "assistant", "content": "I received the document and started reviewing it."})
            st.rerun()

    if st.session_state.pending_document_review and not st.session_state.document_review_started:
        st.session_state.document_review_started = True
        with st.spinner("Reviewing the uploaded document..."):
            result, source = openai_turn("Inspect the uploaded document and continue the booking flow.")
            action_messages = run_automatic_actions("", result)
        st.session_state.pending_document_review = False
        st.session_state.document_review_started = False
        st.session_state.last_llm_json = result
        st.session_state.llm_source = source
        st.session_state.messages.append({"role": "assistant", "content": result.get("assistantMessage") or "What should we clarify next?"})
        for message in action_messages:
            st.session_state.messages.append({"role": "assistant", "content": message})
        st.rerun()

    user_message = st.chat_input("Reply to the assistant...")
    if user_message:
        st.session_state.messages.append({"role": "user", "content": user_message})
        if user_asks_show_more(user_message):
            st.session_state.messages.append({"role": "assistant", "content": format_more_timeslots()})
            st.rerun()
        apply_user_answer_from_previous_question(user_message)
        with st.spinner("Thinking and checking appointment options..."):
            result, source = openai_turn(user_message)
            action_messages = run_automatic_actions(user_message, result)
        st.session_state.last_llm_json = result
        st.session_state.llm_source = source
        st.session_state.messages.append({"role": "assistant", "content": result.get("assistantMessage") or "What should we clarify next?"})
        for message in action_messages:
            st.session_state.messages.append({"role": "assistant", "content": message})
        st.rerun()
    st.markdown("</div>", unsafe_allow_html=True)


def render_price():
    response = st.session_state.price_response
    if not response or not isinstance(response.get("body"), list):
        return
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.subheader("Backend Price")
    total = 0
    for item in response["body"]:
        amount = item.get("net", 0) / 100
        total += amount
        st.markdown(f"<div class='line'><span>{item.get('name')}</span><strong>{money(amount)}</strong></div>", unsafe_allow_html=True)
    st.markdown(f"<div class='total'><span>Total</span><span>{money(total)}</span></div>", unsafe_allow_html=True)
    st.markdown("</div>", unsafe_allow_html=True)


def render_sidebar():
    state = st.session_state.booking_state
    st.markdown('<div class="card">', unsafe_allow_html=True)
    st.subheader("Readiness")
    rows = [
        ("Need understood", bool(state.get("intent"))),
        ("Country", bool(state.get("destinationCountry"))),
        ("Products from schema", bool(product_payloads())),
        ("Participant email", bool(state.get("participantEmail"))),
        ("Time", bool(state.get("timeslotId"))),
        ("Price", bool(st.session_state.price_response)),
        ("Files", bool(uploaded_file_parts())),
    ]
    for label, ok in rows:
        st.markdown(f"<span class='{'ok' if ok else 'warn'}'>{'OK' if ok else '--'}</span> {label}", unsafe_allow_html=True)
    st.caption(f"LLM source: {st.session_state.llm_source or 'not used yet'}")
    st.markdown("</div>", unsafe_allow_html=True)

    with st.expander("Allowed products from visible schema"):
        st.code(json.dumps([{k: v for k, v in p.items() if k != "raw"} for p in allowed_products()], indent=2), language="json")
    with st.expander("Booking state"):
        st.code(json.dumps(state, indent=2), language="json")
    with st.expander("LLM output"):
        st.code(json.dumps(st.session_state.last_llm_json or {}, indent=2), language="json")
    with st.expander("Generated payload"):
        st.code(json.dumps(build_payload(), indent=2), language="json")
    for label, response in [
        ("Booking form", st.session_state.booking_form_response),
        ("Products", st.session_state.products_response),
        ("Timeslots", st.session_state.timeslot_response),
        ("Price", st.session_state.price_response),
        ("Submit", st.session_state.submit_response),
    ]:
        with st.expander(label):
            st.code(json.dumps(response or {}, indent=2), language="json")


def main():
    init_session()
    css()
    render_hero()

    if not os.environ.get("OPENAI_API_KEY"):
        with st.expander("Set OpenAI API key"):
            key = st.text_input("OpenAI API key", type="password", key="openai_key_input")
            if key:
                st.session_state.openai_api_key = key
                st.success("OpenAI key stored for this session.")

    left, right = st.columns([2.15, 1])
    with left:
        render_chat()
    with right:
        render_sidebar()


if __name__ == "__main__":
    main()
