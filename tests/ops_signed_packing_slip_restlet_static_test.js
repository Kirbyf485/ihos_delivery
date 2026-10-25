const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptPath = path.resolve(__dirname, '../ops_signed_packing_slip_restlet.js');
const source = fs.readFileSync(scriptPath, 'utf8');

let exportedModule = null;
const calls = {
  attachments: [],
  statusUpdates: [],
  createdFiles: [],
};
let duplicateFile = null;
let lastSearch = null;

const stubs = {
  'N/error': {
    create: ({ name, message }) => {
      const err = new Error(message);
      err.name = name;
      return err;
    },
  },
  'N/file': {
    Type: { PDF: 'PDF' },
    create: (options) => {
      calls.createdFiles.push(options);
      return {
        save: () => 55555,
      };
    },
  },
  'N/log': {
    audit: () => undefined,
    error: () => undefined,
  },
  'N/record': {
    Type: {
      ITEM_FULFILLMENT: 'itemfulfillment',
      SALES_ORDER: 'salesorder',
    },
    load: ({ type }) => ({
      getValue: ({ fieldId }) => {
        if (type === 'itemfulfillment' && fieldId === 'tranid') return 'IF123456';
        if (type === 'itemfulfillment' && fieldId === 'createdfrom') return '67890';
        if (type === 'salesorder' && fieldId === 'tranid') return 'SO987654';
        return '';
      },
    }),
    attach: (options) => calls.attachments.push(options),
    submitFields: (options) => calls.statusUpdates.push(options),
  },
  'N/runtime': {
    getCurrentScript: () => ({
      getParameter: () => '123',
    }),
  },
  'N/search': {
    Sort: { DESC: 'DESC' },
    createColumn: (options) => options,
    create: (options) => (lastSearch = options, {
      run: () => ({
        each: (callback) => {
          if (duplicateFile) {
            callback({
              getValue: ({ name }) => duplicateFile[name],
            });
          }
        },
      }),
    }),
  },
};

const sandbox = {
  define: (deps, factory) => {
    exportedModule = factory(...deps.map((dep) => stubs[dep]));
  },
};

vm.runInNewContext(source, sandbox, { filename: scriptPath });

