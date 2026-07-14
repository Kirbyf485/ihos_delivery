# Troubleshooting

## `ITEM_FULFILLMENT_NOT_FOUND`

Check that:

- The transaction number entered in Ops Portal is the Item Fulfillment `tranid`.
- The integration role can view Item Fulfillment transactions.
- The RESTlet is deployed to the same NetSuite account/environment that contains the fulfillment.

Try testing with the Item Fulfillment internal ID to separate number matching from record access.

## `MULTIPLE_ITEM_FULFILLMENTS`

The RESTlet found more than one Item Fulfillment with the same transaction number. This should be unexpected. Confirm transaction numbering and subsidiaries/environments.

## `MISSING_SALES_ORDER`

The Item Fulfillment does not have a source Sales Order in `createdfrom`. This phase expects fulfillments created from Sales Orders.

## `SOURCE_TRANSACTION_NOT_SALES_ORDER`

The source transaction exists but cannot be loaded as a Sales Order by the integration role. Confirm the fulfillment source and role permissions.

## `MISSING_FILE_CABINET_FOLDER`

The signed packing slip RESTlet is missing the required File Cabinet folder parameter.

Check the script or deployment parameter:

```text
custscript_ops_signed_ps_folder_id
```

The value must be the internal ID of the destination File Cabinet folder.

## `SIGNED_PACKING_SLIP_ALREADY_EXISTS`

The signed RESTlet found an existing file in the destination folder whose name starts with:

```text
Signed Packing Slip - <IF_NUMBER>
```

This prevents accidental duplicate signed deliveries. Confirm whether the existing file is the correct signed delivery document before retrying.

## `PARTIAL_ATTACHMENT_FAILURE`

The signed PDF was saved in the File Cabinet, but one or both record attachments failed.

The RESTlet response includes:

- `file_id`
- `attached_to_item_fulfillment`
- `attached_to_sales_order`

Use the returned file ID to verify the File Cabinet file, then check the integration role's access to the Item Fulfillment and Sales Order records.

## Empty or Invalid PDF

Check that:

- The transaction can be printed manually in NetSuite by the same role or a role with equivalent permissions.
- The configured custom form ID is valid for Item Fulfillments.
- The configured Advanced PDF/HTML template ID is valid and renders with `record` as the Item Fulfillment.
- If using a custom template, the template can handle the `salesorder` record alias if it references it.

## Signed PDF Upload Fails

Check that:

- The Ops Portal is calling the signed RESTlet URL or signed script/deployment IDs.
- The signed RESTlet deployment audience includes the integration role.
- The File Cabinet folder exists and the folder ID parameter is numeric.
- The integration role can create files in that folder.
- The integration role can attach files to Item Fulfillment and Sales Order records.
- The submitted PDF starts with `%PDF` after base64 decoding.

## Authentication Failures from Ops Portal

Check the Ops Portal environment variables:

- `NETSUITE_TBA_ACCOUNT`
- `NETSUITE_TBA_CONSUMER_KEY`
- `NETSUITE_TBA_CONSUMER_SECRET`
- `NETSUITE_TBA_TOKEN_ID`
- `NETSUITE_TBA_TOKEN_SECRET`
- `NETSUITE_TBA_SIGNATURE_METHOD`
- `NETSUITE_PACKING_SLIP_RESTLET_URL` or script/deployment IDs
- `NETSUITE_SIGNED_PACKING_SLIP_RESTLET_URL` or signed script/deployment IDs

Confirm the token is assigned to a role included in the RESTlet deployment audience.

## Permissions Checklist

The integration role should be able to:

- Log in using Token-Based Authentication.
- Execute the RESTlet deployment.
- View Item Fulfillments.
- View Sales Orders.
- View Customers.
- Print/render transactions.
- Create File Cabinet files in the signed packing slip destination folder.
- Attach files to Item Fulfillments and Sales Orders.
- Use Lists -> Documents and Files.

The unsigned RESTlet does not need File Cabinet write permissions. The signed RESTlet does need File Cabinet create access and attachment access.
