/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 */
define([
    'N/error',
    'N/file',
    'N/log',
    'N/record',
    'N/runtime',
    'N/search'
], function (
    error,
    file,
    log,
    record,
    runtime,
    search
) {
    'use strict';

    var PARAM_SIGNED_FOLDER_ID = 'custscript_ops_signed_ps_folder_id';
    var FIELD_SIGNED_STATUS = 'custbody_dt_signed_status';
    var MAX_BASE64_PDF_LENGTH = 40 * 1024 * 1024;

    function post(requestBody) {
        try {
            return handleRequest(parseRequestBody(requestBody));
        } catch (exception) {
            log.error({
                title: 'OPS_SIGNED_PACKING_SLIP_PARSE_FAILURE',
                details: safeErrorDetails(exception, {})
            });
            return failureResponse(exception.name || 'SIGNED_PACKING_SLIP_ERROR', exception.message || String(exception));
        }
    }

    function handleRequest(payload) {
        var request = normalizeRequest(payload || {});

        log.audit({
            title: 'OPS_SIGNED_PACKING_SLIP_REQUEST',
            details: {
                itemFulfillmentInternalId: request.itemFulfillmentInternalId,
                itemFulfillmentNumber: request.itemFulfillmentNumber,
                fileName: request.fileName
            }
        });

        try {
            var folderId = resolveDestinationFolderId();
            var verification = verifyItemFulfillmentAndSalesOrder(request);
            var duplicateFile = findExistingSignedPackingSlip(folderId, verification.itemFulfillmentNumber);
            if (duplicateFile) {
                return failureResponse(
                    'SIGNED_PACKING_SLIP_ALREADY_EXISTS',
                    'A signed packing slip already exists for ' + verification.itemFulfillmentNumber + '.',
                    {
                        existing_file_id: duplicateFile.id,
                        file_id: duplicateFile.id
                    }
                );
            }

            var fileId = saveSignedPdfFile(request, folderId, verification);
            var itemFulfillmentAttached = false;
            var salesOrderAttached = false;
            var itemFulfillmentAttachError = '';
            var salesOrderAttachError = '';

            try {
                attachFileToRecord(fileId, record.Type.ITEM_FULFILLMENT, verification.itemFulfillmentInternalId);
                itemFulfillmentAttached = true;
            } catch (exception) {
                itemFulfillmentAttachError = exception.message || String(exception);
                log.error({
                    title: 'OPS_SIGNED_PACKING_SLIP_IF_ATTACH_FAILURE',
                    details: {
                        itemFulfillmentInternalId: verification.itemFulfillmentInternalId,
                        fileId: fileId,
                        error: itemFulfillmentAttachError
                    }
                });
            }

            try {
                attachFileToRecord(fileId, record.Type.SALES_ORDER, verification.salesOrderInternalId);
                salesOrderAttached = true;
            } catch (exception) {
                salesOrderAttachError = exception.message || String(exception);
                log.error({
                    title: 'OPS_SIGNED_PACKING_SLIP_SO_ATTACH_FAILURE',
                    details: {
                        salesOrderInternalId: verification.salesOrderInternalId,
                        fileId: fileId,
                        error: salesOrderAttachError
                    }
                });
            }

            if (!itemFulfillmentAttached || !salesOrderAttached) {
                return failureResponse(
                    'PARTIAL_ATTACHMENT_FAILURE',
                    partialAttachmentMessage(itemFulfillmentAttached, salesOrderAttached),
                    {
                        file_id: String(fileId),
                        attached_to_item_fulfillment: itemFulfillmentAttached,
                        attached_to_sales_order: salesOrderAttached,
                        item_fulfillment_attachment_error: itemFulfillmentAttachError,
                        sales_order_attachment_error: salesOrderAttachError
                    }
                );
            }

            var signedStatusUpdated = false;
            try {
                markItemFulfillmentSigned(verification.itemFulfillmentInternalId);
                signedStatusUpdated = true;
            } catch (exception) {
                log.error({
                    title: 'OPS_SIGNED_PACKING_SLIP_STATUS_UPDATE_FAILURE',
                    details: {
                        itemFulfillmentInternalId: verification.itemFulfillmentInternalId,
                        fileId: fileId,
                        fieldId: FIELD_SIGNED_STATUS,
                        error: exception.message || String(exception)
                    }
                });
                return failureResponse(
                    'SIGNED_STATUS_UPDATE_FAILURE',
                    'The file was attached, but the Item Fulfillment signed status could not be updated.',
                    {
                        file_id: String(fileId),
                        attached_to_item_fulfillment: itemFulfillmentAttached,
                        attached_to_sales_order: salesOrderAttached,
                        signed_status_updated: false,
                        signed_status_update_error: exception.message || String(exception)
                    }
                );
            }

            log.audit({
                title: 'OPS_SIGNED_PACKING_SLIP_SUCCESS',
                details: {
                    itemFulfillmentInternalId: verification.itemFulfillmentInternalId,
                    salesOrderInternalId: verification.salesOrderInternalId,
                    fileName: request.fileName,
                    fileId: fileId,
                    signedStatusUpdated: signedStatusUpdated
                }
            });

            return {
                success: true,
                item_fulfillment: {
                    internal_id: verification.itemFulfillmentInternalId,
                    transaction_number: verification.itemFulfillmentNumber
                },
                sales_order: {
                    internal_id: verification.salesOrderInternalId,
                    transaction_number: verification.salesOrderNumber
                },
                signed_document: {
                    file_id: String(fileId),
                    file_name: request.fileName,
                    attached_to_item_fulfillment: true,
                    attached_to_sales_order: true,
                    signed_status_updated: signedStatusUpdated
                }
            };
        } catch (exception) {
            log.error({
                title: 'OPS_SIGNED_PACKING_SLIP_FAILURE',
                details: safeErrorDetails(exception, request)
            });
            return failureResponse(exception.name || 'SIGNED_PACKING_SLIP_ERROR', exception.message || String(exception));
        }
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
        var request = {
            itemFulfillmentInternalId: cleanText(payload.item_fulfillment_internal_id),
            itemFulfillmentNumber: normalizeItemFulfillmentNumber(payload.item_fulfillment_number),
            salesOrderInternalId: cleanText(payload.sales_order_internal_id),
            salesOrderNumber: cleanText(payload.sales_order_number),
            fileName: sanitizeFileName(payload.file_name),
            contentType: cleanText(payload.content_type).toLowerCase(),
            encoding: cleanText(payload.encoding).toLowerCase(),
            data: cleanText(payload.data),
            printedName: cleanText(payload.printed_name),
            signedAt: cleanText(payload.signed_at),
            submittedBy: cleanText(payload.submitted_by),
            deliveryPhotoFileName: cleanText(payload.delivery_photo_file_name)
        };

        if (!request.itemFulfillmentInternalId) {
            throw makeIntegrationError('MISSING_ITEM_FULFILLMENT_ID', 'Item Fulfillment internal ID is required.');
        }
        if (!request.itemFulfillmentNumber) {
            throw makeIntegrationError('MISSING_ITEM_FULFILLMENT_NUMBER', 'Item Fulfillment number is required.');
        }
        if (!request.salesOrderInternalId) {
            throw makeIntegrationError('MISSING_SALES_ORDER_ID', 'Sales Order internal ID is required.');
        }
        if (!request.fileName) {
            throw makeIntegrationError('MISSING_FILE_NAME', 'Signed PDF file name is required.');
        }
        if (request.contentType !== 'application/pdf') {
            throw makeIntegrationError('UNSUPPORTED_CONTENT_TYPE', 'Signed packing slip must be application/pdf.');
        }
        if (request.encoding !== 'base64') {
            throw makeIntegrationError('UNSUPPORTED_ENCODING', 'Signed packing slip must use base64 encoding.');
        }
        validateBase64Pdf(request.data);
        return request;
    }

    function resolveDestinationFolderId() {
        var folderId = cleanText(runtime.getCurrentScript().getParameter({ name: PARAM_SIGNED_FOLDER_ID }));
        if (!folderId) {
            throw makeIntegrationError('MISSING_FILE_CABINET_FOLDER', 'Signed packing slip destination folder is not configured.');
        }
        if (!/^\d+$/.test(folderId)) {
            throw makeIntegrationError('INVALID_FILE_CABINET_FOLDER', 'Signed packing slip destination folder must be a numeric internal ID.');
        }
        return folderId;
    }

    function verifyItemFulfillmentAndSalesOrder(request) {
        var fulfillmentRecord;
        try {
            fulfillmentRecord = record.load({
                type: record.Type.ITEM_FULFILLMENT,
                id: request.itemFulfillmentInternalId,
                isDynamic: false
            });
        } catch (exception) {
            throw makeIntegrationError('ITEM_FULFILLMENT_NOT_FOUND', 'Item Fulfillment was not found or is not accessible.', exception);
        }

        var actualItemFulfillmentNumber = normalizeItemFulfillmentNumber(safeGetValue(fulfillmentRecord, 'tranid'));
        if (actualItemFulfillmentNumber && actualItemFulfillmentNumber !== request.itemFulfillmentNumber) {
            throw makeIntegrationError('ITEM_FULFILLMENT_MISMATCH', 'Item Fulfillment number does not match the provided internal ID.');
        }

        var actualSalesOrderId = cleanText(safeGetValue(fulfillmentRecord, 'createdfrom'));
        if (!actualSalesOrderId) {
            throw makeIntegrationError('MISSING_SALES_ORDER', 'The Item Fulfillment is missing an originating Sales Order.');
        }
        if (actualSalesOrderId !== request.salesOrderInternalId) {
            throw makeIntegrationError('ITEM_FULFILLMENT_SALES_ORDER_MISMATCH', 'The supplied Sales Order does not match the Item Fulfillment source.');
        }

        var salesOrderRecord;
        try {
            salesOrderRecord = record.load({
                type: record.Type.SALES_ORDER,
                id: actualSalesOrderId,
                isDynamic: false
            });
        } catch (exception) {
            throw makeIntegrationError('SALES_ORDER_NOT_FOUND', 'The originating Sales Order was not found or is not accessible.', exception);
        }

        return {
            itemFulfillmentInternalId: request.itemFulfillmentInternalId,
            itemFulfillmentNumber: actualItemFulfillmentNumber || request.itemFulfillmentNumber,
            salesOrderInternalId: actualSalesOrderId,
            salesOrderNumber: cleanText(safeGetValue(salesOrderRecord, 'tranid')) || request.salesOrderNumber
        };
    }

    function findExistingSignedPackingSlip(folderId, itemFulfillmentNumber) {
        var duplicate = null;
        var prefix = 'Signed Packing Slip - ' + sanitizeFileNamePart(itemFulfillmentNumber);
        search.create({
            type: 'file',
            filters: [
                ['folder', 'anyof', folderId],
                'AND',
                ['name', 'startswith', prefix]
            ],
            columns: [
                search.createColumn({ name: 'internalid', sort: search.Sort.DESC }),
                'name'
            ]
        }).run().each(function (result) {
            duplicate = {
                id: result.getValue({ name: 'internalid' }),
                name: result.getValue({ name: 'name' })
            };
            return false;
        });
        return duplicate;
    }

    function saveSignedPdfFile(request, folderId, verification) {
        try {
            var pdfFile = file.create({
                name: request.fileName,
                fileType: file.Type.PDF,
                contents: request.data,
                folder: Number(folderId),
                description: buildFileDescription(request, verification)
            });
            var fileId = pdfFile.save();
            log.audit({
                title: 'OPS_SIGNED_PACKING_SLIP_FILE_SAVED',
                details: {
                    itemFulfillmentInternalId: verification.itemFulfillmentInternalId,
                    salesOrderInternalId: verification.salesOrderInternalId,
                    fileName: request.fileName,
                    fileId: fileId
                }
            });
            return fileId;
        } catch (exception) {
            throw makeIntegrationError('FILE_SAVE_FAILURE', 'Signed packing slip could not be saved in the File Cabinet.', exception);
        }
    }

    function attachFileToRecord(fileId, recordType, recordId) {
        record.attach({
            record: {
                type: 'file',
                id: fileId
            },
            to: {
                type: recordType,
                id: recordId
            }
        });
    }

    function markItemFulfillmentSigned(itemFulfillmentInternalId) {
        record.submitFields({
            type: record.Type.ITEM_FULFILLMENT,
            id: itemFulfillmentInternalId,
            values: {
                custbody_dt_signed_status: true
            },
            options: {
                enableSourcing: false,
                ignoreMandatoryFields: true
            }
        });
        log.audit({
            title: 'OPS_SIGNED_PACKING_SLIP_STATUS_UPDATED',
            details: {
                itemFulfillmentInternalId: itemFulfillmentInternalId,
                fieldId: FIELD_SIGNED_STATUS
            }
        });
    }

    function validateBase64Pdf(value) {
        if (!value) {
            throw makeIntegrationError('MISSING_PDF_DATA', 'Signed PDF data is required.');
        }
        if (value.length > MAX_BASE64_PDF_LENGTH) {
            throw makeIntegrationError('PDF_TOO_LARGE', 'Signed PDF is too large.');
        }
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
            throw makeIntegrationError('INVALID_BASE64_PDF', 'Signed PDF data must be valid base64.');
        }
        if (value.indexOf('JVBER') !== 0) {
            throw makeIntegrationError('INVALID_PDF_DATA', 'Signed PDF data must be a PDF.');
        }
    }

    function buildFileDescription(request, verification) {
        var parts = [
            'Signed packing slip',
            'IF ' + verification.itemFulfillmentNumber,
            'SO ' + verification.salesOrderNumber,
            'Received by ' + request.printedName,
            'Signed at ' + request.signedAt,
            'Submitted by ' + request.submittedBy
        ];
        if (request.deliveryPhotoFileName) {
            parts.push('Photo: ' + request.deliveryPhotoFileName);
        }
        return parts.join(' | ').slice(0, 999);
    }

    function partialAttachmentMessage(itemFulfillmentAttached, salesOrderAttached) {
        if (itemFulfillmentAttached && !salesOrderAttached) {
            return 'The file was saved and attached to the Item Fulfillment, but the Sales Order attachment failed.';
        }
        if (!itemFulfillmentAttached && salesOrderAttached) {
            return 'The file was saved and attached to the Sales Order, but the Item Fulfillment attachment failed.';
        }
        return 'The file was saved, but attachments to the Item Fulfillment and Sales Order failed.';
    }

    function failureResponse(code, message, extra) {
        var response = {
            success: false,
            error: {
                code: code,
                message: message
            }
        };
        var safeExtra = extra || {};
        Object.keys(safeExtra).forEach(function (key) {
            response[key] = safeExtra[key];
        });
        return response;
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
            code: exception.name || 'SIGNED_PACKING_SLIP_ERROR',
            message: exception.message || String(exception),
            causeName: exception.causeName || '',
            causeMessage: exception.causeMessage || '',
            itemFulfillmentInternalId: request.itemFulfillmentInternalId || '',
            itemFulfillmentNumber: request.itemFulfillmentNumber || '',
            fileName: request.fileName || ''
        };
    }

    function normalizeItemFulfillmentNumber(value) {
        var text = cleanText(value).toUpperCase().replace(/\s+/g, '');
        if (!text) {
            return '';
        }
        if (!/^IF[0-9A-Z][0-9A-Z-]{0,38}$/.test(text)) {
            throw makeIntegrationError('INVALID_ITEM_FULFILLMENT_NUMBER', 'Item Fulfillment number must look like IF123456.');
        }
        return text;
    }

    function sanitizeFileName(value) {
        var fileName = sanitizeFileNamePart(value);
        if (!fileName) {
            return '';
        }
        if (!/\.pdf$/i.test(fileName)) {
            fileName += '.pdf';
        }
        return fileName.slice(0, 120);
    }

    function sanitizeFileNamePart(value) {
        return cleanText(value).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').replace(/^\.+|\.+$/g, '');
    }

    function cleanText(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value).replace(/^\s+|\s+$/g, '');
    }

    function safeGetValue(netSuiteRecord, fieldId) {
        try {
            return netSuiteRecord.getValue({ fieldId: fieldId });
        } catch (exception) {
            return '';
        }
    }

    return {
        post: post
    };
});
