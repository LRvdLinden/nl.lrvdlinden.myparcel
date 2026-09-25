## 0.2.3 — Delivery window Flow cards
- Added device-specific **Delivery window available or changed** trigger cards for supported carrier devices that expose delivery-window data.
- Added invertible **Delivery window is known** condition cards for the same supported carrier devices.
- Delivery-window triggers only fire when a window becomes available for the first time or actually changes, not on every poll.
- Added Flow tokens for carrier, tracking number, sender, delivery date, delivery window, window start, window end and localized status.
- Added full translations for the new Flow cards and tokens in all 13 supported MyParcel languages: EN, NL, DE, FR, IT, SV, NO, ES, DA, RU, PL, KO and AR.

## 0.2.2 — Package widget details & timing
- Rebuilt the package detail popup to use the same proven modal behaviour as the PostNL mail widget, with a visible close button and reliable row click/keyboard activation.
- The popup shows carrier logo, localized status, sender, tracking number, delivery date, delivery window, latest event, last update and carrier-specific details when available.
- DHL widget data now exposes richer event/detail metadata for the popup.
- Package rows now consistently show `DD-MM-YYYY` plus the best relevant time: the delivery window for active shipments when available, otherwise the status-event/update time (including delivered and announced shipments).
- Fixed DHL package rows so the delivery date is shown together with the delivery window.
- Matched the MyParcel Packages header font size, weight and light/dark text colour to the PostNL mail widget.
- Removed the Track & Trace action from the package popup.
- Popup labels remain translated in all 13 supported MyParcel languages and support light/dark mode.
- Popup status and latest-event values now use the same app-wide localized package status as device capabilities and Flow tokens.

## 0.2.1 — Package status & DHL delivery window fixes
- Fixed package status presentation app-wide so raw carrier codes such as `IN_DELIVERY` are localized consistently in device capabilities, widgets and Flow tokens.
- Applied the same status normalization across all supported parcel carriers.
- Fixed DHL Parcel delivery date/time extraction from My DHL `receivingTimeIndication` (the field used by the official app), `plannedDeliveryTimeframe` and DHL tracking events.
- DHL Parcel now performs a best-effort track & trace detail lookup when the account parcel summary does not contain a delivery window.
- Fixed DHL status-change state storage so localized display values do not cause false repeated status-change triggers.

- Split DHL Parcel delivery information into separate **Delivery date** and **Delivery window** capabilities.
- DHL Parcel delivery dates are now shown as `DD-MM-YYYY`; the delivery-window capability contains only the time window.
- Added separate DHL Flow tokens for `delivery_date` and `delivery_window`.
- Added connection status monitoring across every MyParcel device, with a connection-status Flow trigger/token set.
- Added a Timeline reconnect notification when a device changes to not connected, while avoiding duplicate auth-expiry notifications.
- Simplified the PostNL Status capability to only show the connection state (for example `Verbonden`).
- Standardized the visible connection capability name to **Connection status** on every carrier device, translated in all 13 supported languages.
- DHL Parcel delivery-window timestamps are now converted to the timezone configured on Homey before being shown in capabilities, Flow tokens and the package widget.
## 0.2.0 — First Beta Release
- First public beta release of MyParcel.
- Brings supported parcel carriers together in one Homey app.
- Includes the current carrier integrations, devices, Flow support and MyParcel widgets.
- Includes the PostNL live/current-mail handling and rolling 21-day mail widget history.
- Includes localized package statuses across widgets, capabilities and Flow tokens.
- Includes the supported country/carrier overview and Community-based installation instructions.
- Includes all fixes and improvements from the 0.1.x development releases.

## 0.1.25
- Updated the app subtitle to: `MyParcel brings supported parcel carriers together in Homey`.
- Simplified all README files and moved carrier-specific installation instructions to the MyParcel Community topic.
- Updated the supported countries and carriers overview.

## 0.1.24
- Updated the Homey app title to the concise store-compliant name `MyParcel`.
- Aligned README structure and presentation with the PostNL app while preserving MyParcel-specific carrier and linking instructions.
- Aligned Homey Store tags with PostNL and extended them with the supported MyParcel carriers.
- Preserved the 0.1.23 PostNL live-mail, 21-day widget archive and multilingual package-status improvements.

