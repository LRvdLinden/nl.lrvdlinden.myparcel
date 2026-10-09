'use strict';

/*
 * Budbee tracking – port of ha-budbee (https://github.com/ha-parcel-integrations/ha-budbee),
 * MIT License, Copyright (c) 2026 ha-parcel-integrations contributors.
 * Public, keyless consumer tracking API; the tracking code is the only credential.
 */

const { CarrierError, request, parseJson, isObject, toIso } = require('./carrier-http');
const { tr } = require('./i18n');

const API = 'https://tracking.budbee.com/api';
const C = 'Budbee';

const STATUS_MAP_DELIVERY = {
  NotStarted: 'registered', OnRouteCollection: 'in_transit', Collected: 'in_transit', CrossDocked: 'in_transit',
  OnRouteDelivery: 'out_for_delivery', Delivered: 'delivered', Miss: 'problem', Backordered: 'problem',
  CollectedShippingLabel: 'in_transit', ReturnedToTerminal: 'in_transit', ReturnedToMerchant: 'returning',
};
// Locker orders: "Delivered" = waiting IN the locker, "PickedUp" = collected.
const STATUS_MAP_BOX = {
  NotStarted: 'registered', Pending: 'registered', Collected: 'in_transit', CollectedShippingLabel: 'in_transit',
  DroppedOff: 'in_transit', Delivered: 'at_pickup_point', PickedUp: 'delivered', Undelivered: 'problem',
  ReturnedToTerminal: 'in_transit', ReturnedToMerchant: 'returning',
};
const STATUS_TEXT = {
  NotStarted: 'Registered', Pending: 'Registered', OnRouteCollection: 'On its way to Budbee', Collected: 'Collected by Budbee',
  CrossDocked: 'At the Budbee terminal', OnRouteDelivery: 'Courier on the way', Delivered: 'Delivered', Miss: 'Delivery missed',
  Backordered: 'Delayed', CollectedShippingLabel: 'Label collected', ReturnedToTerminal: 'Back at the Budbee terminal',
  ReturnedToMerchant: 'Returned to the shop', DroppedOff: 'Dropped off in a locker', PickedUp: 'Picked up', Undelivered: 'Not delivered',
};

/**
 * Budbee event labels in 13 languages, keyed by the English source label above (STATUS_TEXT).
 * The source label stays in the parcel data (trigger memory compares it); devices translate it for display.
 */
