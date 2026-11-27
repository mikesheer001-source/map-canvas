export const TRANSITOUS_PLAN_ENDPOINT = "https://api.transitous.org/api/v6/plan";
export const TRANSITOUS_SOURCES_URL = "https://transitous.org/sources/";
export const TRANSITOUS_API_DOCS_URL = "https://transitous.org/api/";
export const TWELVEGO_HOME_URL = "https://12go.asia/en";
export const PRICE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const RESEARCH_CACHE_MS = 5 * 60 * 1000;

const TRANSIT_MODE_LABELS = {
  BUS: "Bus", COACH: "Coach", FERRY: "Ferry", AIRPLANE: "Flight",
  TRAM: "Tram", SUBWAY: "Metro", RAIL: "Train", HIGHSPEED_RAIL: "High-speed train",
  LONG_DISTANCE: "Train", NIGHT_RAIL: "Night train", REGIONAL_RAIL: "Regional train",
  SUBURBAN: "Suburban rail", FUNICULAR: "Rail", AERIAL_LIFT: "Cable car",
  AREAL_LIFT: "Cable car", OTHER: "Public transport", CAR: "Driving", HGV: "Driving"
};
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isFareProduct = value => isObject(value) && Number.isFinite(Number(value.amount)) &&
  typeof value.currency === "string" && /^[A-Z]{3}$/.test(value.currency);

function safeHttpUrl(value) {
  try { const url = new URL(String(value || "")); return url.protocol === "https:" || url.protocol === "http:" ? url.href : null; }
  catch { return null; }
}

export function toLocalDateTimeISO(date, time) {
  const value = new Date(String(date) + "T" + String(time || "00:00"));
  if (!Number.isFinite(value.getTime())) throw new Error("Choose a valid departure date and time.");
  const pad = n => String(n).padStart(2, "0"), offset = -value.getTimezoneOffset();
  const zone = (offset >= 0 ? "+" : "-") + pad(Math.floor(Math.abs(offset) / 60)) + ":" + pad(Math.abs(offset) % 60);
  return value.getFullYear() + "-" + pad(value.getMonth() + 1) + "-" + pad(value.getDate()) +
    "T" + pad(value.getHours()) + ":" + pad(value.getMinutes()) + ":00" + zone;
}

export function buildTransitousPlanUrl(route, departureDateTime) {
  const fromLat = Number(route?.from?.lat), fromLng = Number(route?.from?.lng);
  const toLat = Number(route?.to?.lat), toLng = Number(route?.to?.lng);
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite) ||
      Math.abs(fromLat) > 90 || Math.abs(toLat) > 90 || Math.abs(fromLng) > 180 || Math.abs(toLng) > 180)
    throw new Error("This route needs valid start and destination coordinates before transport options can be researched.");
  const query = new URLSearchParams({
    fromPlace: fromLat.toFixed(6) + "," + fromLng.toFixed(6),
    toPlace: toLat.toFixed(6) + "," + toLng.toFixed(6),
    time: departureDateTime, maxTransfers: "3", radius: "1500",
    transitModes: "TRANSIT", directModes: "CAR", numItineraries: "8", maxItineraries: "8",
    timetableView: "true", arriveBy: "false", searchWindow: "43200",
    detailedLegs: "true", detailedTransfers: "true", withFares: "true", passengers: "1",
    realtimeMode: "REALTIME", language: "en", timeout: "15"
  });
  return TRANSITOUS_PLAN_ENDPOINT + "?" + query.toString();
}

function fareBundles(value) {
  if (isFareProduct(value)) return [[value]];
  if (!Array.isArray(value) || !value.length) return [];
  if (value.every(isFareProduct)) return [value];
  return value.flatMap(fareBundles);
}
function cheapestFareBundle(value) {
  const candidates = fareBundles(value).map(products => {
    const currencies = [...new Set(products.map(product => product.currency))];
    if (!products.length || currencies.length !== 1) return null;
    return { amount: products.reduce((sum, product) => sum + Number(product.amount), 0), currency: currencies[0], products };
  }).filter(Boolean);
  candidates.sort((a, b) => a.amount - b.amount);
  return candidates[0] || null;
}
export function extractFareSummary(itinerary) {
  const transfers = Array.isArray(itinerary?.fareTransfers) ? itinerary.fareTransfers : [];
  if (!transfers.length) return null;
  let amount = 0, currency = null;
  const products = [];
  for (const transfer of transfers) {
    const rule = transfer?.rule;
    if (!["A_AB_B", "A_AB", "AB"].includes(rule)) return null;
    const groups = Array.isArray(transfer.effectiveFareLegProducts) ? transfer.effectiveFareLegProducts : [];
    const requiredGroups = rule === "AB" ? [] : rule === "A_AB" ? groups.slice(0, 1) : groups;
    const selected = [];
    for (const group of requiredGroups) {
      const bundle = cheapestFareBundle(group);
      if (!bundle) return null;
      selected.push(bundle);
    }
    if (Array.isArray(transfer.transferProducts) && transfer.transferProducts.length) {
      const bundle = cheapestFareBundle(transfer.transferProducts);
      if (!bundle) return null;
      selected.push(bundle);
    }
    for (const bundle of selected) {
      if (currency && currency !== bundle.currency) return null;
      currency = bundle.currency;
      amount += bundle.amount;
      products.push(...bundle.products.map(product => ({
        name: String(product.name || "Fare product"), amount: Number(product.amount), currency: product.currency
      })));
    }
  }
  return currency && products.length && Number.isFinite(amount)
    ? { amount, currency, products, basis: "Transitous fare feed" } : null;
}