## 0.1.23
- Package status localization is now shared across widgets, device capabilities and Flow tokens for all carriers and all 13 supported languages.
- MyParcel Pakketten now translates raw carrier status codes consistently, including Dutch `Bezorgd`, `Onderweg`, `Onderweg voor bezorging`, `Aangemeld`, `Klaar om op te halen`, `Vertraagd`, `Retour` and related statuses across carriers.
- PostNL Poststukken widget now shows the complete rolling 21-calendar-day archive, newest first, instead of limiting the widget API to 10 items.
- Device capabilities and Flow tokens remain current/live only; camera uses the newest current mail item with no-mail fallback; next delivery is today/future only.
- Audited custom capability titles across all supported languages and normalized readable status wording without decorative status symbols.

- Ported the proven PostNL 1.1.3 live/current-mail fixes into MyParcel.
- PostNL device capabilities now use only mail items currently returned by PostNL and dated today or later; the 21-day archive remains widget-only.
- `Post`, `Poststukken`, `Volgende bezorging`, camera image and mail Flow tokens now follow the current/live PostNL state instead of stale archived items.
- Added the PostNL no-mail fallback camera image so an old envelope image is no longer left behind when there is no current mail.
- `Volgende bezorging` no longer selects historical delivery dates.
- New-mail triggers compare the current live list and avoid archive-only false triggers.
- PostNL package time/date Flow tokens now use localized Homey date/time formatting.
- The PostNL widget continues to show the recent archive, newest first, independently from the live device capabilities.
- Existing Post & DHL Germany, UPS, DHL NL, bpost and all other carrier integrations are unchanged.

## 0.1.22
- Fixed Homey publish validation for all Post & DHL Germany custom capabilities by declaring them as read-only (`getable: true`, `setable: false`).
- Added new **Post & DHL Germany** device.
- Added PKCE OAuth login flow for the German Post & DHL account.
- Added automatic German DHL shipment retrieval and token refresh.
- German DHL packages are included in the existing **MyParcel Packages** widget.
- Added a separate **Deutsche Post Mail** widget architecture for Briefankündigung/envelope images.
- Briefankündigung retrieval is deliberately marked as capture-required until the current private consumer endpoint is verified; no endpoint is fabricated.
- Existing PostNL, DHL NL, UPS, bpost and other carrier integrations are unchanged.

## 0.1.21
- Fixed UPS HTTP 405 on `GetIncomingShipments`.
- UPS PPC API actions are sent as POST, matching the working UPS dashboard traffic.
- Automatic UPS/My Choice session retrieval is working with UPS Token Helper 0.1.5.
- UPS `Last update` now uses the same localized Homey date/time formatting as the PostNL device instead of a raw ISO timestamp.
- Updated `.homeychangelog.json` through version 0.1.21.
- No bpost or other carrier integration was changed.

## 0.1.20
- Fixed UPS PPC session refresh only; bpost and all other carriers are unchanged.
- UPS now first calls `GetIncomingShipments` directly with the authenticated browser session captured by Token Helper 0.1.4.
- PPC initialization is replayed only if UPS rejects the captured session.
- Added an in-memory cookie jar so cookies returned by UPS during session initialization are retained for subsequent calls.
- UPS account status now exposes HTTP/session failures instead of only showing `Disconnected`.

## 0.1.19
- UPS now uses the authenticated PPC web-session captured by UPS Token Helper 0.1.4.
- Added support for the actual UPS dashboard endpoint `GetIncomingShipments`.
- Replays the observed UPS PPC session initialization before refreshing incoming shipments.
- UPS OIDC callbacks are no longer used as package API credentials.
- UPS session expiry is reported as a reconnect requirement.

## 0.1.18
- Reworked UPS pairing around the actual UPS consumer web-session behaviour.
- An OIDC callback is no longer accepted as usable UPS API authentication, preventing empty UPS devices with all capabilities set to `-`.
- UPS `web_bearer` login data is accepted when the helper really observes reusable Bearer authentication.
- UPS account status distinguishes a captured web login from reusable authentication.
- Manual UPS tracking remains available as fallback.
- Removed the incorrect assumption that MyParcel can exchange the UPS consumer dashboard authorization code without owning its PKCE transaction.

# Changelog

## 0.1.16
- UPS pairing now accepts and validates the complete `ups://login?mode=web_oidc&code=...&state=...` callback from UPS Token Helper.
- The callback authorization code and state are parsed and stored separately instead of being treated as a bearer token.
- UPS pairing/repair retains the carrier logo, Homey-native layout and all 13 app languages.
- Manual tracking fallback remains available.
- Added the correct groundwork for the subsequent UPS OAuth token exchange.