const LABELS = {
  "Registered": { en: "Registered", nl: "Aangemeld", de: "Angekündigt", fr: "Annoncé", it: "Registrato", sv: "Registrerad", no: "Registrert", es: "Registrado", da: "Registreret", ru: "Зарегистрирована", pl: "Zarejestrowana", ko: "접수됨", ar: "مسجّل" },
  "On its way to Budbee": { en: "On its way to Budbee", nl: "Onderweg naar Budbee", de: "Unterwegs zu Budbee", fr: "En route vers Budbee", it: "In viaggio verso Budbee", sv: "På väg till Budbee", no: "På vei til Budbee", es: "En camino a Budbee", da: "På vej til Budbee", ru: "В пути в Budbee", pl: "W drodze do Budbee", ko: "Budbee로 이동 중", ar: "في الطريق إلى Budbee" },
  "Collected by Budbee": { en: "Collected by Budbee", nl: "Opgehaald door Budbee", de: "Von Budbee abgeholt", fr: "Pris en charge par Budbee", it: "Ritirato da Budbee", sv: "Hämtat av Budbee", no: "Hentet av Budbee", es: "Recogido por Budbee", da: "Afhentet af Budbee", ru: "Получена Budbee", pl: "Odebrana przez Budbee", ko: "Budbee가 수거함", ar: "استلمته Budbee" },
  "At the Budbee terminal": { en: "At the Budbee terminal", nl: "In de Budbee-terminal", de: "Im Budbee-Terminal", fr: "Au terminal Budbee", it: "Al terminal Budbee", sv: "På Budbee-terminalen", no: "På Budbee-terminalen", es: "En la terminal de Budbee", da: "På Budbee-terminalen", ru: "На терминале Budbee", pl: "W terminalu Budbee", ko: "Budbee 터미널 도착", ar: "في محطة Budbee" },
  "Courier on the way": { en: "Courier on the way", nl: "Bezorger onderweg", de: "Zusteller unterwegs", fr: "Livreur en route", it: "Corriere in arrivo", sv: "Budet är på väg", no: "Budet er på vei", es: "Repartidor en camino", da: "Buddet er på vej", ru: "Курьер в пути", pl: "Kurier w drodze", ko: "배송 기사 이동 중", ar: "المندوب في الطريق" },
  "Delivered": { en: "Delivered", nl: "Bezorgd", de: "Zugestellt", fr: "Livré", it: "Consegnato", sv: "Levererad", no: "Levert", es: "Entregado", da: "Leveret", ru: "Доставлена", pl: "Doręczona", ko: "배송 완료", ar: "تم التسليم" },
  "Delivery missed": { en: "Delivery missed", nl: "Bezorging gemist", de: "Zustellung verpasst", fr: "Livraison manquée", it: "Consegna mancata", sv: "Missad leverans", no: "Levering mislyktes", es: "Entrega fallida", da: "Levering mislykkedes", ru: "Доставка не состоялась", pl: "Nieudane doręczenie", ko: "배송 실패", ar: "تعذّر التسليم" },
  "Delayed": { en: "Delayed", nl: "Vertraagd", de: "Verspätet", fr: "Retardé", it: "In ritardo", sv: "Försenad", no: "Forsinket", es: "Retrasado", da: "Forsinket", ru: "Задерживается", pl: "Opóźniona", ko: "지연됨", ar: "متأخر" },
  "Label collected": { en: "Label collected", nl: "Label opgehaald", de: "Etikett abgeholt", fr: "Étiquette récupérée", it: "Etichetta ritirata", sv: "Etikett hämtad", no: "Etikett hentet", es: "Etiqueta recogida", da: "Label afhentet", ru: "Этикетка получена", pl: "Etykieta odebrana", ko: "라벨 수거됨", ar: "تم استلام الملصق" },
  "Back at the Budbee terminal": { en: "Back at the Budbee terminal", nl: "Terug in de Budbee-terminal", de: "Zurück im Budbee-Terminal", fr: "De retour au terminal Budbee", it: "Di nuovo al terminal Budbee", sv: "Tillbaka på Budbee-terminalen", no: "Tilbake på Budbee-terminalen", es: "De vuelta en la terminal de Budbee", da: "Tilbage på Budbee-terminalen", ru: "Возвращена на терминал Budbee", pl: "Z powrotem w terminalu Budbee", ko: "Budbee 터미널로 반송됨", ar: "عاد إلى محطة Budbee" },
  "Returned to the shop": { en: "Returned to the shop", nl: "Teruggestuurd naar de winkel", de: "An den Shop zurückgeschickt", fr: "Renvoyé au magasin", it: "Restituito al negozio", sv: "Returnerat till butiken", no: "Returnert til butikken", es: "Devuelto a la tienda", da: "Returneret til butikken", ru: "Возвращена в магазин", pl: "Zwrócona do sklepu", ko: "상점으로 반품됨", ar: "أُعيد إلى المتجر" },
  "Dropped off in a locker": { en: "Dropped off in a locker", nl: "Afgeleverd in een kluis", de: "In einem Schließfach abgegeben", fr: "Déposé dans une consigne", it: "Depositato in un locker", sv: "Lämnat i ett skåp", no: "Levert i et skap", es: "Depositado en una taquilla", da: "Afleveret i et skab", ru: "Помещена в постамат", pl: "Nadana w automacie", ko: "보관함에 맡겨짐", ar: "أُودع في خزانة" },
  "Picked up": { en: "Picked up", nl: "Opgehaald", de: "Abgeholt", fr: "Retiré", it: "Ritirato", sv: "Hämtat", no: "Hentet", es: "Recogido", da: "Afhentet", ru: "Получена", pl: "Odebrana", ko: "수령 완료", ar: "تم الاستلام" },
  "Not delivered": { en: "Not delivered", nl: "Niet bezorgd", de: "Nicht zugestellt", fr: "Non livré", it: "Non consegnato", sv: "Inte levererat", no: "Ikke levert", es: "No entregado", da: "Ikke leveret", ru: "Не доставлена", pl: "Niedoręczona", ko: "배송되지 않음", ar: "لم يتم التسليم" },
  "Ready in the Budbee Box": { en: "Ready in the Budbee Box", nl: "Klaar in de Budbee Box", de: "Abholbereit in der Budbee Box", fr: "Prêt dans la Budbee Box", it: "Pronto nel Budbee Box", sv: "Redo i Budbee Box", no: "Klar i Budbee Box", es: "Listo en el Budbee Box", da: "Klar i Budbee Box", ru: "Готова к выдаче в Budbee Box", pl: "Gotowa do odbioru w Budbee Box", ko: "Budbee Box에서 수령 가능", ar: "جاهز في Budbee Box" },
};

/** Display text for a Budbee label (unknown labels – e.g. raw codes – are returned unchanged). */
function labelText(homey, label) { return LABELS[label] ? tr(homey, LABELS[label]) : label; }

function normalizeCode(value) { return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ''); }

async function getJson(url, { notFoundStatus = null } = {}) {
  const res = await request(url, { headers: { Accept: 'application/json' } }, { carrier: C });
  if (notFoundStatus && res.status === notFoundStatus) return null;
  const text = await res.text();
  if (res.status !== 200) throw new CarrierError(`Budbee request failed (HTTP ${res.status})`, { status: res.status });
  const body = parseJson(text);
  if (body === undefined) throw new CarrierError('Budbee returned an unreadable response');
  return body;
}

