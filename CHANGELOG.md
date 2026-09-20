# Changelog

## 0.1.2
- Change driver images.

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
