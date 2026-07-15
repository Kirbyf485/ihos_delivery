/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define([
    'N/encode',
    'N/error',
    'N/log',
    'N/record',
    'N/render',
    'N/runtime',
    'N/search'
], function (
    encode,
    error,
    log,
    record,
    render,
    runtime,
    search
) {
    'use strict';

    var PARAM_TEMPLATE_ID = 'custscript_ops_ps_template_id';
    var PARAM_CUSTOM_FORM_ID = 'custscript_ops_ps_custom_form_id';
    var DOCUMENT_TYPE_ITEM_FULFILLMENT = 'item_fulfillment';
    var DOCUMENT_TYPE_PURCHASE_ORDER = 'purchase_order';

    function get(requestParams) {
        return handleRequest(requestParams || {});
    }

    function post(requestBody) {
        return handleRequest(parseRequestBody(requestBody));
    }

    function handleRequest(payload) {
        var request = normalizeRequest(payload);

        log.audit({
            title: 'OPS_PACKING_SLIP_REQUEST',
            details: {
                documentType: request.documentType,
                itemFulfillmentNumber: request.itemFulfillmentNumber || '',
                hasInternalId: !!request.itemFulfillmentInternalId,
                purchaseOrderNumber: request.purchaseOrderNumber || '',
                hasPurchaseOrderInternalId: !!request.purchaseOrderInternalId
            }
        });

        try {
            if (request.documentType === DOCUMENT_TYPE_PURCHASE_ORDER) {
                return handlePurchaseOrderRequest(request);
            }

            var resolution = resolveItemFulfillment(request);
            var fulfillmentRecord = resolution.fulfillmentRecord;
            var metadata = buildMetadata(fulfillmentRecord, resolution.itemFulfillmentInternalId);
            var salesOrder = resolveSalesOrder(metadata.sales_order_internal_id);
            metadata.sales_order_number = salesOrder.salesOrderNumber || metadata.sales_order_number || '';

            log.audit({
                title: 'OPS_PACKING_SLIP_RESOLVED',
                details: {
                    itemFulfillmentNumber: metadata.transaction_number,
                    itemFulfillmentInternalId: metadata.internal_id,
                    salesOrderInternalId: metadata.sales_order_internal_id
                }
            });

            var pdfFile = renderPackingSlip(fulfillmentRecord, salesOrder.salesOrderRecord, metadata.internal_id);
            var pdfBase64 = toBase64PdfContents(pdfFile);
            var fileName = 'Packing Slip - ' + sanitizeFileNamePart(metadata.transaction_number || metadata.internal_id) + '.pdf';

            log.audit({
                title: 'OPS_PACKING_SLIP_RENDER_SUCCESS',
                details: {
                    itemFulfillmentNumber: metadata.transaction_number,
                    itemFulfillmentInternalId: metadata.internal_id,
                    salesOrderInternalId: metadata.sales_order_internal_id
                }
            });

            return {
                ok: true,
                item_fulfillment: metadata,
                pdf: {
                    content_type: 'application/pdf',
                    file_name: fileName,
                    data: pdfBase64
                }
            };
        } catch (exception) {
            log.error({
                title: 'OPS_PACKING_SLIP_RENDER_FAILURE',
                details: safeErrorDetails(exception, request)
            });
            return errorResponse(exception);
        }
    }

    function handlePurchaseOrderRequest(request) {
        var resolution = resolvePurchaseOrder(request);
        var purchaseOrderRecord = resolution.purchaseOrderRecord;
        var metadata = buildPurchaseOrderMetadata(purchaseOrderRecord, resolution.purchaseOrderInternalId);

        log.audit({
            title: 'OPS_PURCHASE_ORDER_RESOLVED',
            details: {
                purchaseOrderNumber: metadata.transaction_number,
                purchaseOrderInternalId: metadata.internal_id
            }
        });

        var pdfFile = renderPurchaseOrder(metadata.internal_id);
        var pdfBase64 = toBase64PdfContents(pdfFile);
        var fileName = 'Purchase Order - ' + sanitizeFileNamePart(metadata.transaction_number || metadata.internal_id) + '.pdf';

        log.audit({
            title: 'OPS_PURCHASE_ORDER_RENDER_SUCCESS',
            details: {
                purchaseOrderNumber: metadata.transaction_number,
                purchaseOrderInternalId: metadata.internal_id
            }
        });

        return {
            ok: true,
            purchase_order: metadata,
            pdf: {
                content_type: 'application/pdf',
                file_name: fileName,
                data: pdfBase64
            }
        };
    }

    function parseRequestBody(requestBody) {
        if (!requestBody) {
            return {};
        }
        if (typeof requestBody === 'string') {
            try {
                return JSON.parse(requestBody);
            } catch (exception) {
                throw makeIntegrationError('INVALID_JSON', 'Request body must be valid JSON.', exception);
            }
        }
        return requestBody;
    }

    function normalizeRequest(payload) {
        var body = payload || {};
        var requestedDocumentType = cleanText(firstPresent(body, [
            'transaction_type',
            'transactionType',
            'document_type',
            'documentType'
        ])).toLowerCase();
        var purchaseOrderInternalId = cleanText(firstPresent(body, [
            'purchase_order_internal_id',
            'purchaseOrderInternalId',
            'po_internal_id',
            'poInternalId'
        ]));
        var purchaseOrderNumber = normalizePurchaseOrderNumber(firstPresent(body, [
            'purchase_order_number',
            'purchaseOrderNumber',
            'po_number',
            'poNumber'
        ]));
        var isPurchaseOrderRequest = requestedDocumentType === DOCUMENT_TYPE_PURCHASE_ORDER ||
            requestedDocumentType === 'purchaseorder' ||
            requestedDocumentType === 'po' ||
            !!purchaseOrderInternalId ||
            !!purchaseOrderNumber;
        var itemFulfillmentInternalId = isPurchaseOrderRequest ? '' : cleanText(firstPresent(body, [
            'item_fulfillment_internal_id',
            'itemFulfillmentInternalId',
            'internal_id',
            'internalId',
            'id'
        ]));
        var itemFulfillmentNumber = isPurchaseOrderRequest ? '' : normalizeItemFulfillmentNumber(firstPresent(body, [
            'item_fulfillment_number',
            'itemFulfillmentNumber',
            'if_number',
            'ifNumber',
            'tranid',
            'transaction_number',
            'transactionNumber'
        ]));

        if (isPurchaseOrderRequest) {
            if (!purchaseOrderInternalId && !purchaseOrderNumber) {
                throw makeIntegrationError(
                    'MISSING_PURCHASE_ORDER',
                    'Provide purchase_order_number or purchase_order_internal_id.'
                );
            }
            return {
                documentType: DOCUMENT_TYPE_PURCHASE_ORDER,
                purchaseOrderInternalId: purchaseOrderInternalId,
                purchaseOrderNumber: purchaseOrderNumber
            };
        }

        if (!itemFulfillmentInternalId && !itemFulfillmentNumber) {
            throw makeIntegrationError(
                'MISSING_ITEM_FULFILLMENT',
                'Provide item_fulfillment_number or item_fulfillment_internal_id.'
            );
        }

        return {
            documentType: DOCUMENT_TYPE_ITEM_FULFILLMENT,
            itemFulfillmentInternalId: itemFulfillmentInternalId,
            itemFulfillmentNumber: itemFulfillmentNumber
        };
    }

    function normalizeItemFulfillmentNumber(value) {
        var text = cleanText(value).toUpperCase().replace(/\s+/g, '');
        if (!text) {
            return '';
        }
        if (!/^IF[0-9A-Z][0-9A-Z-]{0,38}$/.test(text)) {
            throw makeIntegrationError(
                'INVALID_ITEM_FULFILLMENT_NUMBER',
                'Item Fulfillment number must look like IF123456.'
            );
        }
        return text;
    }

    function normalizePurchaseOrderNumber(value) {
        var text = cleanText(value).toUpperCase().replace(/\s+/g, '');
        if (!text) {
            return '';
        }
        if (!/^PO[0-9A-Z][0-9A-Z._-]{0,38}$/.test(text)) {
            throw makeIntegrationError(
                'INVALID_PURCHASE_ORDER_NUMBER',
                'Purchase Order number must look like PO123456.'
            );
        }
        return text;
    }

    function resolveItemFulfillment(request) {
        if (request.itemFulfillmentInternalId) {
            return resolveItemFulfillmentByInternalId(
                request.itemFulfillmentInternalId,
                request.itemFulfillmentNumber
            );
        }
        return resolveItemFulfillmentByNumber(request.itemFulfillmentNumber);
    }

    function resolveItemFulfillmentByInternalId(internalId, expectedNumber) {
        var fulfillmentRecord = loadItemFulfillmentRecord(internalId);
        var actualNumber = normalizeItemFulfillmentNumber(
            safeGetValue(fulfillmentRecord, 'tranid') ||
            ''
        );

        if (expectedNumber && actualNumber && actualNumber !== expectedNumber) {
            throw makeIntegrationError(
                'ITEM_FULFILLMENT_MISMATCH',
                'The provided Item Fulfillment number does not match the provided internal ID.'
            );
        }

        return {
            itemFulfillmentInternalId: String(internalId),
            fulfillmentRecord: fulfillmentRecord
        };
    }

    function resolveItemFulfillmentByNumber(itemFulfillmentNumber) {
        var results = [];
        search.create({
            type: search.Type.ITEM_FULFILLMENT,
            filters: [
                ['mainline', 'is', 'T'],
                'AND',
                ['tranid', 'is', itemFulfillmentNumber]
            ],
            columns: [
                search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
                'tranid'
            ]
        }).run().each(function (result) {
            results.push({
                internalId: result.getValue({ name: 'internalid' }),
                tranId: result.getValue({ name: 'tranid' })
            });
            return results.length < 3;
        });

        if (results.length === 0) {
            throw makeIntegrationError(
                'ITEM_FULFILLMENT_NOT_FOUND',
                'No Item Fulfillment was found for ' + itemFulfillmentNumber + '.'
            );
        }
        if (results.length > 1) {
            throw makeIntegrationError(
                'MULTIPLE_ITEM_FULFILLMENTS',
                'More than one Item Fulfillment matched ' + itemFulfillmentNumber + '.'
            );
        }

        return resolveItemFulfillmentByInternalId(results[0].internalId, itemFulfillmentNumber);
    }

    function loadItemFulfillmentRecord(internalId) {
        try {
            return record.load({
                type: record.Type.ITEM_FULFILLMENT,
                id: internalId,
                isDynamic: false
            });
        } catch (exception) {
            throw makeIntegrationError(
                'ITEM_FULFILLMENT_NOT_FOUND',
                'Item Fulfillment internal ID ' + internalId + ' was not found or is not accessible.',
                exception
            );
        }
    }

    function resolvePurchaseOrder(request) {
        if (request.purchaseOrderInternalId) {
            return resolvePurchaseOrderByInternalId(
                request.purchaseOrderInternalId,
                request.purchaseOrderNumber
            );
        }
        return resolvePurchaseOrderByNumber(request.purchaseOrderNumber);
    }

    function resolvePurchaseOrderByInternalId(internalId, expectedNumber) {
        var purchaseOrderRecord = loadPurchaseOrderRecord(internalId);
        var actualNumber = normalizePurchaseOrderNumber(
            safeGetValue(purchaseOrderRecord, 'tranid') ||
            ''
        );

        if (expectedNumber && actualNumber && actualNumber !== expectedNumber) {
            throw makeIntegrationError(
                'PURCHASE_ORDER_MISMATCH',
                'The provided Purchase Order number does not match the provided internal ID.'
            );
        }

        return {
            purchaseOrderInternalId: String(internalId),
            purchaseOrderRecord: purchaseOrderRecord
        };
    }

    function resolvePurchaseOrderByNumber(purchaseOrderNumber) {
        var results = [];
        search.create({
            type: search.Type.PURCHASE_ORDER,
            filters: [
                ['mainline', 'is', 'T'],
                'AND',
                ['tranid', 'is', purchaseOrderNumber]
            ],
            columns: [
                search.createColumn({ name: 'internalid', sort: search.Sort.ASC }),
                'tranid'
            ]
        }).run().each(function (result) {
            results.push({
                internalId: result.getValue({ name: 'internalid' }),
                tranId: result.getValue({ name: 'tranid' })
            });
            return results.length < 3;
        });

        if (results.length === 0) {
            throw makeIntegrationError(
                'PURCHASE_ORDER_NOT_FOUND',
                'No Purchase Order was found for ' + purchaseOrderNumber + '.'
            );
        }
        if (results.length > 1) {
            throw makeIntegrationError(
                'MULTIPLE_PURCHASE_ORDERS',
                'More than one Purchase Order matched ' + purchaseOrderNumber + '.'
            );
        }

        return resolvePurchaseOrderByInternalId(results[0].internalId, purchaseOrderNumber);
    }

    function loadPurchaseOrderRecord(internalId) {
        try {
            return record.load({
                type: record.Type.PURCHASE_ORDER,
                id: internalId,
                isDynamic: false
            });
        } catch (exception) {
            throw makeIntegrationError(
                'PURCHASE_ORDER_NOT_FOUND',
                'Purchase Order internal ID ' + internalId + ' was not found or is not accessible.',
                exception
            );
        }
    }

    function buildMetadata(fulfillmentRecord, internalId) {
        var createdFromId = cleanText(safeGetValue(fulfillmentRecord, 'createdfrom'));
        if (!createdFromId) {
            throw makeIntegrationError(
                'MISSING_SALES_ORDER',
                'The Item Fulfillment is missing an originating Sales Order.'
            );
        }

        return {
            internal_id: cleanText(internalId),
            transaction_number: cleanText(
                safeGetValue(fulfillmentRecord, 'tranid')
            ),
            sales_order_internal_id: createdFromId,
            sales_order_number: cleanText(safeGetText(fulfillmentRecord, 'createdfrom')),
            customer_name: cleanText(safeGetText(fulfillmentRecord, 'entity')),
            fulfillment_date: dateToIso(safeGetValue(fulfillmentRecord, 'trandate')),
            shipping_address: cleanText(safeGetValue(fulfillmentRecord, 'shipaddress')),
            status: cleanText(safeGetText(fulfillmentRecord, 'status'))
        };
    }

    function buildPurchaseOrderMetadata(purchaseOrderRecord, internalId) {
        return {
            internal_id: cleanText(internalId),
            transaction_number: cleanText(
                safeGetValue(purchaseOrderRecord, 'tranid')
            ),
            vendor_name: cleanText(safeGetText(purchaseOrderRecord, 'entity')),
            purchase_order_date: dateToIso(safeGetValue(purchaseOrderRecord, 'trandate')),
            status: cleanText(safeGetText(purchaseOrderRecord, 'status'))
        };
    }

    function resolveSalesOrder(salesOrderInternalId) {
        try {
            var salesOrderRecord = record.load({
                type: record.Type.SALES_ORDER,
                id: salesOrderInternalId,
                isDynamic: false
            });
            return {
                salesOrderRecord: salesOrderRecord,
                salesOrderNumber: cleanText(
                    safeGetValue(salesOrderRecord, 'tranid')
                )
            };
        } catch (exception) {
            throw makeIntegrationError(
                'SOURCE_TRANSACTION_NOT_SALES_ORDER',
                'The Item Fulfillment source transaction is not an accessible Sales Order.',
                exception
            );
        }
    }

    function renderPackingSlip(fulfillmentRecord, salesOrderRecord, itemFulfillmentInternalId) {
        var templateId = cleanText(runtime.getCurrentScript().getParameter({ name: PARAM_TEMPLATE_ID }));
        var customFormId = cleanText(runtime.getCurrentScript().getParameter({ name: PARAM_CUSTOM_FORM_ID }));

        if (templateId) {
            return renderPackingSlipWithTemplate(templateId, fulfillmentRecord, salesOrderRecord);
        }

        var options = {
            entityId: Number(itemFulfillmentInternalId),
            printMode: render.PrintMode.PDF
        };
        if (customFormId) {
            options.formId = Number(customFormId);
        }
        return render.transaction(options);
    }

    function renderPackingSlipWithTemplate(templateId, fulfillmentRecord, salesOrderRecord) {
        var renderer = render.create();
        renderer.setTemplateById({ id: Number(templateId) });
        renderer.addRecord({
            templateName: 'record',
            record: fulfillmentRecord
        });
        renderer.addRecord({
            templateName: 'salesorder',
            record: salesOrderRecord
        });
        return renderer.renderAsPdf();
    }

    function renderPurchaseOrder(purchaseOrderInternalId) {
        return render.transaction({
            entityId: Number(purchaseOrderInternalId),
            printMode: render.PrintMode.PDF
        });
    }

    function toBase64PdfContents(pdfFile) {
        var contents = pdfFile.getContents();
        if (!contents) {
            throw makeIntegrationError('EMPTY_PDF', 'NetSuite rendered an empty packing slip PDF.');
        }

        if (String(contents).indexOf('%PDF') === 0) {
            return encode.convert({
                string: contents,
                inputEncoding: encode.Encoding.UTF_8,
                outputEncoding: encode.Encoding.BASE_64
            });
        }

        return String(contents);
    }

    function errorResponse(exception) {
        return {
            ok: false,
            code: exception.name || 'PACKING_SLIP_ERROR',
            message: safeClientMessage(exception)
        };
    }

    function makeIntegrationError(name, message, cause) {
        var integrationError = error.create({
            name: name,
            message: message,
            notifyOff: true
        });
        if (cause) {
            integrationError.causeName = cause.name || '';
            integrationError.causeMessage = cause.message || String(cause);
        }
        return integrationError;
    }

    function safeErrorDetails(exception, request) {
        return {
            code: exception.name || 'PACKING_SLIP_ERROR',
            message: exception.message || String(exception),
            causeName: exception.causeName || '',
            causeMessage: exception.causeMessage || '',
            documentType: request.documentType || '',
            itemFulfillmentNumber: request.itemFulfillmentNumber || '',
            hasInternalId: !!request.itemFulfillmentInternalId,
            purchaseOrderNumber: request.purchaseOrderNumber || '',
            hasPurchaseOrderInternalId: !!request.purchaseOrderInternalId
        };
    }

    function safeClientMessage(exception) {
        return exception.message || 'Packing slip could not be rendered.';
    }

    function firstPresent(objectValue, keys) {
        for (var i = 0; i < keys.length; i += 1) {
            if (objectValue[keys[i]] !== undefined && objectValue[keys[i]] !== null) {
                return objectValue[keys[i]];
            }
        }
        return '';
    }

    function safeGetValue(netSuiteRecord, fieldId) {
        try {
            return netSuiteRecord.getValue({ fieldId: fieldId });
        } catch (exception) {
            return '';
        }
    }

    function safeGetText(netSuiteRecord, fieldId) {
        try {
            return netSuiteRecord.getText({ fieldId: fieldId });
        } catch (exception) {
            return '';
        }
    }

    function cleanText(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).replace(/^\s+|\s+$/g, '');
    }

    function dateToIso(value) {
        if (!value) {
            return '';
        }
        if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
            return value.getFullYear() + '-' + pad2(value.getMonth() + 1) + '-' + pad2(value.getDate());
        }
        return cleanText(value);
    }

    function pad2(value) {
        return String(value).length === 1 ? '0' + value : String(value);
    }

    function sanitizeFileNamePart(value) {
        return cleanText(value).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'Transaction';
    }

    return {
        get: get,
        post: post
    };
});
