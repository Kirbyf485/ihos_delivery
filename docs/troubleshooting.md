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

## Empty or Invalid PDF

Check that:

- The transaction can be printed manually in NetSuite by the same role or a role with equivalent permissions.
- The configured custom form ID is valid for Item Fulfillments.
- The configured Advanced PDF/HTML template ID is valid and renders with `record` as the Item Fulfillment.
- If using a custom template, the template can handle the `salesorder` record alias if it references it.

## Authentication Failures from Ops Portal

Check the Ops Portal environment variables:

- `NETSUITE_TBA_ACCOUNT`
- `NETSUITE_TBA_CONSUMER_KEY`
- `NETSUITE_TBA_CONSUMER_SECRET`
- `NETSUITE_TBA_TOKEN_ID`
- `NETSUITE_TBA_TOKEN_SECRET`
- `NETSUITE_TBA_SIGNATURE_METHOD`
- `NETSUITE_PACKING_SLIP_RESTLET_URL` or script/deployment IDs

Confirm the token is assigned to a role included in the RESTlet deployment audience.

## Permissions Checklist

The integration role should be able to:

- Log in using Token-Based Authentication.
- Execute the RESTlet deployment.
- View Item Fulfillments.
- View Sales Orders.
- View Customers.
- Print/render transactions.

The role should not need edit permissions for Phase 1.