## 0.1.15
- Added the carrier logo to the UPS pairing and repair screens.
- Audited internationalization against the Homey internationalization requirements.
- Ensured all 13 Homey app languages are present: EN, NL, DE, FR, IT, SV, NO, ES, DA, RU, PL, KO and AR.
- Completed missing manifest translation keys with English fallback values where a dedicated translation was not present.
- Localized the complete UPS pair/repair interface in all supported languages.
- Added RTL handling for Arabic custom views.
- Ensured translated README files exist for every supported app language.
- No carrier API logic was changed in this release.


## 0.1.14
- Fixed UPS pairing after the direct username/password mobile login returned `Invalid Authentication Information`.
- Removed the incorrect direct UPS password submission from pairing.
- UPS pairing now supports an authenticated UPS session and a manual tracking fallback.
- Rebuilt UPS pair and repair views with Homey form components and no custom visual CSS.
- Country and locale selection remain available for international UPS accounts.
- Existing bpost and other carrier integrations are unchanged.


## 0.1.13
- Reworked UPS as an international UPS / UPS My Choice account device.
- Added country and locale-aware account pairing based on the UPS Android 10.34.1.8 mobile interfaces.
- Added automatic UPS homepage track-list retrieval instead of requiring a list of tracking numbers.
- Added rich UPS capabilities for total/active packages, tracking, sender, delivery date/window, service, origin, destination, Access Point, last event, country, locale and account status.
- Expanded UPS Flow tokens and added a delivered trigger plus account-connected condition.
- UPS now refreshes every 5 minutes and remains integrated with MyParcel Packages.
- The working bpost 0.1.12 integration is unchanged.


## 0.1.12
- Fixed bpost account integration: removed the incorrect speculative OTP/app-API login.
- My bpost now uses the proven bpost.be PingFederate SAML web-login flow with e-mail and password.
- Automatically reads receiving parcels from the authenticated Mijn bpost parcel-history page.
- Enriches discovered parcels through bpost's tracking API.
- Keeps all rich bpost capabilities, Flow tokens/cards and MyParcel Packages widget integration from 0.1.11.
- Manual BARCODE|POSTCODE remains available as fallback.


## 0.1.11
- Reworked bpost around the My bpost account model found in Android app 3.45.2.
- Added direct e-mail + verification-code pairing flow using the My bpost account endpoints.
- Added automatic account parcel retrieval with token refresh and reconnect notification.
- Kept BARCODE|POSTCODE as a manual fallback.
- Increased bpost polling to every 5 minutes.
- Added rich bpost capabilities: total/active parcels, tracking number, sender, expected delivery, delivery window, delivery point, weight, product, delivery partner, last event and account status.
- Expanded bpost Flow tokens with parcel details.
- Added delivery-information-updated and delivered triggers, plus an account-connected condition.
- MyParcel Packages continues to receive the full normalized bpost parcel list.


## 0.1.10
- Updated the MyParcel app/store artwork to include Royal Mail alongside the existing carriers.
- Added Royal Mail as a United Kingdom carrier.
- Added automatic Royal Mail Click & Drop account integration using the official API authorisation key.
- Royal Mail automatically retrieves recent Click & Drop orders; no manual tracking-number list is required.
- Added Royal Mail package count, status and last-update capabilities.
- Added Royal Mail new-package/status-change triggers, packages-underway condition and refresh action.
- Added Royal Mail to the MyParcel Packages widget and device selector.
- Added the supplied Royal Mail driver icon, small/large device artwork and Royal Mail logo.
- Updated README files to list Royal Mail under United Kingdom support.


## 0.1.9
- GLS now supports automatic recent-shipment discovery from the authenticated GLS ShipIT/MyGLS account; manual tracking-number entry is no longer required for GLS.
- Replaced the Homey app store small, large and xlarge artwork with the new PostNL/DHL/UPS/DPD/Budbee/Homerr/FedEx/GLS/bpost/InPost UK artwork.
- Documented which carriers can use account/API integrations and which currently require carrier tracking because no supported recipient inbox API is documented.
- Added a working InPost UK tracking driver using InPost UK's parcel tracking service.
- Added a working Belgian bpost tracking driver using bpost Track & Trace (barcode + optional receiver postcode).
- Added InPost UK and bpost to the MyParcel Packages widget and device selector.
- Added capabilities, status-change/new-package triggers, underway conditions and refresh actions for both carriers.
- Updated all README language files with supported countries and carriers: Netherlands, Belgium and United Kingdom.


