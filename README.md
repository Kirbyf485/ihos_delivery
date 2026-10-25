# IHOS Delivery NetSuite Integration

This repository contains the NetSuite-side integration for the IHOS Ops Portal delivery workflow.

The Ops Portal owns the browser UI, signature capture, PDF generation, and server-to-server calls. This repository owns the SuiteScript RESTlets that NetSuite runs.

## Structure

```text
ihos_delivery/
├── README.md
├── ops_packing_slip_restlet.js
├── ops_signed_packing_slip_restlet.js
├── docs/
├── tests/
└── mock_data/
```

## RESTlets

Unsigned packing slip retrieval:

```text
ops_packing_slip_restlet.js
```

Suggested NetSuite IDs:

```text
Script ID:      customscript_ops_packing_slip_restlet
Deployment ID:  customdeploy_ops_packing_slip_restlet
```

Signed packing slip upload and attachment:

```text
ops_signed_packing_slip_restlet.js
```

Suggested NetSuite IDs:

```text
Script ID:      customscript_ops_signed_packing_slip_res
Deployment ID:  customdeploy_ops_signed_packing_slip_res
Folder Param:   custscript_ops_signed_ps_folder_id=555058
```

The unsigned RESTlet accepts JSON via `POST` and query parameters via `GET`. `POST` is the intended server-to-server path.

Example request:

```json
{
  "item_fulfillment_number": "IF123456"
}
```

or:

```json
{
  "item_fulfillment_internal_id": "12345"
}
```

Example success response:

```json
{
  "ok": true,
  "item_fulfillment": {
    "internal_id": "12345",
    "transaction_number": "IF123456",
    "sales_order_internal_id": "67890",
    "sales_order_number": "SO987654",
    "customer_name": "Example Customer",
    "fulfillment_date": "2026-07-14",
    "shipping_address": "123 Main Street",
    "status": "Shipped"
  },
  "pdf": {
    "content_type": "application/pdf",
    "file_name": "Packing Slip - IF123456.pdf",
    "data": "base64-encoded-pdf"
  }
}
```

The delivery-document RESTlet accepts either a signed packing slip or a no-signature delivery-evidence PDF. Signed packing slips attach to the Item Fulfillment and originating Sales Order and mark `custbody_dt_signed_status` true. No-signature evidence attaches only to the Sales Order and never changes `custbody_dt_signed_status`. The current destination folder is `555058` (`Signed Delivery Tickets`).

## Documentation

- [Deployment](docs/deployment.md)
- [RESTlet Contract](docs/restlet_contract.md)
- [Troubleshooting](docs/troubleshooting.md)

## Local Checks

The included tests are static loader checks for the SuiteScript modules. They do not call NetSuite.

```bash
node tests/ops_packing_slip_restlet_static_test.js
node tests/ops_signed_packing_slip_restlet_static_test.js
```

## Current Limitations

- No customer-facing or mobile flow.
- No offline mode, barcode scanning, or public employee app.
- The RESTlet saves delivery PDFs and creates record attachments. It updates the Item Fulfillment `custbody_dt_signed_status` field only for `signed_packing_slip` documents, never for `no_signature_delivery_evidence`.

### IHOS follow-up delivery attempts

`ops_signed_packing_slip_restlet.js` accepts an optional positive integer
`delivery_attempt` (default 1). The portal chooses this value for an authorized
follow-up assignment. Attempts above 1 store no-location evidence with an
`IF… - Attempt N - Evidence.pdf` filename and check duplicates within that
attempt. Existing signed packing slips remain unique per IF. Success and
confirmed duplicate responses echo `delivery_attempt`; older requests retain
the original behavior. Prior files are never deleted, and this script does not
change NetSuite's Delivery Driver field.

Deploy this script before backend migration `20261024_141` and its corresponding
IHOS release. The backend verifies the echoed attempt, retaining an unsubmitted
entry when an older RESTlet is still deployed. Local tests cover the upload
contract with NetSuite APIs stubbed; verify a second no-location submission in
NetSuite after deploying. No script parameter changes are required.