function modeForLegs(legs) {
  const modes = [...new Set(legs.map(leg => String(leg?.mode || "").toUpperCase())
    .filter(mode => mode && !["WALK", "FOOT", "BIKE", "BIKE_SHARING"].includes(mode)))];
  if (!modes.length) return "driving";
  const labels = [...new Set(modes.map(mode => {
    if (["BUS", "COACH"].includes(mode)) return "bus";
    if (mode === "FERRY") return "ferry";
    if (mode === "AIRPLANE") return "flight";
    if (["CAR", "HGV"].includes(mode)) return "driving";
    if (["RAIL", "HIGHSPEED_RAIL", "LONG_DISTANCE", "NIGHT_RAIL", "REGIONAL_RAIL", "SUBURBAN", "TRAM", "SUBWAY", "FUNICULAR", "AERIAL_LIFT", "AREAL_LIFT"].includes(mode)) return "train";
    return "transit";
  }))];
  return labels.length === 1 ? labels[0] : "mixed";
}

export function buildExternalTransportLinks(route, date) {
  const slug = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const from = String(route?.from?.title || "").trim(), to = String(route?.to?.title || "").trim();
  const broadPlace = value => value.length > 1 && value.length <= 48 && !/[0-9]/.test(value) &&
    !value.includes(",") && !/\b(street|road|avenue|district|ward|terminal|platform|hotel|hostel|apartment|building)\b/i.test(value);
  const twelveGo = broadPlace(from) && broadPlace(to)
    ? "https://12go.asia/en/travel/" + slug(from) + "/" + slug(to) : TWELVEGO_HOME_URL;
  const flights = "https://www.google.com/travel/flights?q=" +
    encodeURIComponent("Flights from " + from + " to " + to + (date ? " on " + date : ""));
  const a = [Number(route?.from?.lat), Number(route?.from?.lng)], b = [Number(route?.to?.lat), Number(route?.to?.lng)];
  const driving = a.concat(b).every(Number.isFinite)
    ? "https://www.google.com/maps/dir/?api=1&origin=" + encodeURIComponent(a.join(",")) +
      "&destination=" + encodeURIComponent(b.join(",")) + "&travelmode=driving" : null;
  return { twelveGo, flights, driving };
}

function optionBookingLinks(legs, route, date) {
  const links = [], seen = new Set();
  for (const leg of legs) {
    for (const [raw, label] of [
      [leg.agencyFareUrl, "Ticket / fare information"],
      [leg.routeUrl, "Route details"],
      [leg.agencyUrl, "Operator website"]
    ]) {
      const url = safeHttpUrl(raw);
      if (url && !seen.has(url)) {
        seen.add(url);
        links.push({ label, url, operator: String(leg.agencyName || "") });
      }
    }
  }
  if (!links.length) {
    const modes = new Set(legs.map(leg => String(leg.mode || "").toUpperCase()));
    const external = buildExternalTransportLinks(route, date);
    if (modes.has("AIRPLANE")) links.push({ label: "Compare flights", url: external.flights, operator: "Google Flights" });
    else if (modes.has("CAR") || modes.has("HGV")) {
      if (external.driving) links.push({ label: "Driving directions", url: external.driving, operator: "Google Maps" });
    } else links.push({ label: "Search tickets on 12Go", url: external.twelveGo, operator: "12Go" });
  }
  return links;
}

