/*
 ***********************************************************************
 *
 * The following javascript code is created by FMT Consultants LLC,
 * a NetSuite Partner. It is a SuiteFlex component containing custom code
 * intended for NetSuite (www.netsuite.com) and use the SuiteScript API.
 * The code is provided "as is": FMT Consultants LLC shall not be liable
 * for any damages arising out the intended use or if the code is modified
 * after delivery.
 *
 * Company:     FMT Consultants LLC, www.fmtconsultants.com
 * Author:      ibudimir@fmtconsultants.com
 * File:        FMT_LIB_IntegrationProject.js
 * Date:        05/25/2017
 * Ver:         2.0
 *
 * Revision:
 * -----------------------------------------------------------------------
 * 09/20/2016 | Adjusted the code to support setting default values for sublist fields
 * 07/13/2017 | Adjusted -processCustomerRecord- function to check for a boolean value instead of NS 'T' / 'F'
 * 08/24/2017 | Added extra validation to -transformNlobjRecord-. Now we check for internal id and transaction number in the created from
 * field. In addition for Item Receipts and Fulfillments we un-check -itemreceive- field before we start processing integration objects.
 * 08/30/2017 | Major adjustments to -receiveNsLine- function. Custom column field is now used for look-ups of what lines should be fulfilled / received
 * by the function. Added -getTransactionLineId-, this function will look-up the NS line id of the line that must be fulfilled. This is performed dynamically.
 * 09/12/2017 | Added logging to -setNsLine-. It is important to identify which SKU's are failing.
 * 02/07/2018 | Update function -transformNlobjRecord-. It now transforms integers into strings when it looks up order numbers in the system.
 * 02/07/2018 | Added -getPropertyFromValue- function. Modified -findTransactionByInternalId- and added another attribute to be passed to the function (transaction type).
 ***********************************************************************/

var FMT_ERROR_LOG_RECORD = {
    NAME : 'customrecord_fmt_error_log',
    TRANSACTION_ID : 'custrecord_transaction_id',
    TRANSACTION_INTERNAL_ID : 'custrecord_transaction_internal_id',
    ERROR_MESSAGE : 'custrecord_error_message'
};

var SS_TO_TRANSACTION_CONVERSION_TABLE = {
    Build : 'assemblybuild',
    Unbuild : 'assemblyunbuild',
    VendBill : 'vendorbill',
    VendCred : 'vendorcredit',
    VendPymt : 'vendorpayment',
    BinWksht : 'binworksheet',
    BinTrnfr : 'bintransfer',
    CashRfnd : 'cashrefund',
    CashSale : 'cashsale',
    Check : 'check',
    CustCred : 'creditmemo',
    CustDep : 'customerdeposit',
    CustRfnd : 'customerrefund',
    Deposit : 'deposit',
    DepAppl : 'depositapplication',
    ExpRept : 'expensereport',
    InvAdjst : 'inventoryadjustment',
    InvTrnfr : 'inventorytransfer',
    CustInvc : 'invoice',
    ItemShip : 'itemfulfillment',
    ItemRcpt : 'itemreceipt',
    Opprtnty : 'opportunity',
    CustPymt : 'customerpayment',
    PurchOrd : 'purchaseorder',
    RtnAuth : 'returnauthorization',
    SalesOrd : 'salesorder',
    VendAuth : 'vendorreturnauthorization',
    WorkOrd : 'workorder',
    Journal : 'journalentry'
};

var TRANSACTION_CONVERSION_TABLE = {
    "Bill" : "vendorbill",
    "Bill Credit" : "vendorcredit",
    "Bill Payment" : "vendorpayment",
    "Bin Putaway Worksheet" : "binworksheet",
    "Bin Transfer" : "bintransfer",
    "Cash Refund" : "cashrefund",
    "Cash Sale" : "cashsale",
    "CCard Refund" : "cashrefund",
    "Check" : "check",
    "Commission" : "commission",
    "Credit Card" : null,
    "Credit Memo" : "creditmemo",
    "Currency Revaluation" : null,
    "Customer Deposit" : "customerdeposit",
    "Customer Refund" : "customerrefund",
    "Deposit" : "deposit",
    "Deposit Application" : "depositapplication",
    "Expense Report" : "expensereport",
    "Inventory Adjustment" : "inventoryadjustment",
    "Inventory Count" : "inventorycount",
    "Inventory Transfer" : "inventorytransfer",
    "Inventory Worksheet" : "inventoryworksheet",
    "Invoice" : "invoice",
    "Item Fulfillment" : "itemfulfillment",
    "Item Receipt" : "itemreceipt",
    "Journal" : "journalentry",
    "Opportunity" : "opportunity",
    "Payment" : "customerpayment",
    "Purchase Order" : "purchaseorder",
    "Quote" : "estimate",
    "Return Authorization" : "returnauthorization",
    "Sales Order" : "salesorder",
    "Transfer Order" : "transferorder",
    "Vendor Return Authorization" : "vendorreturnauthorization",
};

var SS_LOOKUP_FIELDTYPE_MAPPING = {
    item : 'itemid',
    entity : 'entityid',
    partner : 'entityid',
    employee : 'entityid',
    createdfrom : 'numbertext'
};

var TRANSACTION_STATUS_CONVERSION_TABLE = {
    "Sales Order:Pending Approval" : "A",
    "Sales Order:Pending Fulfillment" : "B",
    "Item Fulfillment:Picked" : "A",
    "Item Fulfillment:Packed" : "B",
    "Item Fulfillment:Shipped" : "C",
    "Journal:Pending Approval" : "A",
    "Journal:Approved for Posting" : "B"
};

var ADDRESS_TYPES = {
    "shippingaddress" : 1,
    "billingaddress" : 2,
};

var RESTRICTED_ORDER_STATUSES = ['pendingApproval', 'cancelled', 'pendingBilling', 'billed', 'closed'];

g_dateformat = null;

/*****************************************/
// Main Integration Project Functions
/*****************************************/
/**
 * Main / control integration function. It is called by the RESTlet method.
 * The following are the actions performed by this function:
 * -----------------------------------------------------------
 * 1. Extracts schema from -Integration Project Field- record
 * 2. Groups the results (objects) by line property. This separates header from line fields.
 * 3. Sets NS record fields
 * 4. Returns record internalid if the operations are completed successfully
 *
 * @author ibudimir@fmtconsultants.com
 * @param {object} externalObject
 * @param {integer} integrationProject
 * @param {string} recordType
 * @returns {string} internalid / error
 */
