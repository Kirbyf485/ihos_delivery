# RESTlet Contract

## NetSuite Endpoint Shape

NetSuite RESTlet URL shape:

```text
https://<ACCOUNT>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=<SCRIPT_ID>&deploy=<DEPLOYMENT_ID>
```

Recommended IDs:

```text
UNSIGNED_SCRIPT_ID=customscript_ops_packing_slip_restlet
UNSIGNED_DEPLOYMENT_ID=customdeploy_ops_packing_slip_restlet
SIGNED_SCRIPT_ID=customscript_ops_signed_packing_slip_res
SIGNED_DEPLOYMENT_ID=customdeploy_ops_signed_packing_slip_res
```

## Unsigned Packing Slip RESTlet

Script file:

```text
ops_packing_slip_restlet.js
```

### Methods

`POST` is the supported production method. `GET` is included for quick NetSuite-side diagnostics.

### Request

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

### Success Response

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

### Error Response

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

### Logging

The RESTlet logs:

- request received
- Item Fulfillment number when present
- resolved Item Fulfillment internal ID
- Sales Order internal ID
- render success
- render failure

It does not log credentials, OAuth headers, or PDF contents.

## Signed Packing Slip RESTlet

Script file:

```text
ops_signed_packing_slip_restlet.js
```

Script parameter:

```text
custscript_ops_signed_ps_folder_id=555058
```

Current folder:

```text
Signed Delivery Tickets
```

### Method

`POST` only. The Ops Portal backend calls this RESTlet after it validates the admin request, reloads Item Fulfillment metadata, retrieves the unsigned packing slip, and generates the final signed PDF.

The browser must not call this RESTlet directly.

### Request

```json
{
  "item_fulfillment_internal_id": "12345",
  "item_fulfillment_number": "IF123456",
  "sales_order_internal_id": "67890",
  "sales_order_number": "SO987654",
  "file_name": "Signed Packing Slip - IF123456 - 2026-07-14.pdf",
  "content_type": "application/pdf",
  "encoding": "base64",
  "data": "base64-encoded-signed-pdf",
  "printed_name": "John Smith",
  "signed_at": "2026-07-14T21:30:00Z",
  "submitted_by": "Admin User (user 1)",
  "delivery_notes": "Delivered to receiving department."
}
```

Validation rules:

- `item_fulfillment_internal_id`, `item_fulfillment_number`, and `sales_order_internal_id` are required.
- The Item Fulfillment number must match the loaded Item Fulfillment.
- The supplied Sales Order internal ID must match the Item Fulfillment `createdfrom`.
- `content_type` must be `application/pdf`.
- `encoding` must be `base64`.
- `data` must be base64 PDF data beginning with `%PDF` after decoding.
- `custscript_ops_signed_ps_folder_id` must be configured with a numeric File Cabinet folder internal ID.

### Success Response

```json
{
  "success": true,
  "item_fulfillment": {
    "internal_id": "12345",
    "transaction_number": "IF123456"
  },
  "sales_order": {
    "internal_id": "67890",
    "transaction_number": "SO987654"
  },
  "signed_document": {
    "file_id": "55555",
    "file_name": "Signed Packing Slip - IF123456 - 2026-07-14.pdf",
    "attached_to_item_fulfillment": true,
    "attached_to_sales_order": true
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "SIGNED_PACKING_SLIP_ALREADY_EXISTS",
    "message": "A signed packing slip already exists for IF123456."
  },
  "existing_file_id": "55555",
  "file_id": "55555"
}
```

Common signed RESTlet codes:

- `MISSING_ITEM_FULFILLMENT_ID`
- `MISSING_ITEM_FULFILLMENT_NUMBER`
- `MISSING_SALES_ORDER_ID`
- `MISSING_FILE_CABINET_FOLDER`
- `INVALID_FILE_CABINET_FOLDER`
- `ITEM_FULFILLMENT_NOT_FOUND`
- `ITEM_FULFILLMENT_MISMATCH`
- `ITEM_FULFILLMENT_SALES_ORDER_MISMATCH`
- `SALES_ORDER_NOT_FOUND`
- `INVALID_BASE64_PDF`
- `INVALID_PDF_DATA`
- `PDF_TOO_LARGE`
- `SIGNED_PACKING_SLIP_ALREADY_EXISTS`
- `FILE_SAVE_FAILURE`
- `PARTIAL_ATTACHMENT_FAILURE`

### Logging

The signed RESTlet logs:

- request received
- Item Fulfillment number and internal ID
- File Cabinet save success
- attachment failures
- final success or failure

It does not log credentials, OAuth headers, or PDF contents.

## Ops Portal Endpoint

The Ops Portal exposes the admin browser endpoint:

```text
POST /api/admin/item-fulfillments/<IF_NUMBER>/signed-packing-slip
```

Browser JSON:

```json
{
  "signature_data_url": "data:image/png;base64,...",
  "printed_name": "John Smith",
  "delivery_notes": "Delivered to receiving department."
}
```

The Ops Portal derives NetSuite internal IDs from server-side lookup data. The browser must not provide Item Fulfillment or Sales Order internal IDs.
