# RESTlet Contract

## Endpoint

NetSuite RESTlet URL shape:

```text
https://<ACCOUNT>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=<SCRIPT_ID>&deploy=<DEPLOYMENT_ID>
```

Recommended IDs:

```text
SCRIPT_ID=customscript_ops_packing_slip_restlet
DEPLOYMENT_ID=customdeploy_ops_packing_slip_restlet
```

## Methods

`POST` is the supported production method. `GET` is included for quick NetSuite-side diagnostics.

## Request

Provide one of these fields:

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

Aliases accepted by the RESTlet:

- `item_fulfillment_number`
- `itemFulfillmentNumber`
- `if_number`
- `ifNumber`
- `tranid`
- `transaction_number`
- `transactionNumber`
- `item_fulfillment_internal_id`
- `itemFulfillmentInternalId`
- `internal_id`
- `internalId`
- `id`

## Success Response

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

## Error Response

The RESTlet returns JSON errors without PDF contents:

```json
{
  "ok": false,
  "code": "ITEM_FULFILLMENT_NOT_FOUND",
  "message": "No Item Fulfillment was found for IF123456."
}
```

Common codes:

- `MISSING_ITEM_FULFILLMENT`
- `INVALID_ITEM_FULFILLMENT_NUMBER`
- `ITEM_FULFILLMENT_NOT_FOUND`
- `MULTIPLE_ITEM_FULFILLMENTS`
- `ITEM_FULFILLMENT_MISMATCH`
- `MISSING_SALES_ORDER`
- `SOURCE_TRANSACTION_NOT_SALES_ORDER`
- `EMPTY_PDF`

## Logging

The RESTlet logs:

- request received
- Item Fulfillment number when present
- resolved Item Fulfillment internal ID
- Sales Order internal ID
- render success
- render failure

It does not log credentials, OAuth headers, or PDF contents.