function setNlobjRecord(externalObject, integrationProject, recordType) {
    try {
        //1. Extract schema
        var fieldSchema = getIntergrationProjectSchema(integrationProject, externalObject);

        if (isEmpty(fieldSchema)) {
            var errorMessage = 'Schema of the integration project is missing.';
            return buildErrorMessage(errorMessage, SCRIPT_ID);
        }

        //2. Group by line
        var groupedByLine = groupBy(fieldSchema, function(object) {
            return [object.line, object.join];
        });

        //3. Check for sublist fields with default values
        var defaultLineColumnFieldsToAdd = getSublistFieldsWithDefaultValues(fieldSchema);

        //4. Start setting the NS record fields
        var nsRecord = nlapiCreateRecord(recordType);

        /*&&&&&&&&&&&&&&&&&&&&&&&&*/
        //Loop starts here

        for (var i = 0; i < groupedByLine.length; i++) {

            var groupedFields = groupedByLine[i];

            //a. it is likely that the first child of the array are body fields - object.line = 0
            if (groupedFields[0].line == 0) {

                //b. set header fields
                //b.1 determine the internalid for lookup fields and generate join records if necessary (Customer / Contact)
                for (var j = 0; j < groupedFields.length; j++) {
                    var headerField = groupedFields[j];

                    if (!isEmpty(headerField.lookup) && (headerField.isSublist != 'T')) {
                        var valueFoundArray = getPropertyRecursive(externalObject, headerField.lookup);
                        //not only one value will be accepted here, these are header fields

                        if (valueFoundArray.length > 0) {
                            var lookupValue = valueFoundArray[0].value;
                            var lookupFieldObject = findObj(groupedFields, 'external', headerField.lookup);

                            if (!isEmpty(lookupValue) && !isEmpty(lookupFieldObject) && lookupFieldObject.hasOwnProperty('netsuite')) {
                                if (!isEmpty(headerField.join)) {
                                    var recordInternalId = lookupRecordInNetSuite(headerField.join, lookupFieldObject.netsuite, lookupValue);

                                    if (!isEmpty(recordInternalId)) {
                                        nsRecord.setFieldValue(headerField.netsuite, recordInternalId);
                                    } else {//record not found let's create it

                                        var newRecordInternalId = createJoinRecord(headerField.join, groupedFields);
                                        if (!isEmpty(newRecordInternalId)) {
                                            nsRecord.setFieldValue(headerField.netsuite, newRecordInternalId);
                                        } else {
                                            var errorMessage = 'The integration was not able to create new' + headerField.join + ' record.';
                                            return buildErrorMessage(errorMessage, SCRIPT_ID);
                                        }
                                    }
                                }
                            } else {//isEmpty(lookupValue)
                                //can't find the record, let's create it
                                if (!isEmpty(headerField.join)) {
                                    var newRecordInternalId = createJoinRecord(headerField.join, groupedFields);
                                    if (!isEmpty(newRecordInternalId)) {
                                        nsRecord.setFieldValue(headerField.netsuite, newRecordInternalId);
                                    } else {
                                        var errorMessage = 'The integration was not able to create new' + headerField.join + ' record.';
                                        return buildErrorMessage(errorMessage, SCRIPT_ID);
                                    }
                                }
                            }
                        }
                    } else {//regular header field not lookup
                        //b.2 set other header fields
                        if (isEmpty(headerField.lookup) && isEmpty(headerField.join) && (headerField.isSublist != 'T')) {
                            setNsField(nsRecord, headerField.fieldType, headerField.netsuite, (!isEmpty(headerField.defaultValue) ? headerField.defaultValue : headerField.externalValue));
                        }
                    }
                }
            }

            //c. set line-level fields / sublists
            if (groupedFields[0].line > 0) {
                var responseObject = setNsLine(nsRecord, groupedFields[0].join, groupedFields, (defaultLineColumnFieldsToAdd.length > 0 ? defaultLineColumnFieldsToAdd : null));
                if (responseObject.response != true) {
                    var errorMessage = responseObject.message;
                    return buildErrorMessage(errorMessage, SCRIPT_ID);
                }
            } else {//d. set address sub-record(s)
                if (groupedFields[0].line < 0) {
                    var success = setNsAddress(nsRecord, groupedFields);
                    if (success != true) {
                        var errorMessage = 'The integration was not able to create new lines for the sublist record.';
                        return buildErrorMessage(errorMessage, SCRIPT_ID);
                    }
                }
            }
        }

        /*&&&&&&&&&&&&&&&&&&&&&&&&*/
        //Loop ends here

        var id = nlapiSubmitRecord(nsRecord, true);
        return id;

    } catch(err) {
        return buildErrorMessage(err.toString(), SCRIPT_ID);
    }
}

/**
 * This function is called by the RESTlet method. It transforms:
 *      a. PO's into Item Receipt
 *      b. Sales Order into Item Fulfillments
 *
 * The following are the actions performed by this function:
 * -----------------------------------------------------------
 * 1. Extracts schema from -Integration Project Field- record
 * 2. Groups the results (objects) by line property. This separates header from line fields.
 * 3. Sets NS record fields / Fullfills or Receives Transaction Lines
 * 4. Returns record internalid if the operations are completed successfully
 *
 * @author ibudimir@fmtconsultants.com
 * @param {object} externalObject
 * @param {integer} integrationProject
 * @param {string} sourceRecordType
 * @param {string} targetRecordType
 * @returns {string} internalid / error
 */