## 0.1.8
- Fixed an immediate Homey startup crash in ManagerDashboards.
- Restored the missing `settings: []` array for the PostNL Poststukken widget, matching the working PostNL v1.1.0 widget manifest.
- Kept the PostNL Poststukken widget linked exclusively to the selected PostNL device.
- No PostNL mail/widget functionality from v0.1.7 was removed.


## 0.1.7
- Restored the PostNL mail widget one-to-one from the proven standalone PostNL v1.1.0 implementation, connected specifically to the PostNL device.
- Restored click-to-enlarge for PostNL mail scans.
- PostNL mail widget again keeps and displays the archived mail scans exactly like the standalone PostNL app.
- Fixed PostNL device `Post expected` and mail count so archived/delivered mail no longer counts as upcoming mail.
- Fixed `Next delivery` so an old archived mail date is no longer shown as the next delivery.
- Kept the MyParcel PostNL authentication-expiry improvements.


## 0.1.6
- Fixed the GLS driver icon SVG so it is centered and renders correctly in the Homey driver picker.
- Kept the MyParcel Community topic as support and bug URL.
- Kept all driver names carrier-only.


## 0.1.5
- Updated the MyParcel Community/support and bug URL to the official MyParcel Community topic.
- Simplified every driver/device display name to the carrier name only: PostNL, DHL, DPD, UPS, Budbee, Homerr, FedEx and GLS.
- Added FedEx and GLS / MyGLS drivers.
- Added real coloured FedEx and GLS logos to pairing, repair and package widget rows.
- Added device-specific FedEx and GLS capabilities, Flow cards and one-time credential-expiry Timeline notifications.
- Added FedEx and GLS to the MyParcel Packages widget.
- Fixed the MyParcel Packages widget device selector so one or more package devices can be selected.
- The package widget only loads packages from the selected device(s).
- The package widget header icon now uses the exact MyParcel app brand colour from app.json (#105945).


## 0.1.4
- Improved light and dark mode styling for both dashboard widgets, including explicit text, row, header, status and image colours.
- Added real coloured carrier logos above all PostNL, DHL Parcel, DPD, UPS, Budbee and Homerr pairing and repair screens.
- Replaced the placeholder Budbee, DPD and UPS pairing logos with proper coloured vector logos.
- Centered the Homerr driver images and adjusted the Homerr monochrome driver icon alignment.
- Budbee remains tracking/order-number based because the parcel tracking interface used by the app does not require an account login.


## 0.1.3
- Fixed the Budbee driver icon SVG so it renders correctly in Homey.
- MyParcel Packages now uses the app icon in the widget header.
- MyParcel Packages is sorted from newest to oldest.
- Package status is now shown in the right-hand status pill instead of the carrier name.
- Added multi-device selection for supported package services in the MyParcel Packages widget.
- Fixed PostNL Mail widget device selection so the selected PostNL device is correctly passed to the widget API.


## 0.1.1
- Added Homerr / Vinted Go as a device with passwordless e-mail verification, refresh-token handling and automatic account parcel import.
- DPD / myDPD now has real account sign-in with e-mail/password and automatic parcel synchronization.
- UPS now supports the official UPS OAuth Authorization Code sign-in flow. Tracking numbers configured on the UPS device are fetched through the UPS Track API.
- Budbee now works with Budbee order/tracking numbers through its consumer tracking service; no Budbee account password is required.
- Added the carrier logo above every PostNL, DHL Parcel, DPD, UPS, Budbee and Homerr pairing/repair page.
- MyParcel Packages aggregates all supported package devices and shows the matching carrier logo on each parcel row.
- PostNL Mail remains restricted to PostNL devices.
- DPD, UPS and Homerr authentication-expiry notifications are device-specific and are sent only once per expiry episode, resetting after a successful reconnect. Existing PostNL and DHL expiry handling remains device-specific as well.
- Flow triggers, conditions, actions and Flow tokens remain tied to the selected carrier device.
- Existing user-adjusted device names and driver images are preserved.

## 0.1.0
- Initial MyParcel app with PostNL and DHL Parcel devices.
