const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptPath = path.resolve(__dirname, '../ops_packing_slip_restlet.js');
const source = fs.readFileSync(scriptPath, 'utf8');

let exportedModule = null;

const stubs = {
  'N/encode': {
    Encoding: { UTF_8: 'UTF_8', BASE_64: 'BASE_64' },
    convert: ({ string }) => Buffer.from(String(string), 'utf8').toString('base64'),
  },
  'N/error': {
    create: ({ name, message }) => {
      const err = new Error(message);
      err.name = name;
      return err;
    },
  },
  'N/log': {
    audit: () => undefined,
    error: () => undefined,
  },
  'N/record': {
    Type: {
      ITEM_FULFILLMENT: 'itemfulfillment',
      PURCHASE_ORDER: 'purchaseorder',
      SALES_ORDER: 'salesorder',
    },
  },
  'N/render': {
    PrintMode: { PDF: 'PDF' },
    create: () => ({
      setTemplateById: () => undefined,
      addRecord: () => undefined,
      renderAsPdf: () => ({ getContents: () => '%PDF-1.4\n%%EOF' }),
    }),
    transaction: () => ({ getContents: () => '%PDF-1.4\n%%EOF' }),
  },
  'N/runtime': {
    getCurrentScript: () => ({
      getParameter: () => '',
    }),
  },
  'N/search': {
    Type: {
      ITEM_FULFILLMENT: 'itemfulfillment',
      PURCHASE_ORDER: 'purchaseorder',
    },
    Sort: { ASC: 'ASC' },
    createColumn: (options) => options,
  },
};

const sandbox = {
  define: (deps, factory) => {
    exportedModule = factory(...deps.map((dep) => stubs[dep]));
  },
};

vm.runInNewContext(source, sandbox, { filename: scriptPath });

assert(exportedModule, 'SuiteScript define() did not export a module.');
assert.strictEqual(typeof exportedModule.get, 'function', 'RESTlet must export get().');
assert.strictEqual(typeof exportedModule.post, 'function', 'RESTlet must export post().');
assert(!/record\.submitFields\s*\(/.test(source), 'RESTlet must not update records with record.submitFields().');
assert(!/\.save\s*\(/.test(source), 'RESTlet must not save NetSuite records.');
assert(!/record\.delete\s*\(/.test(source), 'RESTlet must not delete NetSuite records.');
assert(!/file\.create\s*\(/.test(source), 'Phase 1 must not create File Cabinet files.');

console.log('ops_packing_slip_restlet_static_test passed');