function transformNlobjRecord(externalObject, integrationProject, sourceRecordType, targetRecordType) {
    try {
        //1. Extract schema
        var fieldSchema = getIntergrationProjectSchema(integrationProject, externalObject);

        if (isEmpty(fieldSchema)) {
            var errorMessage = 'Schema of the integration project is missing.';
            return buildErrorMessage(errorMessage, SCRIPT_ID);
        }

        //2. Before grouping, lookup the source transaction -createdfrom- from schema
        var isCreatedFromFound = findObj(fieldSchema, 'netsuite', 'createdfrom');
        if (!isEmpty(isCreatedFromFound)) {

            var createdFrom = isCreatedFromFound.externalValue;

            if (isNumber(createdFrom)) {//2.a sometimes the -createdfrom- will be passed as id
                var ssSourceTransactionType = getPropertyFromValue(SS_TO_TRANSACTION_CONVERSION_TABLE, sourceRecordType);
                var sourceRecordId = (findTransactionByInternalId(parseInt(createdFrom, 10), ssSourceTransactionType) == true) ? parseInt(createdFrom, 10) : null;
                if (isEmpty(sourceRecordId)) {
                    var fieldToQuery = SS_LOOKUP_FIELDTYPE_MAPPING[isCreatedFromFound.netsuite];
                    var sourceRecordId = lookupRecordInNetSuite('transaction', fieldToQuery, createdFrom.toString());
                }
            } else {//2.b sometimes the -createdfrom- will be passed as transaction number
                var fieldToQuery = SS_LOOKUP_FIELDTYPE_MAPPING[isCreatedFromFound.netsuite];
                var sourceRecordId = lookupRecordInNetSuite('transaction', fieldToQuery, createdFrom.toString());
            }

            if (isEmpty(sourceRecordId)) {
                return buildErrorMessage('The source transaction -' + createdFrom + '- is not in NetSuite, transformation cannot be performed.', SCRIPT_ID);
            }
        } else {
            return buildErrorMessage('This transaction could not be transformed, missing -createdfrom- property.', SCRIPT_ID);
        }

        //3. Check if the Order can be fulfilled before proceeding
        var orderStatus = nlapiLookupField('salesorder', sourceRecordId, 'status');
        var canBeFulfilled = canOrderBeFulfilled(orderStatus, RESTRICTED_ORDER_STATUSES);
        if (canBeFulfilled == false) {
            return buildErrorMessage("This order cannot be fulfilled it's status is: " + orderStatus, SCRIPT_ID);
        }

        //4. Group by line
        var groupedByLine = groupBy(fieldSchema, function(object) {
            return [object.line, object.join];
        });

        //5. Check for sublist fields with default values
        var defaultLineColumnFieldsToAdd = getSublistFieldsWithDefaultValues(fieldSchema);

        //6. Start setting the NS record fields
        var nsRecord = nlapiTransformRecord(sourceRecordType, sourceRecordId, targetRecordType);
        //{recordmode : 'dynamic'}

        //6.5 In order to avoid errors and unnecessary receipts or fulfilments
        if (targetRecordType == SS_TO_TRANSACTION_CONVERSION_TABLE.ItemRcpt || targetRecordType == SS_TO_TRANSACTION_CONVERSION_TABLE.ItemShip) {
            var itemCount = nsRecord.getLineItemCount('item');
            var counter = itemCount;
            while (counter != 0) {
                nsRecord.setLineItemValue('item', 'itemreceive', counter, 'F');
                counter--;
            }
        }

        /*&&&&&&&&&&&&&&&&&&&&&&&&*/
        //Loop starts here
        for (var i = 0; i < groupedByLine.length; i++) {

            var groupedFields = groupedByLine[i];
            //a. it is likely that the first child of the array are body fields - object.line = 0
            if (groupedFields[0].line == 0) {
                for (var j = 0; j < groupedFields.length; j++) {
                    var headerField = groupedFields[j];

                    if (!isEmpty(headerField.lookup) && (headerField.isSublist != 'T')) {
                        var valueFoundArray = getPropertyRecursive(externalObject, headerField.lookup);
                        //not only one value will be accepted here, these are header fields

                        if (valueFoundArray.length > 0) {
                            var lookupValue = valueFoundArray[0].value;
                            var lookupFieldObject = findObj(groupedFields, 'external', headerField.lookup);

                            if (!isEmpty(lookupValue) && !isEmpty(lookupFieldObject) && lookupFieldObject.hasOwnProperty('netsuite')) {
                                if (!isEmpty(headerField.join)) {
                                    var recordInternalId = lookupRecordInNetSuite(headerField.join, lookupFieldObject.netsuite, lookupValue);

                                    if (!isEmpty(recordInternalId)) {
                                        nsRecord.setFieldValue(headerField.netsuite, recordInternalId);
                                    } else {//record not found let's create it

                                        var newRecordInternalId = createJoinRecord(headerField.join, groupedFields);
                                        if (!isEmpty(newRecordInternalId)) {
                                            nsRecord.setFieldValue(headerField.netsuite, newRecordInternalId);
                                        } else {
                                            var errorMessage = 'The integration was not able to create new' + headerField.join + ' record.';
                                            return buildErrorMessage(errorMessage, SCRIPT_ID);
                                        }
                                    }
                                }
                            } else {//isEmpty(lookupValue)
                                //can't find the record, let's create it
                                if (!isEmpty(headerField.join)) {
                                    var newRecordInternalId = createJoinRecord(headerField.join, groupedFields);
                                    if (!isEmpty(newRecordInternalId)) {
                                        nsRecord.setFieldValue(headerField.netsuite, newRecordInternalId);
                                    } else {
                                        var errorMessage = 'The integration was not able to create new' + headerField.join + ' record.';
                                        return buildErrorMessage(errorMessage, SCRIPT_ID);
                                    }
                                }
                            }
                        }
                    } else {//regular header field not lookup
                        //set other header fields
                        if (isEmpty(headerField.lookup) && isEmpty(headerField.join) && (headerField.isSublist != 'T')) {
                            setNsField(nsRecord, headerField.fieldType, headerField.netsuite, (!isEmpty(headerField.defaultValue) ? headerField.defaultValue : headerField.externalValue));
                        }
                    }
                }
            }

            //c. set line-level fields / sublists
            if (groupedFields[0].line > 0) {
                var responseObject = receiveNsLine(nsRecord, (!isEmpty(groupedFields[0].join) ? groupedFields[0].join : 'package'), groupedFields, (defaultLineColumnFieldsToAdd.length > 0 ? defaultLineColumnFieldsToAdd : null));
                if (responseObject.response != true) {
                    var errorMessage = responseObject.message;
                    return buildErrorMessage(errorMessage, SCRIPT_ID);
                }
            } else {//d. set address sub-record(s)
                if (groupedFields[0].line < 0) {
                    var success = setNsAddress(nsRecord, groupedFields);
                    if (success != true) {
                        var errorMessage = 'The integration was not able to create new lines for the address sublist record.';
                        return buildErrorMessage(errorMessage, SCRIPT_ID);
                    }
                }
            }
        }
        /*&&&&&&&&&&&&&&&&&&&&&&&&*/
        //Loop ends here

        var id = nlapiSubmitRecord(nsRecord, true);
        return id;

    } catch(err) {
        return buildErrorMessage(err.toString(), SCRIPT_ID);
    }
}

/**
 * this method is called by -setNlobjRecord- and it retrieves the schema from the custom
 * record -Integration Project Field-. The schema is loaded in the array of objects which is updated
 * by the external values that are retrieved ba parsing the external JSON object.
 *
 * The populated array of field objects are then returned to -setNlobjRecord-
 *
 * @author ibudimir@fmtconsultants.com
 * @param {integer} integrationProject
 * @param {object} externalObject
 * @returns [{object}] arrayOfMappingObjects
 */
