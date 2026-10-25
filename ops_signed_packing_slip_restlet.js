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
    'N/search',
    'N/query'
], function (
    error,
    file,
    log,
    record,
    runtime,
    search,
    query
) {
    'use strict';

    var PARAM_SIGNED_FOLDER_ID = 'custscript_ops_signed_ps_folder_id';
    var FIELD_SIGNED_STATUS = 'custbody_dt_signed_status';
    var DOCUMENT_TYPE_SIGNED = 'signed_packing_slip';
    var DOCUMENT_TYPE_NO_SIGNATURE = 'no_signature_delivery_evidence';
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
        if (payload && payload.action === 'delivery_driver_choices') {
            return {success: true, action: payload.action, drivers: activeDeliveryDrivers()};
        }
        if (payload && payload.action === 'reassign_delivery_driver') {
            return reassignDeliveryDriver(payload);
        }
        var request = normalizeRequest(payload || {});

        log.audit({
            title: 'OPS_SIGNED_PACKING_SLIP_REQUEST',
            details: {
                itemFulfillmentInternalId: request.itemFulfillmentInternalId,
                itemFulfillmentNumber: request.itemFulfillmentNumber,
                fileName: request.fileName,
                documentType: request.documentType,
                updateSignedStatus: request.updateSignedStatus
            }
        });

        try {
            var folderId = resolveDestinationFolderId();
            var verification = verifyItemFulfillmentAndSalesOrder(request);
            var duplicateFile = findExistingPackingSlip(
                folderId,
                verification.itemFulfillmentNumber,
                request.documentType,
                request.deliveryAttempt
            );
            if (duplicateFile) {
                var isNoSignatureDuplicate = request.documentType === DOCUMENT_TYPE_NO_SIGNATURE;
                return failureResponse(
                    isNoSignatureDuplicate
                        ? 'NO_SIGNATURE_DELIVERY_EVIDENCE_ALREADY_EXISTS'
                        : 'SIGNED_PACKING_SLIP_ALREADY_EXISTS',
                    isNoSignatureDuplicate
                        ? 'The no-location delivery exception for ' + verification.itemFulfillmentNumber + ' has already been submitted.'
                        : 'A signed packing slip already exists for ' + verification.itemFulfillmentNumber + '.',
                    {
                        delivery_attempt: request.deliveryAttempt,
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

            if (request.attachToItemFulfillment) {
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

            if ((request.attachToItemFulfillment && !itemFulfillmentAttached) || !salesOrderAttached) {
                return failureResponse(
                    'PARTIAL_ATTACHMENT_FAILURE',
                    request.attachToItemFulfillment
                        ? partialAttachmentMessage(itemFulfillmentAttached, salesOrderAttached)
                        : 'The delivery evidence file was saved, but the Sales Order attachment failed.',
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
            if (request.updateSignedStatus) {
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
                delivery_attempt: request.deliveryAttempt,
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
                    attached_to_item_fulfillment: itemFulfillmentAttached,
                    attached_to_sales_order: salesOrderAttached,
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

    function activeDeliveryDrivers() {
        var rows = query.runSuiteQL({query: "SELECT id, name FROM customlist_lamesa_drivers WHERE isinactive = 'F' ORDER BY id"}).asMappedResults();
        if (rows.length > 1000) {
            throw makeIntegrationError('DELIVERY_DRIVER_LIMIT', 'Too many delivery drivers.');
        }
        return rows.filter(function (row) {
            return cleanText(row.name).replace(/\s+/g, ' ').toLowerCase() !== 'george frye (test)';
        }).map(function (row) { return {id: String(row.id), name: cleanText(row.name)}; });
    }

    function reassignDeliveryDriver(payload) {
        var fulfillmentId = cleanText(payload.fulfillment_id);
        var driverId = cleanText(payload.driver_id);
        var expectedId = cleanText(payload.expected_driver_id);
        if (!/^[1-9][0-9]{0,17}$/.test(fulfillmentId) || !/^[1-9][0-9]{0,17}$/.test(driverId) ||
                !Object.prototype.hasOwnProperty.call(payload, 'expected_driver_id') ||
                (expectedId && !/^[1-9][0-9]{0,17}$/.test(expectedId))) {
            throw makeIntegrationError('INVALID_DELIVERY_DRIVER', 'Valid fulfillment, driver and expected driver IDs are required.');
        }
        if (!activeDeliveryDrivers().some(function (driver) { return driver.id === driverId; })) {
            throw makeIntegrationError('INVALID_DELIVERY_DRIVER', 'Select an active delivery driver.');
        }
        var fulfillment = record.load({type: record.Type.ITEM_FULFILLMENT, id: fulfillmentId, isDynamic: false});
        var signed = fulfillment.getValue({fieldId: FIELD_SIGNED_STATUS});
        if (signed === true || signed === 'T') {
            throw makeIntegrationError('DELIVERY_ALREADY_SIGNED', 'This fulfillment already has a signed copy.');
        }
        var current = cleanText(fulfillment.getValue({fieldId: 'custbody_delivery_driver'}));
        if (current !== driverId) {
            if (current !== expectedId) {
                throw makeIntegrationError('DELIVERY_DRIVER_CONFLICT', 'The driver changed in NetSuite. Refresh before reassigning.');
            }
            fulfillment.setValue({fieldId: 'custbody_delivery_driver', value: Number(driverId)});
            // Save the loaded record so NetSuite can reject concurrent edits.
            fulfillment.save({enableSourcing: false, ignoreMandatoryFields: false});
        }
        var verified = record.load({type: record.Type.ITEM_FULFILLMENT, id: fulfillmentId, isDynamic: false});
        if (cleanText(verified.getValue({fieldId: 'custbody_delivery_driver'})) !== driverId) {
            throw makeIntegrationError('DELIVERY_DRIVER_CONFLICT', 'NetSuite did not retain the selected driver.');
        }
        return {success: true, action: 'reassign_delivery_driver', fulfillment_id: fulfillmentId, driver_id: driverId};
    }

    function normalizeRequest(payload) {
        var documentType = cleanText(payload.document_type).toLowerCase() || DOCUMENT_TYPE_SIGNED;
        if (documentType !== DOCUMENT_TYPE_SIGNED && documentType !== DOCUMENT_TYPE_NO_SIGNATURE) {
            throw makeIntegrationError('UNSUPPORTED_DOCUMENT_TYPE', 'Packing slip document type is not supported.');
        }
        var isNoSignatureEvidence = documentType === DOCUMENT_TYPE_NO_SIGNATURE;
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
            deliveryPhotoFileName: cleanText(payload.delivery_photo_file_name),
            documentType: documentType,
            deliveryAttempt: payload.delivery_attempt == null ? 1 : Number(payload.delivery_attempt),
            attachToItemFulfillment: !isNoSignatureEvidence,
            attachToSalesOrder: true,
            updateSignedStatus: !isNoSignatureEvidence,
            idempotencyKey: cleanText(payload.idempotency_key),
            rejectIfExisting: isNoSignatureEvidence || payload.reject_if_existing === true
        };

        if (!Number.isInteger(request.deliveryAttempt) || request.deliveryAttempt < 1 || request.deliveryAttempt > 1000000) {
            throw makeIntegrationError('INVALID_DELIVERY_ATTEMPT', 'Delivery attempt is invalid.');
        }
        if (!request.itemFulfillmentInternalId) {
            throw makeIntegrationError('MISSING_ITEM_FULFILLMENT_ID', 'Item Fulfillment internal ID is required.');
        }
        if (!request.itemFulfillmentNumber) {
            throw makeIntegrationError('MISSING_ITEM_FULFILLMENT_NUMBER', 'Item Fulfillment number is required.');
        }
        if (!request.salesOrderInternalId) {
            throw makeIntegrationError('MISSING_SALES_ORDER_ID', 'Sales Order internal ID is required.');
        }
        if (isNoSignatureEvidence) {
            request.fileName = 'NO SIGNATURE - Delivery Evidence - ' +
                sanitizeFileNamePart(request.itemFulfillmentNumber) +
                (request.deliveryAttempt > 1 ? ' - Attempt ' + request.deliveryAttempt + ' - Evidence' : '') + '.pdf';
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

    function findExistingPackingSlip(folderId, itemFulfillmentNumber, documentType, deliveryAttempt) {
        var duplicate = null;
        var prefix = documentType === DOCUMENT_TYPE_NO_SIGNATURE
            ? 'NO SIGNATURE - Delivery Evidence - ' + sanitizeFileNamePart(itemFulfillmentNumber)
            : 'Signed Packing Slip - ' + sanitizeFileNamePart(itemFulfillmentNumber);
        if (documentType === DOCUMENT_TYPE_NO_SIGNATURE && deliveryAttempt > 1) {
            prefix += ' - Attempt ' + deliveryAttempt + ' -';
        }
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
        var parts;
        if (request.documentType === DOCUMENT_TYPE_NO_SIGNATURE) {
            parts = [
                'NO SIGNATURE - delivery evidence',
                'IF ' + verification.itemFulfillmentNumber,
                'SO ' + verification.salesOrderNumber,
                'Submitted at ' + request.signedAt,
                'Submitted by ' + request.submittedBy
            ];
        } else {
            parts = [
                'Signed packing slip',
                'IF ' + verification.itemFulfillmentNumber,
                'SO ' + verification.salesOrderNumber,
                'Received by ' + request.printedName,
                'Signed at ' + request.signedAt,
                'Submitted by ' + request.submittedBy
            ];
        }
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
