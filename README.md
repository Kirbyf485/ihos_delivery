# IHOS Delivery NetSuite Integration

This repository contains the NetSuite-side integration for the IHOS Ops Portal delivery workflow.

Phase 1 is intentionally narrow: the Ops Portal sends an Item Fulfillment number or internal ID, NetSuite resolves the Item Fulfillment, renders the existing packing slip PDF, and returns the PDF to the Ops Portal. This project does not capture signatures, upload files, attach documents, email customers, or modify NetSuite records.

## Structure

```text
ihos_delivery/
├── README.md
├── ops_packing_slip_restlet.js
├── docs/
├── tests/
└── mock_data/
```

## RESTlet

Primary script:

```text
ops_packing_slip_restlet.js
```

Suggested NetSuite IDs:

```text
Script ID:      customscript_ops_packing_slip_restlet
Deployment ID:  customdeploy_ops_packing_slip_restlet
```

The RESTlet accepts JSON via `POST` and query parameters via `GET`. `POST` is the intended server-to-server path.

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

## Documentation

- [Deployment](docs/deployment.md)
- [RESTlet Contract](docs/restlet_contract.md)
- [Troubleshooting](docs/troubleshooting.md)

## Local Checks

The included test is a static loader check for the SuiteScript module. It does not call NetSuite.

```bash
node tests/ops_packing_slip_restlet_static_test.js
```

## Phase 1 Limitations

- No signature capture.
- No File Cabinet uploads.
- No Sales Order or Item Fulfillment attachments.
- No NetSuite record updates.
- No customer-facing or mobile flow.