function getIntergrationProjectSchema(integrationProject, externalObject) {
    //Load User Preferences and store Date/Time Format - To be used in date field values
    var companyInfo = nlapiLoadConfiguration('userpreferences');
    g_dateformat = String(companyInfo.getFieldValue('dateformat'));

    var filters = [];
    var columns = [];

    filters.push(new nlobjSearchFilter('internalid', 'custrecord_ip_integration_project', 'anyof', integrationProject));
    filters.push(new nlobjSearchFilter('isinactive', null, 'is', 'F'));
    columns.push(new nlobjSearchColumn("name", null, null));

    columns.push(new nlobjSearchColumn("custrecord_ip_ns_field"));
    columns.push(new nlobjSearchColumn("custrecord_ip_external_field"));
    columns.push(new nlobjSearchColumn("custrecord_ip_field_type"));
    columns.push(new nlobjSearchColumn("custrecord_ip_issublist"));
    columns.push(new nlobjSearchColumn("custrecord_ip_default_value"));
    columns.push(new nlobjSearchColumn("custrecord_ip_lookup_field").setSort(true));
    columns.push(new nlobjSearchColumn("custrecord_ip_join", null, null).setSort(true));
    columns.push(new nlobjSearchColumn("custrecord_ip_isaddress"));
    columns.push(new nlobjSearchColumn("custrecord_ip_addresstype"));

    var searchResults = nlapiSearchRecord("customrecord_fmt_ip_field", null, filters, columns);

    if (!isEmpty(searchResults) && searchResults.length > 0) {
        var arrayOfMappingObjects = [];

        for (var i = 0; i < searchResults.length; i++) {

            var mappingObject = new Object();
            mappingObject.netsuite = searchResults[i].getValue("custrecord_ip_ns_field");
            mappingObject.external = searchResults[i].getValue("custrecord_ip_external_field");
            mappingObject.fieldType = searchResults[i].getText("custrecord_ip_field_type").toLowerCase();
            mappingObject.isSublist = searchResults[i].getValue("custrecord_ip_issublist");
            mappingObject.defaultValue = searchResults[i].getValue("custrecord_ip_default_value");
            mappingObject.lookup = searchResults[i].getValue("custrecord_ip_lookup_field");
            mappingObject.join = searchResults[i].getText("custrecord_ip_join").toLowerCase();
            mappingObject.isAddress = searchResults[i].getValue("custrecord_ip_isaddress");
            mappingObject.addressType = searchResults[i].getText("custrecord_ip_addresstype");
            mappingObject.line = 0;

            //determine whether external has a parent
            var externalArray = mappingObject.external.split(".");
            mappingObject.external = (externalArray.length > 1) ? externalArray[1] : externalArray[0];
            mappingObject.parent = (externalArray.length > 1) ? externalArray[0] : '';

            var valueFoundArray = getPropertyRecursive(externalObject, mappingObject.external);
            if (valueFoundArray.length > 0) {//one or more values were found in the external object

                if (mappingObject.isSublist == 'T') {//sublist
                    var externalLine = 0;
                    for (var j = 0; j < valueFoundArray.length; j++) {
                        var externalParentObject = valueFoundArray[j].parent;

                        if ((externalParentObject == mappingObject.parent) || isNumber(externalParentObject)) {
                            //clone the object
                            var clonedMappingObject = cloneObject(mappingObject);
                            clonedMappingObject.externalValue = isEmpty(mappingObject.defaultValue) ? valueFoundArray[j].value : mappingObject.defaultValue;

                            /*In order to set multiple lines in a sublist we need to capture the line # if it exists
                             * If the line # does not exist, this means that the sublist object does not belong to an array.
                             * For these use-cases set object property line to '1'.
                             *
                             * For Item Receipts and Item Fulfillments line number will be specified in the object. New IF statement deals with
                             * this use-case (08/24/2017).
                             */
                            if (clonedMappingObject.netsuite == 'line') {
                                externalLine = clonedMappingObject.externalValue;
                            } else {
                                if (externalLine != 0) {
                                    clonedMappingObject.line = externalLine;
                                } else {
                                    clonedMappingObject.line = isNumber(externalParentObject) ? (parseInt(externalParentObject, 10) + 1) : 1;
                                }

                            }
                            arrayOfMappingObjects.push(clonedMappingObject);

                        } else {
                            continue;
                        }
                    }
                    continue;
                    //skip one iteration of the outer loop to avoid duplicate pushes
                } else {//not a sublist
                    if (valueFoundArray.length == 1) {
                        //only one value found there is no need for parent validation
                        mappingObject.externalValue = isEmpty(mappingObject.defaultValue) ? valueFoundArray[0].value : mappingObject.defaultValue;
                    } else {
                        for (var k = 0; k < valueFoundArray.length; k++) {
                            var externalParentObject = valueFoundArray[k].parent;
                            if (externalParentObject == mappingObject.parent) {
                                mappingObject.externalValue = isEmpty(mappingObject.defaultValue) ? valueFoundArray[k].value : mappingObject.defaultValue;
                                break;
                            } else {
                                mappingObject.externalValue = '';
                            }
                        }
                    }

                    if ((mappingObject.isAddress == 'T') && (!isEmpty(mappingObject.addressType))) {//validate for address
                        //a trick that will help with grouping and keep line # negative
                        mappingObject.line = parseInt(ADDRESS_TYPES[mappingObject.addressType], 10) * -1;
                    }
                }
            } else {//no externalValue was found
                mappingObject.externalValue = "";
            }

            arrayOfMappingObjects.push(mappingObject);
        }
        return (arrayOfMappingObjects.length > 0) ? arrayOfMappingObjects : null;
    }
}

/**
 * Helper method that set NetSuite sublist lines. Note, just like with
 * -setNsField- the function performs transformation of fields based on field-types, this is
 * to ensure that the fields can be set without error. The transformation is performed by
 * -parseTransformFieldValue- function.
 *
 * The function has additional capabilities to lookup default custom column fields that were set in the mapper -customrecord_fmt_ip_field-
 * record. These defaults do not need to be in the external object.
 *
 * @author ibudimir@fmtconsultants.com
 * @param {nlobj} record
 * @param {string} sublist
 * @param [{object}] arrayOfExternalFieldObjects
 * @param [{object}] columnFieldsToAdd
 * @returns {boolean} true / false
 *
 */
function setNsLine(record, sublist, arrayOfExternalFieldObjects, columnFieldsToAdd) {
    try { outterLineLoop:
        for (var i = 0; i < arrayOfExternalFieldObjects.length; i++) {
            var lineFieldObject = arrayOfExternalFieldObjects[i];

            if (!isEmpty(lineFieldObject.lookup)) {
                var lineNumber = lineFieldObject.line;

                var fieldToQuery = SS_LOOKUP_FIELDTYPE_MAPPING[lineFieldObject.netsuite];
                if (!isEmpty(fieldToQuery)) {
                    var recordInternalId = lookupRecordInNetSuite(sublist, fieldToQuery, lineFieldObject.externalValue);
                    if (!isEmpty(recordInternalId)) {
                        //now we can set the sublist line, start with the sublist record (key) field
                        record.selectNewLineItem(sublist);
                        record.setCurrentLineItemValue(sublist, lineFieldObject.netsuite, recordInternalId);

                        /*time to set the rest of the fields on the line
                         first check if there are default fields to add*/

                        if (!isEmpty(columnFieldsToAdd) && columnFieldsToAdd.length > 0) {
                            //this validation is important as we don't want to concatenate wrong sublists
                            for (var k = 0; k < columnFieldsToAdd.length; k++) {
                                if (columnFieldsToAdd[k].join == lineFieldObject.join) {
                                    arrayOfExternalFieldObjects = arrayOfExternalFieldObjects.concat(columnFieldsToAdd[k]);
                                }
                            }
                        } innerLineLoop:
                        for (var j = 0; j < arrayOfExternalFieldObjects.length; j++) {
                            if (isEmpty(arrayOfExternalFieldObjects[j].lookup)) {
                                var lineFieldObject = arrayOfExternalFieldObjects[j];
                                var valueToSet = parseTransformFieldValue(lineFieldObject.externalValue, lineFieldObject.fieldType);
                                record.setCurrentLineItemValue(sublist, lineFieldObject.netsuite, (!isEmpty(lineFieldObject.defaultValue) ? lineFieldObject.defaultValue : valueToSet));
                            }
                            if (j == (arrayOfExternalFieldObjects.length - 1)) {
                                record.commitLineItem(sublist);
                                break outterLineLoop;
                            }
                        }
                    } else {
                        //the integration was not able to submit the line for the rec. or tran.
                        var errorMessage = 'Item record ' + lineFieldObject.externalValue + ' was not found in the system, line could not be submitted.';
                        nlapiLogExecution('debug', errorMessage);
                        var errorMessageObject = {
                            "response" : false,
                            "message" : errorMessage
                        };
                        return errorMessageObject;
                    }
                } else {
                    //mapping was not setup properly
                    var errorMessage = 'Mapping was not setup properly, line could not be submitted.';
                    nlapiLogExecution('debug', errorMessage);
                    var errorMessageObject = {
                        "response" : false,
                        "message" : errorMessage
                    };
                    return errorMessageObject;
                }
            }
        }
        //success
        var successMessageObject = {
            "response" : true,
            "message" : "sucess"
        };
        return successMessageObject;
    } catch(err) {
        //Record line could not be set
        var errorMessage = 'line could not be set: ' + err.toString();
        nlapiLogExecution('debug', errorMessage);
        var errorMessageObject = {
            "response" : false,
            "message" : errorMessage
        };
        return errorMessageObject;
    }
}

