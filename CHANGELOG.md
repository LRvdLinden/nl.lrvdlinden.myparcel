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
