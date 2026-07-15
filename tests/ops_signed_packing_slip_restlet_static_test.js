const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptPath = path.resolve(__dirname, '../ops_signed_packing_slip_restlet.js');
const source = fs.readFileSync(scriptPath, 'utf8');

let exportedModule = null;

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
    create: () => ({
      save: () => 55555,
    }),
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
    attach: () => undefined,
    submitFields: () => undefined,
  },
  'N/runtime': {
    getCurrentScript: () => ({
      getParameter: () => '123',
    }),
  },
  'N/search': {
    Sort: { DESC: 'DESC' },
    createColumn: (options) => options,
    create: () => ({
      run: () => ({
        each: () => undefined,
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

console.log('ops_signed_packing_slip_restlet_static_test passed');