/**
 * Helper method that Receives sublist lines. To be used with Item Fulfillment and Item Receipt transactions.
 * Note, just like with -setNsField- the function performs transformation of fields based on field-types, this is
 * to ensure that the fields can be set without error. The transformation is performed by
 * -parseTransformFieldValue- function.
 *
 * The function has additional capabilities to lookup default custom column fields that were set in the mapper -customrecord_fmt_ip_field-
 * record. These defaults do not need to be in the external object. This DOES NOT APPLY to -package- sublist.
 *
 *
 * @author ibudimir@fmtconsultants.com
 * @param {nlobj} record
 * @param {string} sublist
 * @param [{object}] arrayOfExternalFieldObjects
 * @param [{object}] columnFieldsToAdd
 * @returns {boolean} true / false
 *
 */
function receiveNsLine(record, sublist, arrayOfExternalFieldObjects, columnFieldsToAdd) {
    try {
        if (sublist == 'item') { outterLineLoop:
            for (var i = 0; i < arrayOfExternalFieldObjects.length; i++) {
                var lineFieldObject = arrayOfExternalFieldObjects[i];

                if (!isEmpty(lineFieldObject.lookup)) {
                    var fieldToQuery = lineFieldObject.netsuite;
                    var externalFieldValue = lineFieldObject.externalValue;

                    var lineId = getTransactionLineId('SalesOrd', fieldToQuery, (!isEmpty(externalFieldValue) ? externalFieldValue : 0));
                    if (lineId != null) {
                        /*Time to set the rest of the fields on the line.
                         First check for default line column fields that need to be set on the sublist*/

                        if (!isEmpty(columnFieldsToAdd) && columnFieldsToAdd.length > 0) {
                            //this validation is important as we don't want to concatenate wrong sublists
                            for (var w = 0; w < columnFieldsToAdd.length; w++) {
                                if (columnFieldsToAdd[w].join == lineFieldObject.join) {
                                    arrayOfExternalFieldObjects = arrayOfExternalFieldObjects.concat(columnFieldsToAdd[w]);
                                }
                            }
                        }

                        //loop through line items and find the correct line to receive
                        var lineItemCount = record.getLineItemCount('item');
                        innerLineLoop:
                        for ( x = 1; x <= lineItemCount; x++) {
                            var currentLineId = parseInt(record.getLineItemValue(sublist, 'line', x), 10);
                            if (currentLineId == lineId) {
                                //receive this line and mark operation successful
                                record.selectLineItem(sublist, x);
                                for (var y = 0; y < arrayOfExternalFieldObjects.length; y++) {
                                    var externalValue = arrayOfExternalFieldObjects[y].externalValue;
                                    var lineFieldObject = arrayOfExternalFieldObjects[y];

                                    if ((isEmpty(lineFieldObject.lookup) && (externalFieldValue != externalValue) && (lineFieldObject.netsuite != 'item')) || !isEmpty(lineFieldObject.defaultValue)) {//skip lookup object

                                        var valueToSet = parseTransformFieldValue(lineFieldObject.externalValue, lineFieldObject.fieldType);
                                        record.setCurrentLineItemValue(sublist, lineFieldObject.netsuite, (!isEmpty(lineFieldObject.defaultValue) ? lineFieldObject.defaultValue : valueToSet));
                                    }
                                    if (y == (arrayOfExternalFieldObjects.length - 1)) {
                                        record.commitLineItem(sublist);
                                        break outterLineLoop;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            //success
            var sucessMessageObject = {
                "response" : true,
                "message" : "success"
            };

            return sucessMessageObject;
        } else {
            if (sublist == 'package') { outterLineLoop:
                for (var k = 0; k < arrayOfExternalFieldObjects.length; k++) {
                    var lineFieldObject = arrayOfExternalFieldObjects[k];

                    if (lineFieldObject.netsuite == 'packageweight') {//first field to set on the sublist
                        //now we can set the sublist line, start with the sublist record (key) field
                        record.selectNewLineItem(sublist);
                        record.setCurrentLineItemValue(sublist, lineFieldObject.netsuite, lineFieldObject.externalValue);

                        //time to set the rest of the fields on the line
                        innerLineLoop:
                        for (var m = 0; m < arrayOfExternalFieldObjects.length; m++) {
                            if (arrayOfExternalFieldObjects[m].netsuite != 'packageweight') {
                                var lineFieldObject = arrayOfExternalFieldObjects[m];
                                var valueToSet = parseTransformFieldValue(lineFieldObject.externalValue, lineFieldObject.fieldType);
                                record.setCurrentLineItemValue(sublist, lineFieldObject.netsuite, (!isEmpty(lineFieldObject.defaultValue) ? lineFieldObject.defaultValue : valueToSet));
                            }
                            if (m == (arrayOfExternalFieldObjects.length - 1)) {
                                record.commitLineItem(sublist);
                                break outterLineLoop;
                            }
                        }
                    }
                }

                //fix for the package sublist bug
                var firstLineTrackingNumber = record.getLineItemValue('package', 'packagetrackingnumber', 1);

                if (isEmpty(firstLineTrackingNumber)) {
                    record.removeLineItem('package', 1);
                }

                //success
                var sucessMessageObject = {
                    "response" : true,
                    "message" : "success"
                };

                return sucessMessageObject;
            }
        }

    } catch(err) {
        //Record line could not be set
        var errorMessage = 'line could not be received: ' + err.toString();
        nlapiLogExecution('debug', errorMessage);
        var errorMessageObject = {
            "response" : false,
            "message" : errorMessage
        };
        return errorMessageObject;
    }
}

/**
 * Simple function that sets a field value in a NS record's field.
 * The record is pushed as a parameter. The type (i.e.: 'string, phone, integer ...')
 * is used to transform the value if necessary. The transformation is completed
 * by -parseTransformFieldValue- method.
 *
 * Once transformed the function sets the field value and the -id- parameter is used to identify
 * the field's internalid in NetSuite.
 *
 * @author ibudimir@fmtconsultants.com
 * @param {nlobj} record
 * @param {string} type
 * @param {string} id
 * @param {string} value
 * @returns null
 */
function setNsField(record, type, id, value) {
    var newValue = parseTransformFieldValue(value, type);
    if (id == "status" || id == "orderstatus") {
        record.setFieldText(id, newValue);
    } else {
        record.setFieldValue(id, newValue);
    }
}

/**
 * Simple function that address sub-records and adds them to transaction.
 * Exact address type and all associated address fields and their values are passed to the function as an attribute.
 * The function loops through the array of objects and sets populated fields.
 *
 * @author ibudimir@fmtconsultants.com
 * @params {nlObj} transactionRecord [{objec}] groupedFields
 * @returns {boolean} true / false
 */
function setNsAddress(transactionRecord, groupedFields) {
    try {
        for (var i = 0; i < groupedFields.length; i++) {
            var fieldObject = groupedFields[i];
            if (fieldObject.hasOwnProperty('netsuite') && fieldObject.hasOwnProperty('externalValue')) {
                if (!isEmpty(fieldObject.netsuite) && !isEmpty(fieldObject.externalValue)) {
                    var newValue = parseTransformFieldValue(fieldObject.externalValue, fieldObject.fieldType);
                    transactionRecord.setFieldValue(fieldObject.netsuite, newValue);
                }
            }
        }
        return true;
    } catch(err) {
        //Address sub-record could not be created
        nlapiLogExecution('debug', 'Address sub-record could not be created: ', err.toString());
        return false;
    }
}

/**
 * If the join (connected / dependent) record is not found in NetSuite, this
 * function will create it using the field mappings that are provided as part of the Integration
 * Project record.
 *
 * @author ibudimir@fmtconsultants.com
 * @param {string} recordType
 * @param [{object}] arrayOfFieldObjects
 * @returns {string} id
 */
function createJoinRecord(recordType, arrayOfFieldObjects) {
    try {
        var nsRecord = nlapiCreateRecord(recordType);

        if (recordType == 'customer') {
            arrayOfFieldObjects = processCustomerRecord(arrayOfFieldObjects);
        }

        for (var i = 0; i < arrayOfFieldObjects.length; i++) {
            if (arrayOfFieldObjects[i].hasOwnProperty('join') && recordType == arrayOfFieldObjects[i].join) {
                setNsField(nsRecord, arrayOfFieldObjects[i].fieldType, arrayOfFieldObjects[i].netsuite, (!isEmpty(arrayOfFieldObjects[i].defaultValue) ? arrayOfFieldObjects[i].defaultValue : arrayOfFieldObjects[i].externalValue));
            }
        }
        var id = nlapiSubmitRecord(nsRecord);
        return id;
    } catch(err) {
        nlapiLogExecution('debug', 'Join record could not be submitted: ', err.toString());
        return null;
    }
}

/**
 * Some manipulation is required of an -arrayOfObjects- when the record type is
 * -Customer-. This method calls -findObj- & -getArrayWithout- functions to adjust the array of objects
 * depending on whether a Customer is an individual / company. The NEW array of objects is returned to the
 * calling function.
 *
 * @author ibudimir@fmtconsultants.com
 * @param [{object}] arrayOfObjects
 * @returns [{object}] arrayOfObjects
 */
function processCustomerRecord(arrayOfObjects) {
    var isPersonFieldFound = findObj(arrayOfObjects, 'netsuite', 'isperson');

    if (!isEmpty(isPersonFieldFound)) {
        var isPerson = isPersonFieldFound.externalValue;
        if (isPerson == true) {
            arrayOfObjects = getArrayWithout(arrayOfObjects, 'netsuite', ['companyname', 'isperson']);
        } else {//isPerson == false
            arrayOfObjects = getArrayWithout(arrayOfObjects, 'netsuite', ['firstname', 'lastname', 'isperson']);
        }
        //Now we want add -isPersonFieldFound- as a first index in the array
        arrayOfObjects.unshift(isPersonFieldFound);
    }

    return arrayOfObjects;
}

/**
 * Due to inconsistencies in field values passed through a JSON object
 * each field needs to be processed and transformed if necessary. The transformation will
 * depend on the -type- parameter and the appropriate method will be called to transform
 * the string, -input- parameter and return it to the calling function in a correct format.
 *
 * @author ibudimir@fmtconsultants.com
 * @param {string} input
 * @param {string} type
 * @returns {string} output
 */
function parseTransformFieldValue(input, type) {
    var output = input;

    switch(type) {
    case "date":
        var dateStringToFormat = null;
        if ((String(output).length == 10)) {//if unix stamp
            //convert to regular UTC timestamp
            var timeStampString = parseInt(output, 10) * 1000;
            var dateTime = new Date(timeStampString);
            dateStringToFormat = dateTime.toISOString();
        } else {
            dateStringToFormat = output;
        }
        output = getNSFormattedDate(dateStringToFormat, g_dateformat, true);
        break;

    case "integer":
        output = parseInt(output, 10);
        break;

    case "float":
        output = parseFloat(output);
        break;

    case "stripe currency":
        output = parseInt(output, 10) / 100;
        break;

    case "phone":
        output = output.replace(/[\(\)\-\s]+/g, '');
        break;

    case "boolean":
        output = (output == true || output == 'T') ? 'T' : 'F';
    }
    return output;
}

/**
 * Key function that looks up the internalid of the record in NetSuite
 * based on the recordType, fieldType (NS field 'name' NOT internalid) and the value
 * that is essentially a string that we are basing our lookup on.
 *
 * If the record id found in NetSuite, the function will return its internalid,
 * otherwise it will return -null-
 *
 * @author ibudimir@fmtconsultants.com
 * @param {string} recordType
 * @param {string} fieldType
 * @param {string} value
 * @returns {integer} recordInternalId / null
 */
function lookupRecordInNetSuite(recordType, fieldType, value) {
    var filters = [];
    var recordInternalId = null;

    filters.push(new nlobjSearchFilter(fieldType, null, 'is', value));
    var searchResult = nlapiSearchRecord(recordType, null, filters, null);

    if (!isEmpty(searchResult)) {
        recordInternalId = searchResult[0].getId();
    }

    return recordInternalId;
}

/**
 * This function looks up NetSuite line id based on the -lineReference- &  -lineReferenceValue- attributes
 * passed to this function. Note, if the line is found on any of the transactions (for specific transaction type), it will be
 * returned to the calling function.
 *
 * @author ibudimir@fmtconsultants.com
 * @params {string} transactionType, {string} lineReference, {string} lineReferenceValue
 * @returns {string} lineId
 */
function getTransactionLineId(transactionType, lineReference, lineReferenceValue) {
    var filters = [];
    var columns = [];
    var lineId = null;

    filters.push(new nlobjSearchFilter('type', null, 'anyof', transactionType));
    filters.push(new nlobjSearchFilter('mainline', null, 'is', 'F'));
    filters.push(new nlobjSearchFilter(lineReference, null, 'equalto', lineReferenceValue));

    columns.push(new nlobjSearchColumn('line'));

    var searchResult = nlapiSearchRecord('transaction', null, filters, columns);

    if (!isEmpty(searchResult) && searchResult.length > 0) {
        lineId = parseInt(searchResult[0].getValue('line'), 10);
        //there will always be one result
    }
    return lineId;
}

/**
 * This function helps compile a list of NetSuite Integration sub-records
 * that are sublists fields with default values.
 *
 * @author ibudimir@fmtconsultants.com
 * @param [{object}] arrayOfObjects
 * @returns [{object}] objectsFound
 */
function getSublistFieldsWithDefaultValues(arrayOfObjects) {
    var objectsFound = [];
    for (var i = 0; i < arrayOfObjects.length; i++) {
        var objectFound = findPropertyValueInObject(arrayOfObjects[i], 'isSublist', 'T');
        if (!isEmpty(objectFound)) {
            if (!isEmpty(objectFound.defaultValue) && objectFound.line == 0) {
                objectsFound.push(objectFound);
            }
        }
    }
    return objectsFound;
}

/*****************************************/
// Helper Functions
/*****************************************/

/* Record Processing Functions */

/**
 * This function looks up the transaction type based on the internal id.
 *
 * @author ibudimir@fmtconsultants.com
 * @param {Object} id
 * @returns {string} transactionType
 */
function findTransactionType(id) {
    var transactionType = null;
    var filters = [];
    var columns = [];

    filters.push(new nlobjSearchFilter('internalid', null, 'is', id));
    columns.push(new nlobjSearchColumn('type'));

    var result = nlapiSearchRecord('transaction', null, filters, columns);
    if (!isEmpty(result)) {
        transactionType = result[0].getValue('type');

    }

    //check conversion table and return the correct transaction type
    if (!isEmpty(transactionType)) {
        if (SS_TO_TRANSACTION_CONVERSION_TABLE.hasOwnProperty(transactionType)) {
            transactionType = SS_TO_TRANSACTION_CONVERSION_TABLE[transactionType];
        }
    }
    return transactionType;
}

/**
 * Simple search function that looks-up a transaction by its internal id.
 *
 * @author ibudimir@fmtconsultants.com
 * @params {string} internalid, {string} type
 * @returns {boolean} true / false
 */
function findTransactionByInternalId(internalid, type) {
    var filters = [];
    var transactionFound = false;

    filters.push(new nlobjSearchFilter('internalid', null, 'anyof', internalid));
    filters.push(new nlobjSearchFilter('type', null, 'anyof', type));
    var searchResult = nlapiSearchRecord('transaction', null, filters, null);

    if (!isEmpty(searchResult)) {
        transactionFound = true;
    }

    return transactionFound;
}

/* Error Handling */

/**
 * Loads error object and returns it to the REST call.
 * This function now also calls the logging function, scriptId is
 * passed as a parameter.
 *
 * @author ibudimir@fmtconsultants.com
 * @param {string} errorMessage
 * @param {string} scriptId
 * @returns {object} error
 */
function buildErrorMessage(errorMessage, scriptId) {
    var error = {
        "error" : {
            "code" : "APP_ERROR",
            "message" : errorMessage
        }
    };

    if (scriptId) {
        generateErrorRecord(errorMessage, scriptId);
    }
    return error;
}

/**
 * Simple function used to generate an error log record and submit it NetSuite.
 *
 * @author ibudimir@fmtconsultants.com
 * @param {nlObj} err
 * @param {string} scriptId
 * @param {string} transactionId
 * @param {string} transactionInternalId
 * @returns null
 */
function generateErrorRecord(err, scriptId, transactionId, transactionInternalId) {
    var errorRecord = nlapiCreateRecord(FMT_ERROR_LOG_RECORD.NAME);

    errorRecord.setFieldValue('altname', scriptId);
    if (!isEmpty(transactionId)) {
        errorRecord.setFieldValue(FMT_ERROR_LOG_RECORD.TRANSACTION_ID, transactionId);
    }
    if (!isEmpty(transactionInternalId)) {
        errorRecord.setFieldValue(FMT_ERROR_LOG_RECORD.TRANSACTION_INTERNAL_ID, transactionInternalId);
    }
    errorRecord.setFieldValue(FMT_ERROR_LOG_RECORD.ERROR_MESSAGE, err);

    nlapiSubmitRecord(errorRecord);
}

/* Object Parsing & Manipulation Functions */

/**
 * Traversal iterative function that works with -getPropertyRecursive-
 * method.
 *
 * @author robrighter/gist:897565
 * @param {object} obj
 * @param {function} func
 * @returns null
 */
function traverse(obj, func, parent) {
    for (var i in obj) {
        func.apply(this, [i, obj[i], parent]);
        if (obj[i] instanceof Object && !(obj[i] instanceof Array)) {
            traverse(obj[i], func, i);
        } else {
            if (obj[i] instanceof Array) {
                var arayOfObjects = obj[i];
                for (var j = 0; j < arayOfObjects.length; j++) {
                    traverse(arayOfObjects[j], func, j);
                }
            }
        }
    }
}

/**
 * Recursive function that utilizes -traverse- method
 * to lookup property in an object and find a corresponding value.
 * Note, if there are multiple nodes with the same property they are all returned
 * in the array of objects.
 *
 * @author robrighter/gist:897565
 * @param {object} obj
 * @param {string} property
 * @returns [{object}] acc
 */
function getPropertyRecursive(obj, property) {
    var acc = [];
    traverse(obj, function(key, value, parent) {
        if (key === property) {
            acc.push({
                parent : parent,
                value : value
            });
        }
    });
    return acc;
}

/**
 * Returns an object key and value match the query
 * @author : ibudimir@fmtconsultants
 * @param : {Object} o, {String} id, {String} v
 * @return :{Object}/Null
 */
function findPropertyValueInObject(o, id, v) {
    for (var key in o) {
        if (o.hasOwnProperty(key)) {
            if (key == id && o[key] == v) {
                return o;
            }
        }
    }
    return null;
}

/**
 * Returns an object propery / key from a value match found
 * in an object.
 * @author : ibudimir@fmtconsultants
 * @param : {Object} o, {String} v
 * @return :{Object}/Null
 */

function getPropertyFromValue(o, v) {
    for (var key in o) {
        if (o.hasOwnProperty(key)) {
            if (o[key] == v) {
                return key;
            }
        }
    }
    return null;
}

/**
 * Clones the object passed, recursively.
 *
 * @author ibudimir@fmtconsultants.com
 * @param {object} obj
 * @returns {object} temp / obj
 */
function cloneObject(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    var temp = obj.constructor();
    // give temp the original obj's constructor
    for (var key in obj) {
        temp[key] = cloneObject(obj[key]);
    }

    return temp;
}

/**
 * Returns an object that matches the value specified
 * @author : elean.olguin@gmail.com
 * @param : {Object} a, {String} id, {String} v
 * @return :{Object}/Null
 */
function findObj(a, id, v) {
    for (var k = 0; k < a.length; k++) {
        if (a[k].hasOwnProperty(id)) {
            if (a[k][id] == v) {
                return a[k];
            }
        }
    }
    return null;
}

/**
 * Finds and returns a conditional array of values. It will exclude
 * objects that match the value that is passed as an attribute. Note, you can pass
 * value as an array of strings.
 *
 * @author : ibudimir@fmtconsultants.com
 * @param : {Object} arr, {String} id, {string} / [string] value
 * @return : {Object} array
 */
function getArrayWithout(arr, id, value) {
    var array = [];
    var valueIsArray = false;
    (Array.isArray(value) == true) ? valueIsArray = true : valueIsArray = false;

    for (var k = 0; k < arr.length; k++) {
        if (arr[k].hasOwnProperty(id)) {
            if (valueIsArray == true) {
                for (var h = 0; h < arr.length; h++) {
                    if (value.indexOf(arr[h][id]) == -1) {
                        array.push(arr[h]);
                    }
                }
                break;
            } else {
                if (arr[k][id] != value) {
                    array.push(arr[k]);
                }
            }
        }
    }
    return array;
};

/**
 * Simple object grouping function that is to be used with
 * -groupBy- function, it browses through and object and creates a new
 * array of objects.
 *
 * @author ibudimir@fmtconsultants.com
 * @parameter {object} obj
 * @returns [object] arr
 */
function arrayFromObject(obj) {
    var arr = [];
    for (var i in obj) {
        arr.push(obj[i]);
    }
    return arr;
}

/**
 * Used with -arrayFromObject-. Accepts
 * list array of objects and a function that pushes properties
 * that need to be used for grouping (i.e.):
 *
 * groupBy(soObject.soLines, function(item) {
 return [item.custcol_item_supplier, item.location];
 });
 *
 * The function will group by the property name just like
 * in the example above.
 *
 * @author ibudimir@fmtconsultants.com
 * @parameter [{object}] list
 * @returns [function] arrayFromObject
 */
function groupBy(list, fn) {
    var groups = {};
    for (var i = 0; i < list.length; i++) {
        var group = JSON.stringify(fn(list[i]));
        if ( group in groups) {
            groups[group].push(list[i]);
        } else {
            groups[group] = [list[i]];
        }
    }
    return arrayFromObject(groups);
}

/* Misc */

/**
 * Simple function that performs a verification of
 * Order Status against the list of statuses. If the match is found
 * the flag 'canBeFulfilled' is switched to 'false' and returned to the calling
 * function.
 *
 * @author ibudimir@fmtconsultants.com
 * @param {string} orderStatus
 * @param [string] listOfStatuses
 */
function canOrderBeFulfilled(orderStatus, listOfStatuses) {
    var canBeFulfilled = true;

    for (var i = 0; i < listOfStatuses.length; i++) {
        if (orderStatus == listOfStatuses[i]) {
            canBeFulfilled = false;
            break;
        }
    }
    return canBeFulfilled;
}

/**
 * This function loops through the required parameters that are pushed
 * in as an array of string values. If one of the parameters is not found the function returns the
 * error object.
 *
 * @author ibudimir@fmtconsultants.com
 * @param [string] params
 * @param {object} datain
 * @return {object} buildErrorMessage
 *
 */
function validateRequiredFields(params, datain) {
    for (var i = 0; i < params.length; i++) {
        if (datain == null || datain[params[i]] == null || datain[params[i]] == '') {
            return buildErrorMessage("Error: You must provide the " + params[i] + " parameter");
        }
    }
}

/**
 * Format a date according to given format.
 * @author August Li - ali@netsuite.com
 *
 * Modified by elean.olguin@gmail.com - Converted Data
 * Parsing methods into functions, removed some validation
 * to make it compartible with regular non xml/pdf inputs.
 *
 * @param {string|Date} dateToFormat Date to format.
 * @param {string} formatString Format string.
 * @param {boolean} isZeroPad Optional. Default is true.
 * @return {string} Formatted date
 */
function getNSFormattedDate(dateToFormat, formatString, isZeroPad) {
    if (String(dateToFormat).length == 0) {
        return '';
    }

    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var text = '';
    var formatString = formatString == null ? "MM-DD-YYYY" : formatString;
    if ( typeof dateToFormat == 'string') {
        dateToFormat = new Date(dateToFormat);
    }
    var day = dateToFormat.getDate(),
        dow = dateToFormat.getDay(),
        month = dateToFormat.getMonth() + 1,
        year = dateToFormat.getFullYear(),
        hours = dateToFormat.getHours(),
        mins = dateToFormat.getMinutes(),
        secs = dateToFormat.getSeconds(),
        ampm = (hours >= 12) ? "pm" : "am",
        hrs = (hours >= 12) ? hours - 12 : hours;
    if (hrs == 0) {
        hrs = 12;
    }
    text = formatString;
    text = text.replace(/(HH24|HH|mm|ss|SS|DD|YYYY|YY|MM|MONTH|Month|MON|Mon|DAYOFWEEK|DayOfWeek|DOW|Dow|AM|PM|am|pm)/g, function(match) {
        var len = match.length;
        if (len == 2) {
            if (match == 'DD') {
                return nsZeroPad(day, isZeroPad);
            } else if (match == 'YY') {
                return year.toString().substring(2);
            } else if (match == 'MM') {
                return nsZeroPad(month, isZeroPad);
            } else if (match == 'HH') {
                return nsZeroPad(hrs, isZeroPad);
            } else if (match == 'mm') {
                return nsZeroPad(mins, true);
            } else if (match == 'SS' || match == 'ss') {
                return nsZeroPad(secs, true);
            } else if (match == 'am' || match == 'pm') {
                return ampm;
            } else if (match == 'AM' || match == 'PM') {
                return ampm.toUpperCase();
            }
        } else if (len == 3) {
            if (match == 'DOW') {
                return (days[dow].substring(0, 3)).toUpperCase();
            } else if (match == 'Dow') {
                return days[dow].substring(0, 3);
            } else if (match == 'MON') {
                return (months[month - 1].substring(0, 3)).toUpperCase();
            } else if (match == 'Mon') {
                return months[month - 1].substring(0, 3);
            }
        } else if (len == 4) {
            if (match == 'HH24') {
                return nsZeroPad(hours, isZeroPad);
            } else if (match == 'YYYY') {
                return year;
            }
        } else if (match == 'MONTH') {
            return (months[month - 1]).toUpperCase();
        } else if (match == 'Month') {
            return months[month - 1];
        } else if (match == 'DAYOFWEEK') {
            return (days[dow]).toUpperCase();
        } else if (match == 'DayOfWeek') {
            return days[dow];
        }
    });
    return text;
};

/**
 * Return True/False if a value is empty
 *
 * @param : {String} val
 * @return : {Boolean} True/False
 * @author : ibudimir@fmtconsultants.com
 */
function isEmpty(val) {
    return (val == null || val == '' || val == 'undefined') ? true : false;
}

/**
 * @author August Li - ali@netsuite.com
 *
 * Modified by elean.olguin@gmail.com
 *
 * Used by date. Faster than using generic pad function.
 * @param {string|number} value
 * @param {boolean=} Whether to zero pad or not. Default is true.
 * @return {string} Padded value
 */
function nsZeroPad(value, isZeroPad) {
    return (isZeroPad === false) ? value : nsPad(value, 2, '0');
}

/**
 * @author August Li - ali@netsuite.com
 *
 * Modified by elean.olguin@gmail.com
 *
 * Pad a string with specified character.
 * @param {string|number} value
 * @param {number} count Positive will pad on left side. Negative will pad on right side.
 * @param {string} padChar
 * @return {string} Padded value
 */
function nsPad(value, count, padChar) {
    if (value != null) {
        var filler = (new Array(Math.abs(count) - String(value).length + 1)).join(padChar);
        if (count > 0) {
            value = filler + value;
        } else {
            value = value + filler;
        }
        return value;
    } else {
        return '';
    }
}

/**
 * @author : eolguin@fmtconsultants.com
 * @param {Object} val
 * @return {Boolean}
 */
function isNumber(val) {
    return !isNaN(parseFloat(val)) ? true : false;
}

/**
 * Dynamic search function, transforms the Search Result Object into an array of objects.
 *
 * @author ibudimir@fmtconsultants.com
 * @param searchId {string}
 * @param transactionType {string}
 * @param filters [{string}]
 * @param columns [{string}]
 * @returns resultsArrayOfObjects [{object}]
 */
function getDynamicSavedSearchResults(searchId, transactionType, filters, columns) {
    var searchResult = nlapiSearchRecord(transactionType, searchId, (!isEmpty(filters) ? filters : null), (!isEmpty(columns) ? columns : null));
    if (searchResult != null) {

        //set the headers by browsing through columns
        var columns = searchResult[0].getAllColumns();
        var columnLength = columns.length;
        var resultsArrayOfObjects = [];

        //browse through results and get values
        var resultLength = searchResult.length;
        for (var i = 0; i < resultLength; i++) {
            //Load the rest of the column values by result row 'i'
            var regularRow = [];
            for (var j = 0; j < columnLength; j++) {
                var singleResult = {
                    'column' : j,
                    'label' : columns[j].label,
                    'name' : columns[j].name,
                    'value' : SO_TXT_FIELDS.indexOf(columns[j].name) == -1 ? searchResult[i].getValue(columns[j]) : searchResult[i].getText(columns[j]),
                };

                regularRow[j] = singleResult;
                //nlapiLogExecution('debug', 'regularColumn['+ j +']: ', JSON.stringify(singleResult) );
            }
            resultsArrayOfObjects[i] = regularRow;
        }
    }
    return (searchResult != null && searchResult.length > 0) ? resultsArrayOfObjects : null;
}