function normalizeOption(itinerary, route, date, kind, index) {
  const legs = Array.isArray(itinerary?.legs) ? itinerary.legs : [];
  if (!legs.length || itinerary.cancelled || legs.some(leg => leg?.cancelled)) return null;
  const transitLegs = legs.filter(leg => !["WALK", "FOOT", "BIKE", "BIKE_SHARING"].includes(String(leg?.mode || "").toUpperCase()));
  const operators = [...new Set(transitLegs.map(leg => String(leg.agencyName || "").trim()).filter(Boolean))];
  const stops = transitLegs.reduce((sum, leg) => sum + (Array.isArray(leg.intermediateStops) ? leg.intermediateStops.length : 0), 0);
  const durationSeconds = Number(itinerary.duration) || (Date.parse(itinerary.endTime) - Date.parse(itinerary.startTime)) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) return null;
  const startTime = itinerary.startTime || legs[0]?.startTime || null;
  const endTime = itinerary.endTime || legs.at(-1)?.endTime || null;
  const timeZone = itinerary.from?.tz || legs.find(leg => leg.from?.tz)?.from?.tz || null;
  const fare = extractFareSummary(itinerary), mode = modeForLegs(transitLegs);
  const legSummary = transitLegs.map(leg => ({
    mode: String(leg.mode || "TRANSIT").toUpperCase(),
    modeLabel: TRANSIT_MODE_LABELS[String(leg.mode || "").toUpperCase()] || "Public transport",
    operator: String(leg.agencyName || "").trim(),
    route: String(leg.routeShortName || leg.displayName || leg.routeLongName || "").trim(),
    from: String(leg.from?.name || ""), to: String(leg.to?.name || ""),
    departure: leg.startTime || leg.scheduledStartTime || null,
    arrival: leg.endTime || leg.scheduledEndTime || null,
    realTime: !!leg.realTime,
    stops: Array.isArray(leg.intermediateStops) ? leg.intermediateStops.map(stop => String(stop.name || "")).filter(Boolean) : []
  }));
  return {
    id: String(itinerary.id || [kind, mode, startTime, operators.join("-"), index].join(":")),
    mode, modeLabel: mode === "mixed" ? "Mixed transport" : mode === "driving" ? "Driving" :
      mode === "flight" ? "Flight" : mode === "ferry" ? "Ferry" : mode === "train" ? "Train" : "Bus",
    operators, operatorLabel: operators.length ? operators.join(", ") : (mode === "driving" ? "Road route" : "Operator not listed in feed"),
    departureTime: startTime, arrivalTime: endTime, timeZone, durationSeconds,
    transfers: Math.max(0, Number(itinerary.transfers) || 0), stops, fare,
    priceStatus: fare ? "unverified" : "not-provided",
    bookingLinks: optionBookingLinks(transitLegs, route, date),
    legs: legSummary, realTime: transitLegs.some(leg => !!leg.realTime), kind,
    source: "Transitous MOTIS schedule data"
  };
}

export function rankTransportOptions(options) {
  const usable = (options || []).filter(option => Number.isFinite(Number(option.durationSeconds)) && Number(option.durationSeconds) >= 0);
  const fastest = usable.slice().sort((a, b) => a.durationSeconds - b.durationSeconds)[0] || null;
  const currencies = [...new Set(usable.map(option => option.fare?.currency).filter(Boolean))];
  const completeSameCurrency = usable.length > 0 &&
    usable.every(option => option.fare && Number.isFinite(Number(option.fare.amount))) && currencies.length === 1;
  const cheapest = completeSameCurrency ? usable.slice().sort((a, b) => a.fare.amount - b.fare.amount)[0] : null;
  const bestValue = completeSameCurrency && fastest
    ? usable.filter(option => option.durationSeconds <= fastest.durationSeconds * 1.25)
      .sort((a, b) => a.fare.amount - b.fare.amount)[0] || null : null;
  return {
    cheapest: cheapest?.id || null, fastest: fastest?.id || null, bestValue: bestValue?.id || null,
    currency: completeSameCurrency ? currencies[0] : null,
    cheapestReason: cheapest ? null : "Not ranked: at least one option has no comparable published fare, or currencies differ.",
    bestValueReason: bestValue ? "Lowest fare among options within 25% of the fastest journey." :
      "Not ranked: comparable fares and journey times are required."
  };
}

