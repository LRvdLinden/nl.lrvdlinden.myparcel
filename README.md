# MyParcel for Homey

MyParcel combines the existing PostNL and DHL Parcel Homey integrations in one app. It is an app name only: there is no MyParcel.nl API integration.

- PostNL device with existing pairing, repair, capabilities and Flow cards
- DHL Parcel device with existing pairing, repair, capabilities and Flow cards
- PostNL Mail widget aggregating mail items from all PostNL devices
- MyParcel Packages widget aggregating PostNL and DHL Parcel shipments, with the carrier logo shown for every shipment
- Languages: English, Dutch, German, French, Italian, Swedish, Norwegian, Spanish, Danish, Russian, Polish, Korean and Arabic

App ID: `nl.lrvdlinden.MyParcel`  
Brand color: `#105945`

## 0.1.1 carrier expansion

The MyParcel Packages widget now automatically combines package data from all supported package devices in Homey. PostNL Mail remains restricted to a single PostNL device.

DPD/myDPD, UPS My Choice and Budbee have been added as device foundations. Their consumer apps do expose account-wide parcel overviews, but the publicly documented APIs are not equivalent to those consumer-account interfaces. The 0.1.1 driver foundations therefore do not pretend that a consumer login is working yet; verified consumer-session endpoints are required before those three drivers can retrieve real account packages.