assert(exportedModule, 'SuiteScript define() did not export a module.');
assert.strictEqual(typeof exportedModule.post, 'function', 'RESTlet must export post().');
assert(source.includes('custscript_ops_signed_ps_folder_id'), 'Destination File Cabinet folder parameter is required.');
assert(source.includes('record.attach'), 'Signed RESTlet must attach the file to records.');
assert(source.includes('file.create'), 'Signed RESTlet must create a File Cabinet file.');
assert(source.includes('createdfrom'), 'Signed RESTlet must validate the Item Fulfillment source Sales Order.');
assert(source.includes('SIGNED_PACKING_SLIP_ALREADY_EXISTS'), 'Signed RESTlet must detect duplicate submissions.');
assert(source.includes('PARTIAL_ATTACHMENT_FAILURE'), 'Signed RESTlet must report partial attachment failure.');
assert(source.includes('custbody_dt_signed_status'), 'Signed RESTlet must update the signed status custom field.');
assert(/record\.submitFields\s*\(/.test(source), 'Signed RESTlet must submit the signed status field update.');
assert(source.includes('SIGNED_STATUS_UPDATE_FAILURE'), 'Signed RESTlet must report signed status update failures.');
assert(!/record\.delete\s*\(/.test(source), 'Signed RESTlet must not delete NetSuite records.');
assert(!/record\.create\s*\(/.test(source), 'Signed RESTlet must not create NetSuite transaction records.');

const baseRequest = {
  item_fulfillment_internal_id: '12345',
  item_fulfillment_number: 'IF123456',
  sales_order_internal_id: '67890',
  sales_order_number: 'SO987654',
  content_type: 'application/pdf',
  encoding: 'base64',
  data: Buffer.from('%PDF-1.4').toString('base64'),
  signed_at: '2026-09-04T20:57:49Z',
  submitted_by: 'Test Driver',
};

const signedResponse = exportedModule.post({
  ...baseRequest,
  file_name: 'Signed Packing Slip - IF123456 - 2026-09-04.pdf',
  printed_name: 'Customer Name',
  document_type: 'signed_packing_slip',
});
assert.strictEqual(signedResponse.success, true);
assert.strictEqual(calls.attachments.length, 2, 'Signed PDFs must attach to the IF and Sales Order.');
assert.strictEqual(calls.statusUpdates.length, 1, 'Signed PDFs must check signed status.');
assert.strictEqual(calls.statusUpdates[0].values.custbody_dt_signed_status, true);
assert.strictEqual(signedResponse.signed_document.signed_status_updated, true);

calls.attachments.length = 0;
calls.statusUpdates.length = 0;
calls.createdFiles.length = 0;
const evidenceResponse = exportedModule.post({
  ...baseRequest,
  file_name: 'NO SIGNATURE - Delivery Evidence - IF123456.pdf',
  printed_name: 'No one on location',
  document_type: 'no_signature_delivery_evidence',
  update_signed_status: true,
  attach_to_item_fulfillment: true,
  attach_to_sales_order: true,
  idempotency_key: 'no-signature-delivery-evidence:12345',
  reject_if_existing: true,
});
assert.strictEqual(evidenceResponse.success, true);
assert.strictEqual(calls.attachments.length, 1, 'No-signature evidence must attach only to the Sales Order.');
assert.strictEqual(calls.attachments[0].to.type, 'salesorder');
assert.strictEqual(calls.statusUpdates.length, 0, 'No-signature evidence must never check signed status.');
assert.strictEqual(evidenceResponse.signed_document.attached_to_item_fulfillment, false);
assert.strictEqual(evidenceResponse.signed_document.attached_to_sales_order, true);
assert.strictEqual(evidenceResponse.signed_document.signed_status_updated, false);
assert(calls.createdFiles[0].description.includes('NO SIGNATURE - delivery evidence'));

duplicateFile = { internalid: '55555', name: 'NO SIGNATURE - Delivery Evidence - IF123456.pdf' };
const duplicateEvidenceResponse = exportedModule.post({
  ...baseRequest,
  file_name: 'NO SIGNATURE - Delivery Evidence - IF123456.pdf',
  document_type: 'no_signature_delivery_evidence',
});
assert.strictEqual(duplicateEvidenceResponse.success, false);
assert.strictEqual(
  duplicateEvidenceResponse.error.code,
  'NO_SIGNATURE_DELIVERY_EVIDENCE_ALREADY_EXISTS'
);
assert.strictEqual(duplicateEvidenceResponse.existing_file_id, '55555');

console.log('ops_signed_packing_slip_restlet_static_test passed');


duplicateFile = null;
const secondAttempt = exportedModule.post({...baseRequest,
  file_name: 'evidence.pdf', document_type: 'no_signature_delivery_evidence', delivery_attempt: 2});
assert.strictEqual(secondAttempt.success, true);
assert.strictEqual(secondAttempt.delivery_attempt, 2);
assert(lastSearch.filters[2][2].endsWith('IF123456 - Attempt 2 -'));
assert(calls.createdFiles.at(-1).name.includes('IF123456 - Attempt 2 -'));
duplicateFile = {internalid: '55555', name: calls.createdFiles.at(-1).name};
const repeatedAttempt = exportedModule.post({...baseRequest,
  file_name: 'evidence.pdf', document_type: 'no_signature_delivery_evidence', delivery_attempt: 2});
assert.strictEqual(repeatedAttempt.success, false);
assert.strictEqual(repeatedAttempt.error.code, 'NO_SIGNATURE_DELIVERY_EVIDENCE_ALREADY_EXISTS');
assert.strictEqual(repeatedAttempt.delivery_attempt || repeatedAttempt.error.delivery_attempt, 2);
const invalidAttempt = exportedModule.post({...baseRequest, file_name: 'evidence.pdf', delivery_attempt: -1});
assert.strictEqual(invalidAttempt.success, false);
