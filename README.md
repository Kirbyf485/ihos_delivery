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
Script ID:      customscript_ops_signed_packing_slip_restlet
Deployment ID:  customdeploy_ops_signed_packing_slip_restlet
Folder Param:   custscript_ops_signed_ps_folder_id
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

The signed RESTlet accepts a server-generated signed PDF from the Ops Portal, saves it to the configured File Cabinet folder, and attaches the same file to the Item Fulfillment and originating Sales Order. It does not update transaction fields.

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
- The signed RESTlet saves a File Cabinet file and creates file attachments only; it does not edit Item Fulfillment or Sales Order fields.