export function normalizeTransitousResponse(data, route, date, researchedAt = new Date().toISOString()) {
  const scheduled = Array.isArray(data?.itineraries) ? data.itineraries : [];
  const direct = Array.isArray(data?.direct) ? data.direct : [];
  const options = [
    ...scheduled.map((item, index) => normalizeOption(item, route, date, "scheduled", index)),
    ...direct.map((item, index) => normalizeOption(item, route, date, "direct", index))
  ].filter(Boolean);
  const unique = [], keys = new Set();
  for (const option of options) {
    const key = [option.mode, option.departureTime, option.arrivalTime, option.operatorLabel].join("|");
    if (!keys.has(key)) { keys.add(key); unique.push(option); }
  }
  const limited = unique.slice(0, 12);
  const sources = [
    { name: "Transitous schedule and fare data", url: TRANSITOUS_SOURCES_URL, checkedAt: researchedAt, kind: "data" },
    { name: "Transitous MOTIS API documentation", url: TRANSITOUS_API_DOCS_URL, checkedAt: researchedAt, kind: "documentation" }
  ];
  const seenSources = new Set(sources.map(source => source.url));
  for (const option of limited) for (const link of option.bookingLinks) {
    if (link.operator && !seenSources.has(link.url)) {
      seenSources.add(link.url);
      sources.push({ name: link.operator + " provider link", url: link.url, checkedAt: researchedAt, kind: "operator-link" });
    }
  }
  return {
    provider: "Transitous MOTIS 2", status: limited.length ? "success" : "no-results",
    researchedAt, requestedFor: date, options: limited, picks: rankTransportOptions(limited), sources,
    externalLinks: buildExternalTransportLinks(route, date.slice(0, 10)),
    notes: [
      "Transitous is a best-effort community service with regional feed coverage; missing results do not prove that no service exists.",
      "Fare fields are experimental feed data. Prices are unverified until checked with the operator or booking provider."
    ]
  };
}

export function isResearchStale(research, now = Date.now()) {
  const timestamp = Date.parse(research?.researchedAt || "");
  return !Number.isFinite(timestamp) || now - timestamp > PRICE_STALE_AFTER_MS;
}

export async function searchTransportOptions(route, departureDateTime, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("This browser does not support transport research.");
  const url = buildTransitousPlanUrl(route, departureDateTime);
  const response = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" }, signal: options.signal });
  if (!response.ok) throw new Error("Transit schedule search returned HTTP " + response.status + ".");
  const data = await response.json();
  const researchedAt = options.now ? new Date(options.now).toISOString() : new Date().toISOString();
  return normalizeTransitousResponse(data, route, departureDateTime, researchedAt);
}

function makeElement(tag, value, className) {
  const element = document.createElement(tag);
  if (value !== undefined && value !== null) element.textContent = String(value);
  if (className) element.className = className;
  return element;
}
function formatFare(fare) {
  if (!fare) return "No fare published in the timetable feed";
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency: fare.currency, maximumFractionDigits: 2 }).format(fare.amount); }
  catch { return Number(fare.amount).toFixed(2) + " " + fare.currency; }
}
function formatDuration(seconds) {
  const minutes = Math.round(Number(seconds) / 60);
  if (!Number.isFinite(minutes) || minutes < 0) return "Time unavailable";
  const hours = Math.floor(minutes / 60), remainder = minutes % 60;
  return hours ? hours + " hr" + (remainder ? " " + remainder + " min" : "") : minutes + " min";
}
function formatTime(value, timeZone) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  try { return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", timeZone: timeZone || undefined }).format(date); }
  catch { return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date); }
}
function appendExternalLink(container, link) {
  const url = safeHttpUrl(link?.url);
  if (!url) return;
  const anchor = makeElement("a", link.label || "Open provider");
  anchor.href = url; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
  container.append(anchor);
}

