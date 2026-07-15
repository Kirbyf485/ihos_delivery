# Deployment

## 1. Upload the RESTlets

Upload these files to NetSuite:

```text
ops_packing_slip_restlet.js
ops_signed_packing_slip_restlet.js
```

Recommended File Cabinet folder:

```text
SuiteScripts/IHOS Delivery/
```

## 2. Create the unsigned packing slip script record

Create a RESTlet script record from the uploaded file.

Recommended IDs:

```text
Name:          Ops Packing Slip RESTlet
Script ID:     customscript_ops_packing_slip_restlet
API Version:   2.1
Script Type:   RESTlet
```

## 3. Add unsigned packing slip script parameters

Create these optional parameters on the script record:

| Label | ID | Type | Required | Purpose |
| --- | --- | --- | --- | --- |
| Packing Slip Advanced PDF Template ID | `custscript_ops_ps_template_id` | Integer | No | Use a specific Advanced PDF/HTML template. Leave blank to use the transaction form's existing print behavior. |
| Packing Slip Custom Form ID | `custscript_ops_ps_custom_form_id` | Integer | No | Use a specific transaction form when calling `render.transaction`. Leave blank to use NetSuite defaults. |

Do not hardcode template IDs or form IDs in the script. Put them in script/deployment parameters only when needed.

## 4. Create the unsigned packing slip deployment

Recommended deployment:

```text
Deployment ID: customdeploy_ops_packing_slip_restlet
Status:        Released
Audience:      Integration role only
Log Level:     Audit or Debug during testing, Audit in production
```

## 5. Create the signed packing slip script record

Create a second RESTlet script record from `ops_signed_packing_slip_restlet.js`.

Recommended IDs:

```text
Name:          Ops Signed Packing Slip RESTlet
Script ID:     customscript_ops_signed_packing_slip_res
API Version:   2.1
Script Type:   RESTlet
```

## 6. Add signed packing slip script parameters

Create this required parameter on the signed script record:

| Label | ID | Type | Required | Purpose |
| --- | --- | --- | --- | --- |
| Signed Packing Slip Folder ID | `custscript_ops_signed_ps_folder_id` | Integer | Yes | File Cabinet folder internal ID where signed PDFs are saved. |

Use this folder for the current IHOS deployment:

```text
Folder:      Signed Delivery Tickets
Internal ID: 555058
Parameter:   custscript_ops_signed_ps_folder_id=555058
```

## 7. Create the signed packing slip deployment

Recommended deployment:

```text
Deployment ID: customdeploy_ops_signed_packing_slip_res
Status:        Released
Audience:      Integration role only
Log Level:     Audit or Debug during testing, Audit in production
```

## 8. Authentication

Use Token-Based Authentication for the Ops Portal integration user.

Do not use NLAuth. Do not hardcode credentials in this repository, in SuiteScript, or in frontend code.

## 9. Required NetSuite permissions

Create or reuse an integration role with the least permissions needed to:

- Execute RESTlets.
- View Item Fulfillments.
- View Sales Orders.
- View Customers referenced by fulfillments.
- Print/render transactions and Advanced PDF/HTML templates.
- Access the RESTlet script deployment.
- Create File Cabinet files in the signed packing slip destination folder.
- Attach files to Item Fulfillment and Sales Order records.
- Edit the Item Fulfillment custom body field `custbody_dt_signed_status`.
- Lists -> Documents and Files permission for File Cabinet access.

The unsigned RESTlet does not modify NetSuite records. The signed RESTlet creates one File Cabinet PDF, attaches that same file to the Item Fulfillment and Sales Order, and updates only `custbody_dt_signed_status` on the Item Fulfillment after both attachments succeed.

## 10. Ops Portal environment variables

Configure the Ops Portal with the deployed RESTlet values.

Unsigned packing slip RESTlet, direct URL:

```text
NETSUITE_PACKING_SLIP_RESTLET_URL=https://<ACCOUNT>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_ops_packing_slip_restlet&deploy=customdeploy_ops_packing_slip_restlet
```

Or configure unsigned script/deployment IDs and let the Ops Portal build the URL:

```text
NETSUITE_PACKING_SLIP_RESTLET_SCRIPT_ID=customscript_ops_packing_slip_restlet
NETSUITE_PACKING_SLIP_RESTLET_DEPLOYMENT_ID=customdeploy_ops_packing_slip_restlet
```

Signed packing slip RESTlet, direct URL:

```text
NETSUITE_SIGNED_PACKING_SLIP_RESTLET_URL=https://<ACCOUNT>.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=customscript_ops_signed_packing_slip_res&deploy=customdeploy_ops_signed_packing_slip_res
```

Or configure signed script/deployment IDs and let the Ops Portal build the URL:

```text
NETSUITE_SIGNED_PACKING_SLIP_RESTLET_SCRIPT_ID=customscript_ops_signed_packing_slip_res
NETSUITE_SIGNED_PACKING_SLIP_RESTLET_DEPLOYMENT_ID=customdeploy_ops_signed_packing_slip_res
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

If using dedicated packing-slip credentials in the Ops Portal, set these instead. The signed and unsigned packing slip RESTlets use the same packing-slip TBA credential set.

```text
NETSUITE_PACKING_SLIP_TBA_ACCOUNT=
NETSUITE_PACKING_SLIP_TBA_CONSUMER_KEY=
NETSUITE_PACKING_SLIP_TBA_CONSUMER_SECRET=
NETSUITE_PACKING_SLIP_TBA_TOKEN_ID=
NETSUITE_PACKING_SLIP_TBA_TOKEN_SECRET=
NETSUITE_PACKING_SLIP_TBA_SIGNATURE_METHOD=HMAC-SHA256
```

Optional signed PDF limits:

```text
PACKING_SLIP_SIGNATURE_MAX_BYTES=1048576
PACKING_SLIP_SIGNED_PDF_MAX_BYTES=26214400
PACKING_SLIP_DELIVERY_NOTES_MAX_CHARS=2000
PACKING_SLIP_SIGNATURE_TIMEZONE=America/Chicago
```

## 11. Smoke test

Use a real Item Fulfillment that has an originating Sales Order.

Unsigned RESTlet request:

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

Signed workflow test through Ops Portal:

1. Open `/admin/packing-slips` as an admin.
2. Enter a real Item Fulfillment number.
3. Confirm the unsigned PDF preview renders.
4. Draw a signature, enter a printed name, and optionally attach a delivery photo.
5. Submit the signed packing slip.
6. Confirm the Ops Portal success message includes the NetSuite file ID.
7. In NetSuite, verify the signed PDF exists in the configured File Cabinet folder.
8. Verify the same file is attached to the Item Fulfillment and originating Sales Order.
9. Verify `custbody_dt_signed_status` is true on the Item Fulfillment.