function unwrap(body) {
  if (!isObject(body)) throw new CarrierError('Budbee returned an unexpected response');
  if (body.errorCode === 'ORDER_NOT_FOUND') return null;
  if (body.errorCode) throw new CarrierError(`Budbee: ${body.errorCode}`);
  if (body.status === 'FAILED') throw new CarrierError(`Budbee: ${body.errorMsg || 'FAILED'}`);
  return isObject(body.payload) ? body.payload : null;
}

class BudbeeClient {
  constructor() { this.meta = {}; }

  forget(code) { delete this.meta[code]; }

  /** Parcel payload with `meta` merged in, or null when Budbee does not know the code (yet). */
  async parcel(code) {
    let meta = this.meta[code];
    if (!meta) {
      meta = unwrap(await getJson(`${API}/v3/orders/${encodeURIComponent(code)}/meta`));
      if (!meta) return null;
      this.meta[code] = meta;
    }
    const readBox = async () => {
      const body = await getJson(`${API}/box/${encodeURIComponent(code)}`, { notFoundStatus: 404 });
      if (body !== null && !isObject(body)) throw new CarrierError('Budbee returned an unexpected locker response');
      return body;
    };
    const readOrder = async () => {
      const payload = unwrap(await getJson(`${API}/v3/orders/${encodeURIComponent(code)}`));
      if (!payload) return null;
      return isObject(payload.conspectus) ? payload.conspectus : payload;
    };
    let raw;
    if (meta.type === 'BOX') raw = await readBox();
    else if (meta.type === 'DELIVERY') raw = await readOrder();
    else raw = (await readBox()) || (await readOrder());
    return raw ? { ...raw, meta } : null;
  }
}

function unmasked(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return !text || /^\*+$/.test(text) ? '' : text;
}

function lockerName(raw) {
  const candidates = [raw.lockerAddress];
  if (isObject(raw.lockerAttributes)) candidates.push(raw.lockerAttributes.address);
  for (const a of candidates) {
    if (!isObject(a)) continue;
    const name = unmasked(a.name);
    if (name) return name;
    const street = unmasked(a.street);
    const city = unmasked(a.city);
    if (street || city) return [street, city].filter(Boolean).join(', ');
  }
  return '';
}

function normalize(raw, code) {
  const r = isObject(raw) ? raw : { token: code };
  const type = r.meta?.type === 'BOX' || r.meta?.type === 'DELIVERY' ? r.meta.type : (isObject(r.status) ? 'DELIVERY' : 'BOX');
  const rawStatus = isObject(r.status) ? String(r.status.state || '') : String(r.status || '');
  const map = type === 'BOX' ? STATUS_MAP_BOX : STATUS_MAP_DELIVERY;
  const status = rawStatus ? (map[rawStatus] || 'unknown') : 'unknown';
  const delivered = status === 'delivered';
  const outgoing = (isObject(r.consignment) && ['RETURN', 'ON_DEMAND_PICKUP'].includes(r.consignment.type)) || rawStatus === 'CollectedShippingLabel';
  let plannedFrom = null;
  let plannedTo = null;
  if (!delivered) {
    if (type === 'BOX') plannedFrom = toIso(r.eta || r.etaInformation?.eta); // a locker ETA is a single moment
    else {
      plannedFrom = toIso(r.consignment?.start);
      plannedTo = toIso(r.consignment?.stop);
      if (plannedFrom && plannedTo && Date.parse(plannedFrom) === Date.parse(plannedTo)) plannedTo = null;
    }
  }
  const barcode = normalizeCode(r.token || code);
  const locker = lockerName(r);
  let label = STATUS_TEXT[rawStatus] || rawStatus;
  if (type === 'BOX' && rawStatus === 'Delivered') label = 'Ready in the Budbee Box';
  return {
    barcode,
    sender: unmasked(r.merchant?.name),
    receiver: unmasked(r.consumer?.name),
    status,
    rawStatus: label,
    statusCode: rawStatus,
    delivered,
    deliveredAt: delivered ? toIso(type === 'BOX' ? r.deliveredAt : r.status?.date) : null,
    plannedFrom,
    plannedTo,
    windowKnown: Boolean(plannedFrom && plannedTo),
    pickup: status === 'at_pickup_point' || type === 'BOX',
    pickupPoint: locker,
    pickupDeadline: type === 'BOX' && status === 'at_pickup_point' ? toIso(r.latestPickupDate) : null,
    url: barcode ? `https://track.budbee.com/${barcode}` : '',
    weight: null,
    dimensions: null,
    history: rawStatus ? [{ timestamp: toIso(isObject(r.status) ? r.status.date : (r.deliveredAt || r.createdAt)), status, rawStatus: label }].filter(e => e.timestamp) : [],
    direction: outgoing ? 'outgoing' : 'incoming',
    deliveryType: type === 'BOX' ? 'locker' : 'home',
    remainingStops: Number(r.eta?.remainingStopCount ?? NaN),
    pending: !isObject(raw),
  };
}

module.exports = { BudbeeClient, normalize, normalizeCode, labelText, LABELS, STATUS_MAP_BOX, STATUS_MAP_DELIVERY };