export function renderTransportOptions(container, route, research, state = {}) {
  if (!container) return;
  container.replaceChildren();
  const now = Number.isFinite(Number(state.now)) ? Number(state.now) : Date.now();
  const stale = isResearchStale(research, now);
  const status = makeElement("p", "", "transport-research-status");
  if (state.busy) status.textContent = "Researching scheduled services, operators and published fare feeds…";
  else if (state.error) status.textContent = (research?.options?.length ? "Refresh failed; showing saved research. " : "") + state.error;
  else if (!research) status.textContent = "Choose a departure date and time, then refresh to research available connections.";
  else if (research.status === "no-results") status.textContent = "No scheduled connections were returned for this date and route. Coverage varies by region; this does not prove that no service exists.";
  else status.textContent = (research.options?.length || 0) + " researched option(s) · checked " + new Date(research.researchedAt).toLocaleString();
  container.append(status);

  const external = research?.externalLinks || buildExternalTransportLinks(route, "");
  const externalLinks = makeElement("div", undefined, "transport-research-external");
  appendExternalLink(externalLinks, { label: "Search this route on 12Go", url: external.twelveGo });
  appendExternalLink(externalLinks, { label: "Compare flights", url: external.flights });
  appendExternalLink(externalLinks, { label: "Driving directions", url: external.driving });
  container.append(externalLinks);

  if (research?.options?.length) {
    const byId = new Map(research.options.map(option => [option.id, option]));
    const picks = makeElement("div", undefined, "transport-research-picks");
    const cheapestId = stale ? null : research.picks?.cheapest;
    const bestValueId = stale ? null : research.picks?.bestValue;
    const pickItems = [
      ["Cheapest", cheapestId, research.picks?.cheapestReason || "Not ranked: no comparable published fares."],
      ["Fastest", research.picks?.fastest, "Shortest published journey duration."],
      ["Best value", bestValueId, stale ? "Not ranked: saved fare data is stale." : research.picks?.bestValueReason || "No reliable value comparison."]
    ];
    for (const [label, id, fallback] of pickItems) {
      const option = id ? byId.get(id) : null;
      const card = makeElement("div", undefined, "transport-research-pick");
      card.append(makeElement("strong", label));
      card.append(makeElement("span", option
        ? (option.operators?.[0] || option.modeLabel) + " · " +
          (label === "Cheapest" || label === "Best value" ? formatFare(option.fare) : formatDuration(option.durationSeconds))
        : fallback, option ? "transport-research-pick-value" : "transport-research-pick-muted"));
      picks.append(card);
    }
    container.append(picks);

    const list = makeElement("div", undefined, "transport-research-options");
    for (const option of research.options) {
      const card = makeElement("article", undefined, "transport-research-option");
      const header = makeElement("div", undefined, "transport-research-option-head");
      header.append(makeElement("strong", option.modeLabel));
      header.append(makeElement("span", option.operatorLabel || "Operator not listed", "transport-research-operator"));
      card.append(header);
      const fareLine = makeElement("div", undefined, "transport-research-fare");
      fareLine.append(makeElement("strong", formatFare(option.fare)));
      fareLine.append(makeElement("span", stale ? "STALE PRICE · recheck provider" :
        option.fare ? "UNVERIFIED · feed fare, not checkout" : "UNPRICED · no fare supplied"));
      card.append(fareLine);
      const times = makeElement("div", undefined, "transport-research-times");
      times.append(makeElement("span", "Depart " + formatTime(option.departureTime, option.timeZone)));
      times.append(makeElement("span", "Arrive " + formatTime(option.arrivalTime, option.timeZone)));
      times.append(makeElement("span", formatDuration(option.durationSeconds)));
      card.append(times);
      card.append(makeElement("p", option.transfers + " transfer(s) · " + option.stops + " intermediate stop(s)" +
        (option.realTime ? " · real-time feed data present" : " · scheduled timetable"), "transport-research-meta"));
      if (option.fare?.products?.length) {
        card.append(makeElement("small", "Fare product(s): " +
          option.fare.products.map(product => product.name + " (" + formatFare(product) + ")").join("; "),
          "transport-research-fare-products"));
      }
      if (option.legs?.length) {
        const legList = makeElement("ul", undefined, "transport-research-legs");
        for (const leg of option.legs) {
          const routeName = [leg.operator, leg.route].filter(Boolean).join(" · ");
          legList.append(makeElement("li", (routeName ? routeName + ": " : "") +
            (leg.from || "Boarding point") + " → " + (leg.to || "Alighting point")));
        }
        card.append(legList);
      }
      const booking = makeElement("div", undefined, "transport-research-booking");
      for (const link of option.bookingLinks || []) appendExternalLink(booking, link);
      if (!booking.childElementCount) booking.append(makeElement("span", "No direct booking link supplied by the feed."));
      card.append(booking);
      card.append(makeElement("small", "Source: Transitous · researched " +
        new Date(research.researchedAt).toLocaleDateString(), "transport-research-source-date"));
      list.append(card);
    }
    container.append(list);
  } else if (research && !research.options?.length) {
    container.append(makeElement("p", "No operators, departures or fares were returned. Try another departure time or check the external provider search links above.", "transport-research-empty"));
  }

  if (research?.sources?.length) {
    const details = makeElement("details", undefined, "transport-research-sources");
    details.append(makeElement("summary", "Research sources and dates"));
    const sourceList = makeElement("ul");
    for (const source of research.sources) {
      const item = makeElement("li");
      appendExternalLink(item, { label: source.name, url: source.url });
      item.append(makeElement("small", " · checked " + new Date(source.checkedAt || research.researchedAt).toLocaleString()));
      sourceList.append(item);
    }
    details.append(sourceList);
    container.append(details);
  }
  container.append(makeElement("p",
    "Feed fares are unverified until the operator confirms the final ticket price and availability. Missing prices are not estimated. Transitous is a best-effort community service for open-source, non-commercial use.",
    "transport-research-disclaimer"));
}
