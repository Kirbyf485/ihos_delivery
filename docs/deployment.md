# Deployment

## 1. Upload the RESTlet

Upload this file to NetSuite:

```text
ops_packing_slip_restlet.js
```

Recommended File Cabinet folder:

```text
SuiteScripts/IHOS Delivery/
```

## 2. Create the script record

Create a RESTlet script record from the uploaded file.

Recommended IDs:

```text
Name:          Ops Packing Slip RESTlet
Script ID:     customscript_ops_packing_slip_restlet
API Version:   2.1
Script Type:   RESTlet
```

## 3. Add script parameters

Create these optional parameters on the script record:

| Label | ID | Type | Required | Purpose |
| --- | --- | --- | --- | --- |
| Packing Slip Advanced PDF Template ID | `custscript_ops_ps_template_id` | Integer | No | Use a specific Advanced PDF/HTML template. Leave blank to use the transaction form's existing print behavior. |
| Packing Slip Custom Form ID | `custscript_ops_ps_custom_form_id` | Integer | No | Use a specific transaction form when calling `render.transaction`. Leave blank to use NetSuite defaults. |

Do not hardcode template IDs or form IDs in the script. Put them in script/deployment parameters only when needed.

## 4. Create the deployment

Recommended deployment:

```text
Deployment ID: customdeploy_ops_packing_slip_restlet
Status:        Released
Audience:      Integration role only
Log Level:     Audit or Debug during testing, Audit in production
```

## 5. Authentication

Use Token-Based Authentication for the Ops Portal integration user.

Do not use NLAuth. Do not hardcode credentials in this repository, in SuiteScript, or in frontend code.

## 6. Required NetSuite permissions

Create or reuse an integration role with the least permissions needed to:

- Execute RESTlets.
- View Item Fulfillments.
- View Sales Orders.
- View Customers referenced by fulfillments.
- Print/render transactions and Advanced PDF/HTML templates.
- Access the RESTlet script deployment.

No create, edit, delete, approve, fulfill, bill, attach, or File Cabinet write permissions are required for Phase 1.

## 7. Ops Portal environment variables

Configure the Ops Portal with the deployed RESTlet values.

If using the URL directly:

```text
NETSUITE_PACKING_SLIP_RESTLET_URL=https://<ACCOUNT>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_ops_packing_slip_restlet&deploy=customdeploy_ops_packing_slip_restlet
```

Or configure script/deployment IDs and let the Ops Portal build the URL:

```text
NETSUITE_PACKING_SLIP_RESTLET_SCRIPT_ID=customscript_ops_packing_slip_restlet
NETSUITE_PACKING_SLIP_RESTLET_DEPLOYMENT_ID=customdeploy_ops_packing_slip_restlet
```

Token-Based Auth values:

```text
NETSUITE_TBA_ACCOUNT=
NETSUITE_TBA_CONSUMER_KEY=
NETSUITE_TBA_CONSUMER_SECRET=
NETSUITE_TBA_TOKEN_ID=
NETSUITE_TBA_TOKEN_SECRET=
NETSUITE_TBA_SIGNATURE_METHOD=HMAC-SHA256
```

If using dedicated packing-slip credentials in the Ops Portal, set:

```text
NETSUITE_PACKING_SLIP_TBA_ACCOUNT=
NETSUITE_PACKING_SLIP_TBA_CONSUMER_KEY=
NETSUITE_PACKING_SLIP_TBA_CONSUMER_SECRET=
NETSUITE_PACKING_SLIP_TBA_TOKEN_ID=
NETSUITE_PACKING_SLIP_TBA_TOKEN_SECRET=
NETSUITE_PACKING_SLIP_TBA_SIGNATURE_METHOD=HMAC-SHA256
```

## 8. Smoke test

Use a real Item Fulfillment that has an originating Sales Order.

Request:

```json
{
  "item_fulfillment_number": "IF123456"
}
```

Expected result:

- `ok` is `true`.
- `item_fulfillment.internal_id` matches the NetSuite Item Fulfillment.
- `item_fulfillment.sales_order_internal_id` is populated.
- `pdf.content_type` is `application/pdf`.
- Base64-decoding `pdf.data` produces a PDF beginning with `%PDF`.
