DHL Express Homey Login Helper 0.1.2

1. Open chrome://extensions and enable Developer mode.
2. Remove or disable older DHL Express Homey Login Helper versions.
3. Choose Load unpacked and select this folder.
4. Open the helper and choose Open MyDHL+ login.
5. Sign in normally through DHLPass.
6. In MyDHL+, open Manage Shipments > All Shipments once.
7. The helper keeps the signed-in browser session in Chrome even if the popup is closed.
8. Copy the generated DHLEXPRESS1 session code.
9. Paste that code into the DHL Express pair/repair screen in MyParcel.

The helper stores the signed-in MyDHL+ session context, browser storage and relevant shipment requests. It does not store your DHL password.

Treat the generated Homey session code like a password and use it only in your own Homey.

0.1.2 changes:
- Full DHL Express yellow/red branding in Chrome, popup and result page.
- Dedicated 16/32/48/128 px toolbar icons.
- Session-preserving MyDHL+ logic remains unchanged.
